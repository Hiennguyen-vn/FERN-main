# Kiến trúc AI Query Service — sơ đồ

> Các sơ đồ dưới đây mô tả đúng mã nguồn hiện tại (`AGENT_MODE_ENABLED=true`, đồ thị tác tử Finch-style).
> Nguồn tham chiếu: `app/main.py`, `app/agents/graph_builder.py`, `app/agents/sql_writer_agent.py`,
> `app/agents/tools.py`, `app/guard/sql_ast.py`, `app/codegen/rbac_inject.py`, `app/clients/*`.
>
> Mermaid hiển thị trực tiếp trên GitHub/Cursor. Để đưa vào LaTeX: export PNG/SVG
> (mermaid.live hoặc `mmdc`) rồi `\includegraphics`, hoặc dùng bản TikZ ở cuối file.

---

## 1. Kiến trúc tổng thể và các chốt kiểm soát

```mermaid
flowchart LR
    User([Người dùng nghiệp vụ])

    subgraph EDGE["Biên hệ thống"]
        GW["API Gateway<br/>(xác thực phiên)"]
    end

    subgraph SVC["AI Query Service — FastAPI"]
        direction TB
        AUTH["Xác thực nội bộ<br/>X-Internal-Token + X-Internal-Service=gateway<br/>bắt buộc outlet_ids"]
        RL["Rate limit theo user<br/>(Redis + Lua atomic)"]
        GRAPH["LangGraph — đồ thị tác tử<br/>(xem sơ đồ 2)"]
        AUDIT["Audit + Learning<br/>(redact PII, hash SQL,<br/>không lưu kết quả thô)"]
        AUTH --> RL --> GRAPH --> AUDIT
    end

    subgraph DATA["Lớp dữ liệu (chỉ đọc)"]
        direction TB
        CH[("ClickHouse<br/>analytics.ai_*_daily<br/>readonly=1, max_rows, max_time")]
        PG[("PostgreSQL OLTP<br/>đường đọc HR tĩnh")]
    end

    subgraph CDC["Replication"]
        KC["Kafka Connect / Debezium<br/>(CDC bảng nghiệp vụ chọn lọc)"]
    end

    User -->|HTTPS| GW
    GW -->|tiêu đề nội bộ:<br/>user, role, outlet_ids, correlation_id| AUTH
    GRAPH -->|SQL đã chèn RBAC + qua AST guard| CH
    GRAPH -->|truy vấn HR tham số hoá| PG
    PG -. CDC .-> KC -. sink .-> CH
    AUDIT -->|phản hồi + trace| GW --> User

    classDef ctrl fill:#fde8e8,stroke:#c0392b,color:#000;
    classDef store fill:#e8f0fe,stroke:#1a73e8,color:#000;
    class AUTH,RL,AUDIT ctrl;
    class CH,PG store;
```

**Chốt kiểm soát (màu đỏ):** xác thực nội bộ → giới hạn tần suất → (bên trong đồ thị) chèn RBAC + kiểm tra AST → kiểm toán. Mô hình ngôn ngữ chỉ chạy *bên trong* đồ thị và không bao giờ chạm trực tiếp tới CSDL.

---

## 2. Đồ thị tác tử (LangGraph)

```mermaid
flowchart TD
    START([query request]) --> PRE[preprocess]
    PRE --> KB[kb_retriever]
    KB --> SUP{{"supervisor_agent<br/>(1 LLM call)"}}

    SUP -->|social/greeting/thanks| SOC[social_reply]
    SUP -->|docs_question| DOC[doc_reader]
    SUP -->|clarification/unsupported| FMT[answer_formatter]
    SUP -->|data/export/viz/hr| ENT[entity_resolver]

    ENT --> COV{{"data_coverage<br/>(scope + gate)"}}
    COV -->|hr_staff| HR[hr_query]
    COV -->|có template_key| TPL[template_path]
    COV -->|needs_sql_writer + preconditions ok| SQLW["sql_writer_agent<br/>(LLM tool loop — sơ đồ 3)"]
    COV -->|precondition fail| FMT

    TPL -->|ok| EXP[export_builder]
    TPL -->|execution_error| FMT
    SQLW -->|ok| EXP
    SQLW -->|execution_error| FMT
    HR --> EXP

    EXP -->|viz requested| VIZ[visualizer]
    EXP --> BRIEF[analysis_brief]
    VIZ --> BRIEF
    BRIEF --> FMT
    SOC --> FMT
    DOC --> FMT

    FMT --> REV[reviewer_agent]
    REV --> SUG[suggestions]
    SUG --> SE[session_enricher]
    SE --> KBW[kb_writer]
    KBW --> END([END])

    classDef llm fill:#fff3cd,stroke:#b8860b,color:#000;
    classDef data fill:#e8f0fe,stroke:#1a73e8,color:#000;
    class SUP,SQLW llm;
    class TPL,SQLW,HR data;
```

`entity_resolver` và `data_coverage` là bước tất định (không gọi LLM), chạy trước các nhánh dữ liệu để giải thực thể + tính phạm vi RBAC + chặn sớm nếu thiếu điều kiện.

---

## 3. SQL Writer — vòng lặp công cụ và ranh giới tin cậy

```mermaid
flowchart TD
    subgraph UNTRUSTED["Vùng không tin cậy (LLM)"]
        LLM["sql_writer_agent<br/>(tool-calling loop)"]
    end

    subgraph TRUSTED["Công cụ do chương trình kiểm soát (trust boundary)"]
        direction TB
        T1["search_schema<br/>(chỉ bảng/cột công bố cho miền)"]
        T2["get_table_policy"]
        T3["list_columns"]
        T4["validate_and_inject"]
        T5["execute_query"]
    end

    LLM -->|gọi tool| T1 & T2 & T3
    LLM -->|SQL ứng viên| T4
    T4 --> G1["validate_sql_phase1<br/>(structure + allow-list bảng)"]
    G1 --> G2["check finance access<br/>+ compute_allowed_outlets"]
    G2 --> G3["inject_outlet_filter<br/>outlet_id IN (...) tất định"]
    G3 --> G4["clamp_outer_limit"]
    G4 --> G5["verify_outlet_in_clause"]
    G5 --> G6["validate_sql<br/>(AST guard đầy đủ)"]
    G6 --> G7["EXPLAIN SYNTAX + EXPLAIN PIPELINE"]
    G7 -->|SQL an toàn| LLM
    G6 -.->|vi phạm → trả lỗi cho LLM sửa| LLM

    LLM -->|chỉ sau khi validate| T5
    T5 -->|readonly=1<br/>max_result_rows, max_execution_time| CH[("ClickHouse")]

    classDef llm fill:#fff3cd,stroke:#b8860b,color:#000;
    classDef guard fill:#fde8e8,stroke:#c0392b,color:#000;
    class LLM llm;
    class G1,G2,G3,G4,G5,G6,G7 guard;
```

**Điểm cốt lõi để phản biện:** mọi đầu ra SQL của LLM đều phải đi qua `validate_and_inject` (chèn RBAC tất định + AST guard + EXPLAIN) trước khi được phép thực thi. LLM không thể tự gọi `execute_query` với SQL chưa kiểm chứng, không nhìn thấy toàn bộ lược đồ, và không tự gắn điều kiện cửa hàng.

---

## 4. Phiên bản TikZ (chèn thẳng vào LaTeX)

```latex
\begin{figure}[H]
\centering
\begin{tikzpicture}[
    node distance=8mm and 14mm,
    box/.style={draw, rounded corners, align=center, minimum height=8mm, inner sep=4pt, font=\small},
    ctrl/.style={box, fill=red!10, draw=red!60},
    store/.style={box, fill=blue!8, draw=blue!60},
    arr/.style={-{Latex[length=2mm]}, thick},
]
% Edge / client
\node[box] (gw) {API Gateway\\(xác thực phiên)};
% Service column
\node[ctrl, right=of gw] (auth) {Xác thực nội bộ\\X-Internal-Token\\+ outlet\_ids};
\node[ctrl, below=of auth] (rl) {Rate limit\\(Redis + Lua)};
\node[box, below=of rl] (graph) {LangGraph\\(đồ thị tác tử)};
\node[ctrl, below=of graph] (audit) {Audit\\(redact PII, hash SQL)};
% Data
\node[store, right=22mm of graph] (ch) {ClickHouse\\analytics.ai\_*\_daily\\readonly=1};
\node[store, below=of ch] (pg) {PostgreSQL\\(đọc HR)};

\draw[arr] (gw) -- (auth);
\draw[arr] (auth) -- (rl);
\draw[arr] (rl) -- (graph);
\draw[arr] (graph) -- (audit);
\draw[arr] (graph) -- node[above, font=\scriptsize]{SQL + RBAC + AST} (ch);
\draw[arr] (graph) -- (pg);
\draw[arr] (audit.south) .. controls +(down:8mm) and +(down:8mm) .. (gw.south);
\end{tikzpicture}
\caption{Kiến trúc AI Query với các chốt kiểm soát}
\label{fig:ch5_ai_query_arch}
\end{figure}
```

Gói TikZ cần: `\usepackage{tikz}` + `\usetikzlibrary{arrows.meta, positioning}` và `\usepackage{float}` cho `[H]`.

---

## 5. Xuất hình từ Mermaid (tuỳ chọn)

```bash
# Cần Node.js
npm i -g @mermaid-js/mermaid-cli
mmdc -i diagram.mmd -o diagram.png -s 3   # -s 3 để ảnh nét cao
```

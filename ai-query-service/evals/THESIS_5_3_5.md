# Mục 5.3.5 — Đánh giá hiệu quả (LaTeX để dán vào đồ án)

> Tài liệu này cung cấp phần LaTeX hoàn chỉnh cho tiểu mục **5.3.5 "Đánh giá hiệu quả"**, đã điền số liệu thật chạy được từ mã nguồn ngày 2026-06-10.
> Toàn bộ số liệu tái lập được, không cần khoá API OpenAI hay cơ sở dữ liệu thật (xem `evals/REPORT.md` để có đầu ra đầy đủ).

---

## 1. Số liệu nguồn (để tra cứu nhanh khi phản biện hỏi)

| Phép đo | Lệnh | Kết quả |
|---|---|---|
| Eval `local` | `python -m scripts.run_openai_evals --mode local --suite golden` | 35/35 = 100,0% — p50/p95 = 2ms/6ms |
| Eval `shadow-mock` | `python -m scripts.run_openai_evals --mode shadow-mock --suite golden` | 46/48 = 95,8% — p50/p95 = 38ms/67ms |
| Test bảo mật | `pytest tests/test_sql_guard.py …` (6 file) | 63/63 = 100% |
| Ablation guard | `python -m scripts.guard_ablation` | chặn 31/31 SQL không an toàn; giữ 6/6 truy vấn hợp lệ |

Hai case chưa đạt ở `shadow-mock` (`INV-041`, `FIN-040`) chỉ thuộc trục `tables_subset`: bản LLM mô phỏng chọn bảng **vẫn nằm trong allow-list** nhưng khác bảng kỳ vọng → sai lệch fixture, **không phải lỗ hổng quyền**.

---

## 2. LaTeX hoàn chỉnh (copy-paste)

```latex
\subsection{Đánh giá hiệu quả}
\label{subsection:5.3.5}

Để chứng minh các chốt kiểm soát không chỉ tồn tại trên thiết kế mà còn hoạt động đúng, dịch vụ AI Query đi kèm một bộ khung đánh giá tự động (golden suite) gồm các tình huống được phân lớp theo độ khó, từ câu hỏi không cần truy vấn dữ liệu (L0) đến câu hỏi đối kháng cố tình vượt quyền (L9). Mỗi tình huống được chấm trên nhiều trục độc lập: định tuyến, nhận diện ý định, chọn mẫu truy vấn, tập bảng được đọc, sự hiện diện của SQL, đường sinh SQL và việc không phát sinh lỗi thực thi. Bộ đánh giá chạy ở hai chế độ không phụ thuộc khoá API hay cơ sở dữ liệu thật: chế độ \texttt{local} kiểm chứng phần định tuyến và chính sách tất định, còn chế độ \texttt{shadow-mock} chạy toàn bộ đồ thị xử lý kèm bước chèn RBAC và kiểm tra cú pháp trừu tượng với mô hình ngôn ngữ được thay bằng bản mô phỏng tất định. Nhờ vậy, mọi số liệu trong phần này đều có thể tái lập.

\begin{table}[H]
\centering
\caption{Kết quả bộ đánh giá tự động của AI Query}
\label{tab:ch5_ai_query_eval}
\begin{tabular}{lccc}
\hline
\textbf{Chế độ} & \textbf{Số case} & \textbf{Tỉ lệ đạt} & \textbf{Độ trễ p50/p95} \\
\hline
\texttt{local} (định tuyến, chính sách tất định) & 35 & 100,0\% & 2ms / 6ms \\
\texttt{shadow-mock} (toàn đồ thị + RBAC + AST) & 48 & 95,8\% & 38ms / 67ms \\
\hline
\end{tabular}
\end{table}

Ở chế độ \texttt{shadow-mock}, các trục liên quan trực tiếp đến an toàn đều đạt tuyệt đối: định tuyến, nhận diện ý định, đường sinh SQL và \emph{không phát sinh lỗi thực thi} đều ở mức 100\%; đặc biệt lớp câu hỏi đối kháng (L9) và lớp kiểm tra phạm vi cửa hàng (L5) đạt 100\%. Hai trường hợp chưa đạt nằm ở trục tập bảng: bản mô phỏng tất định chọn một bảng \emph{vẫn nằm trong danh sách cho phép} nhưng khác bảng kỳ vọng, nên đây là sai lệch của dữ liệu mô phỏng chứ không phải lỗ hổng quyền truy cập. Bên cạnh đó, 63 kiểm thử đơn vị cho các thành phần bảo mật (kiểm tra AST, chèn RBAC, chính sách bảng và ngữ cảnh xác thực) đều vượt qua.

Để định lượng riêng đóng góp của lớp kiểm tra cú pháp trừu tượng, một thực nghiệm cắt bỏ (ablation) được thực hiện trên một tập SQL không an toàn gồm 31 trường hợp đại diện cho bảy nhóm tấn công khác nhau: lệnh DDL/DML, ghép nhiều câu lệnh, trích xuất dữ liệu qua \texttt{UNION}, gọi hàm rủi ro đọc tài nguyên ngoài (\texttt{url}/\texttt{file}/\texttt{s3}/\texttt{remote}/\texttt{mysql}), chiếu rộng hoặc chiếu cột nhạy cảm, thiếu ràng buộc phạm vi cửa hàng và truy cập lược đồ ngoài danh sách cho phép. Song song, một tập sáu truy vấn hợp lệ được dùng để kiểm tra hiện tượng chặn nhầm.

\begin{table}[H]
\centering
\caption{Thực nghiệm cắt bỏ lớp kiểm tra AST của AI Query}
\label{tab:ch5_ai_query_guard}
\begin{tabular}{lcc}
\hline
\textbf{Cấu hình} & \textbf{SQL không an toàn bị chặn} & \textbf{Truy vấn hợp lệ giữ lại} \\
\hline
Tắt kiểm tra AST & 0 / 31 (0,0\%) & 6 / 6 \\
Bật kiểm tra AST & 31 / 31 (100,0\%) & 6 / 6 (100,0\%) \\
\hline
\end{tabular}
\end{table}

Kết quả cho thấy khi tắt lớp kiểm tra, toàn bộ các truy vấn nguy hiểm sẽ đi tới cơ sở dữ liệu; khi bật, cả ba mươi mốt trường hợp tấn công đều bị chặn trước khi thực thi, trong khi không có truy vấn hợp lệ nào bị chặn nhầm. Như vậy, hiệu quả của giải pháp không nằm ở việc tin tưởng mô hình ngôn ngữ tạo SQL đúng, mà ở chỗ mọi đầu ra của mô hình đều phải vượt qua một bộ luật tất định, có thể đo lường và tái lập được. Đây cũng chính là khác biệt cốt lõi giữa AI Query và một chatbot truy vấn tự do: phần bảo đảm an toàn được dịch chuyển từ "kỳ vọng mô hình hành xử đúng" sang "ràng buộc chương trình kiểm chứng được".
```

---

## 3. Ghi chú khi đưa vào đồ án

1. **Vị trí chèn:** đặt ngay sau tiểu mục `5.3.4 Kết quả đạt được`, trước `\endgroup`.
2. **Tham chiếu chéo:** có thể trỏ tới hai bảng bằng `Bảng~\ref{tab:ch5_ai_query_eval}` và `Bảng~\ref{tab:ch5_ai_query_guard}` trong phần thân.
3. **Gói LaTeX cần có:** `\usepackage{float}` (cho tùy chọn `[H]`). Nếu chưa dùng dấu phẩy thập phân tiếng Việt ở nơi khác thì giữ nguyên định dạng `100,0\%` cho nhất quán.
4. **Phụ lục:** nếu muốn đính kèm đầu ra chi tiết (đặc biệt bảng 31 lớp tấn công), tham chiếu tới `evals/REPORT.md` hoặc dán bảng 6.1 trong file đó vào phần Phụ lục.
5. **Câu trả lời nhanh khi hội đồng hỏi "đo thế nào":**
   - *"Em đánh giá bằng golden suite phân lớp L0–L9, chấm đa trục; chạy ở hai chế độ tái lập không cần LLM/DB thật."*
   - *"Riêng lớp kiểm tra AST, em làm thực nghiệm cắt bỏ trên 31 lớp tấn công: bật guard chặn 100%, không chặn nhầm truy vấn hợp lệ."*

# Khung bảo vệ AIA-gent trong FERN

Tài liệu này tổng hợp 3 đầu ra để dùng khi bảo vệ đồ án:
- Bài nói 1-2 phút
- Bảng so sánh `Dashboard FERN` và `AIA-gent`
- Bộ câu hỏi phản biện và câu trả lời ngắn

## 1. Bài nói 1-2 phút

Trong hệ thống FERN của em, `AIA-gent` không được đưa vào chỉ để có thêm một tính năng AI, mà nó đóng vai trò là một `AI Query Engine` nằm sau gateway, dùng để biến câu hỏi ngôn ngữ tự nhiên thành khả năng truy vấn, phân tích và diễn giải dữ liệu kinh doanh theo đúng quyền của người dùng.

Lý do em cần `AIA-gent` là vì FERN là một hệ thống ERP/POS nhiều module như sales, inventory, HR, finance. Dữ liệu đi qua nhiều service và được đồng bộ sang `ClickHouse`, đồng thời tài liệu nghiệp vụ và tri thức được đưa vào `OpenSearch`. Như vậy dữ liệu đã có, dashboard cũng đã có, nhưng người dùng nghiệp vụ vẫn thiếu một lớp khai thác dữ liệu linh hoạt. Họ không phải lúc nào cũng biết cần vào màn hình nào, xem KPI nào, hay tự kết hợp dữ liệu từ nhiều nguồn ra sao.

Dashboard hiện tại của FERN mạnh ở việc hiển thị các chỉ số đã được thiết kế trước, ví dụ KPI doanh thu, đơn hàng gần đây, tồn kho thấp. Nhưng dashboard chủ yếu trả lời câu hỏi “đang là bao nhiêu”, còn yếu ở các câu hỏi động như “vì sao outlet này doanh thu yếu”, “so sánh xu hướng giữa các cửa hàng”, hay “top sản phẩm nào kéo doanh thu xuống trong 7 ngày qua”. Muốn trả lời các câu đó bằng dashboard thì phải thiết kế thêm rất nhiều màn hình và bộ lọc cố định.

`AIA-gent` giải quyết đúng khoảng trống đó. Nó cho phép người dùng hỏi trực tiếp bằng tiếng Việt, sau đó `Supervisor` sẽ điều phối các specialist như `SQL Specialist` để truy vấn `ClickHouse`, `RAG Specialist` để truy xuất tài liệu từ `OpenSearch`, `Analysis Specialist` để diễn giải sâu hơn, và `Visualization Specialist` để hỗ trợ biểu diễn kết quả. Nghĩa là nó không chỉ hiển thị dữ liệu, mà còn giúp đi từ câu hỏi kinh doanh đến câu trả lời có căn cứ.

Điểm em muốn nhấn mạnh là giải pháp này phù hợp vì nó không phá kiến trúc hiện có. `AIA-gent` vẫn đi qua gateway, dùng `X-Internal-* headers`, áp dụng `RBAC`, có `AST guard`, `allow-list schema/table`, rate limit và audit. Vì vậy đây không phải AI dạng hộp đen, mà là một lớp intelligence có kiểm soát, đặt đúng vị trí trong kiến trúc FERN.

Chốt lại, dashboard trong FERN là lớp quan sát, còn `AIA-gent` là lớp truy vấn và phân tích động. Hai phần này bổ sung cho nhau. Điểm nổi bật của giải pháp không nằm ở chỗ có AI, mà ở chỗ AI được tích hợp đúng vào luồng dữ liệu, quyền truy cập và hạ tầng sẵn có của hệ thống.

## 2. Bảng so sánh nhanh

| Tiêu chí | Dashboard hiện tại của FERN | AIA-gent trong FERN |
|---|---|---|
| Vai trò chính | Quan sát KPI và dữ liệu đã thiết kế trước | Truy vấn, phân tích và diễn giải dữ liệu động |
| Cách sử dụng | Người dùng mở màn hình, đọc widget, tự suy luận | Người dùng hỏi bằng ngôn ngữ tự nhiên theo mục tiêu kinh doanh |
| Nguồn dữ liệu | Các API cố định như sales, inventory, product, org | `ClickHouse` (`analytics.ai_*`, `cdc.*`, `core.*`) và `OpenSearch` |
| Loại câu hỏi xử lý tốt | Câu hỏi đã biết trước, KPI định kỳ | Câu hỏi phát sinh, follow-up, đa chiều, cần suy luận nhiều bước |
| Khả năng mở rộng nghiệp vụ | Mỗi nhu cầu mới thường phải thêm widget/màn hình/filter | Có thể hỗ trợ nhiều câu hỏi mới mà không cần thiết kế thêm quá nhiều UI |
| Mức độ linh hoạt | Thấp đến trung bình | Cao hơn, vì có thể chọn specialist và nguồn dữ liệu phù hợp |
| Đầu ra | Số liệu tĩnh, bảng/watchlist, quick actions | `answer`, `workflow_steps`, `rows_preview`, `exports`, `suggestions`, `chart_spec` |
| Bảo mật/quyền | Phụ thuộc API nghiệp vụ đã có | Có thêm `RBAC injection`, `AST guard`, `allow-list schema/table`, audit |
| Hạn chế | Chỉ hiển thị cái đã được định nghĩa từ trước | Tốn token hơn, có độ trễ hơn, cần guardrail và observability |
| Khi nào nên dùng | Theo dõi vận hành thường xuyên, xem nhanh tình trạng hệ thống | Khai thác dữ liệu theo nhu cầu phát sinh, phân tích nguyên nhân, hỏi đáp linh hoạt |

## 3. Bộ phản biện thường gặp

### Câu 1. Tại sao lại dùng AIA-gent khi hệ thống đã có dashboard?

Vì dashboard của FERN chỉ mạnh ở việc hiển thị dữ liệu đã biết trước. Nó phù hợp để theo dõi KPI cố định, nhưng không phù hợp cho các câu hỏi phát sinh, đa chiều hoặc cần nối nhiều bước suy luận. `AIA-gent` được thêm vào để lấp khoảng trống giữa dữ liệu sẵn có và khả năng khai thác dữ liệu linh hoạt của người dùng.

### Câu 2. Tác dụng thực tế của AIA-gent là gì?

Nó cho phép người dùng hỏi trực tiếp bằng tiếng Việt thay vì phải biết cấu trúc dữ liệu. Sau đó hệ thống tự điều phối specialist để truy vấn dữ liệu, lấy tri thức tài liệu, phân tích và trả kết quả theo đúng quyền truy cập. Tác dụng thực tế là giảm thao tác tay, giảm phụ thuộc vào analyst và tăng tốc độ khai thác insight.

### Câu 3. Nó làm được gì mà dashboard không làm được?

Nó xử lý được các câu hỏi động chưa được thiết kế sẵn trên UI, tự chọn nguồn dữ liệu phù hợp, có thể kết hợp truy vấn dữ liệu và tài liệu, rồi diễn giải kết quả thành câu trả lời hoàn chỉnh. Dashboard chủ yếu trả lời “đang là bao nhiêu”, còn `AIA-gent` có thể tiến gần hơn tới “vì sao như vậy” và “nên xem tiếp theo hướng nào”.

### Câu 4. Tại sao phải tốn token?

Token là chi phí cho phần suy luận linh hoạt. Nếu bài toán đã cố định và lặp lại, dashboard hoặc workflow thường rẻ hơn và phù hợp hơn. Nhưng với các câu hỏi mở, dữ liệu đa nguồn, hoặc yêu cầu diễn giải theo ngữ cảnh, nếu không dùng agent thì phải viết rất nhiều nhánh logic hoặc cần con người phân tích thủ công. Trong trường hợp đó, token đổi lấy tính linh hoạt và tốc độ khai thác dữ liệu.

### Câu 5. Vậy có phải chỗ nào cũng nên dùng agent không?

Không. Trong FERN, agent chỉ nên dùng ở chỗ cần phân tích động, hỏi đáp dữ liệu, ngoại lệ hoặc truy vấn phát sinh. Những luồng ổn định, lặp lại, có cấu trúc rõ thì vẫn nên dùng service nghiệp vụ, API cố định hoặc dashboard để rẻ hơn và dễ kiểm soát hơn.

### Câu 6. Kiến trúc của AIA-gent trong FERN là gì?

Nó là một service FastAPI độc lập ở `:8093`, đứng sau gateway và giữ nguyên contract `/api/v1/ai-query/*`. Frontend gọi qua gateway, gateway truyền `X-Internal-* headers`, rồi `AIA-gent` dùng `Supervisor + Specialist` để điều phối `SQL`, `RAG`, `Analysis`, `Visualization`. Phía dưới còn có `RBAC`, `AST guard`, `allow-list`, rate limit, audit và readiness check.

### Câu 7. Nếu dùng AI thì có rủi ro bảo mật không?

Có, nên trong thiết kế này agent không được quyền tự do. Nó chỉ truy cập các schema/table nằm trong allow-list, bị chặn hàm nguy hiểm, bị inject `outlet_id` theo auth context và bị audit lại. Nói cách khác, quyền dữ liệu không do LLM tự quyết mà do code và policy kiểm soát.

### Câu 8. Tại sao giải pháp của em nổi bật và phù hợp?

Vì `AIA-gent` không phải phần AI gắn thêm bên ngoài, mà được đặt đúng trong kiến trúc FERN: sau gateway, gắn với auth, RBAC, ClickHouse, OpenSearch và frontend hiện có. Nó tận dụng hạ tầng sẵn có của hệ thống thay vì tạo một demo tách rời. Điểm nổi bật là mức độ tích hợp kiến trúc và guardrail, không chỉ là khả năng chat.

### Câu 9. Hướng tích hợp phù hợp trong tương lai là gì?

Các hướng phù hợp nhất là:
- Mở rộng `Visualization Specialist`
- Lưu session/persistent memory tốt hơn
- Bổ sung streaming hoặc job queue cho truy vấn dài
- Hoàn thiện audit/learning loop
- Tối ưu chi phí bằng local model cho các bước đơn giản như phân loại hoặc preprocess

### Câu 10. Một câu chốt ngắn để trả lời hội đồng?

`Dashboard của FERN giúp quan sát dữ liệu đã biết trước, còn AIA-gent giúp khai thác và diễn giải dữ liệu theo nhu cầu phát sinh. Em dùng AIA-gent không phải để thay dashboard, mà để bổ sung lớp intelligence có kiểm soát vào đúng chỗ mà dashboard và workflow truyền thống chưa giải quyết tốt.`

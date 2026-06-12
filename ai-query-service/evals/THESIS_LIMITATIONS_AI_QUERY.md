# Hạn chế và hướng phát triển của AI Query (LaTeX)

> Phần này có thể đặt sau mục `5.3.5 Đánh giá hiệu quả`, hoặc chuyển sang
> chương kết luận/hướng phát triển. Nội dung được viết theo hướng trung thực:
> thừa nhận các điểm cần hardening nhưng không làm giảm giá trị kiến trúc hiện tại.

## Bản LaTeX đề xuất

```latex
\subsection{Hạn chế và hướng phát triển}
\label{subsection:5.3.6}

Mặc dù kết quả đánh giá cho thấy AI Query đạt độ an toàn cao trên bộ kiểm thử hiện tại, một số điểm vẫn cần được hoàn thiện trước khi triển khai ở quy mô sản xuất lớn. Các hạn chế này chủ yếu nằm ở khả năng chịu lỗi và cơ chế bảo vệ vận hành, không làm thay đổi nguyên tắc thiết kế cốt lõi của hệ thống: mô hình ngôn ngữ không được truy cập trực tiếp cơ sở dữ liệu, mà luôn bị ràng buộc bởi chính sách bảng, chèn RBAC, kiểm tra AST và giới hạn thực thi.

Thứ nhất, cơ chế xác thực nội bộ hiện sử dụng một shared secret giữa Gateway và AI Query, được so sánh bằng hàm an toàn thời gian để tránh timing attack. Cách làm này phù hợp cho môi trường nội bộ có kiểm soát, nhưng shared secret là thông tin xác thực dài hạn; nếu bị rò rỉ, yêu cầu có thể bị phát lại cho đến khi secret được xoay vòng. Hướng cải tiến là thay shared secret tĩnh bằng token ký số có thời hạn ngắn, chứa nonce hoặc \texttt{jti} để chống phát lại, đồng thời bổ sung chính sách rotation định kỳ.

Thứ hai, bộ giới hạn tần suất hiện dùng Redis và Lua script để tăng bộ đếm một cách nguyên tử, tránh lỗi race condition. Tuy nhiên, hệ thống đang ưu tiên tính sẵn sàng bằng chính sách fail-open: khi Redis lỗi, yêu cầu vẫn được cho qua. Với dịch vụ có thể gọi mô hình ngôn ngữ và phát sinh chi phí, đây là một đánh đổi cần được kiểm soát ở môi trường sản xuất. Hướng cải tiến là bổ sung circuit breaker tại Gateway hoặc quota cục bộ tạm thời, để khi Redis không khả dụng hệ thống vẫn giữ được một mức bảo vệ tối thiểu trước lạm dụng và cost spike.

Thứ ba, dịch vụ hiện hỗ trợ endpoint tương thích OpenAI và có retry ở mức SDK, nhưng chưa có cơ chế fallback sang nhà cung cấp hoặc mô hình khác khi provider chính không khả dụng. Đây là điểm lỗi đơn quan trọng nhất đối với các nhánh cần LLM như tác tử điều phối và SQL Writer. Hướng cải tiến là bổ sung provider fallback, model failover hoặc chế độ suy giảm chức năng: khi LLM không sẵn sàng, hệ thống chỉ dùng các truy vấn mẫu đã kiểm chứng và trả lời làm rõ thay vì sinh SQL mới.

Thứ tư, đồ thị xử lý hiện có trace và audit theo từng bước, nhưng checkpoint persistence và timeout theo từng node chưa phải là một phần bắt buộc của đường chạy mặc định. Với các truy vấn dài hoặc lỗi treo ở node gọi LLM, hệ thống nên có ngân sách thời gian rõ ràng cho từng node và cơ chế huỷ an toàn. Hướng cải tiến là cấu hình checkpoint store có TTL, timeout theo node và chính sách trả lời suy giảm khi một nhánh xử lý vượt quá ngân sách thời gian.

Cuối cùng, cơ chế audit hiện không lưu kết quả thô, có băm SQL và che các mẫu thông tin cá nhân phổ biến như số điện thoại, email và CCCD. Tuy nhiên, đây vẫn là lớp che thông tin dựa trên mẫu regex bảo thủ, chưa thể bảo đảm che hết mọi thông tin nhạy cảm trong câu hỏi tự do. Nếu hệ thống mở rộng sang nhiều loại dữ liệu nhạy cảm hơn, cần bổ sung bộ phát hiện PII mạnh hơn hoặc chính sách giảm thiểu dữ liệu đầu vào trước khi ghi log.

Nhìn chung, các hướng phát triển trên tập trung vào hardening vận hành: chống phát lại token, giữ giới hạn chi phí khi Redis lỗi, tăng tính sẵn sàng của LLM provider, kiểm soát timeout của đồ thị và tăng chất lượng ẩn danh hoá audit. Chúng không thay thế kiến trúc hiện tại mà củng cố thêm cho nguyên tắc chính của AI Query: mọi quyết định truy cập dữ liệu phải được kiểm soát bằng luật tất định và có khả năng kiểm chứng, thay vì đặt niềm tin trực tiếp vào đầu ra của mô hình ngôn ngữ.
```

## Bản rút gọn để trả lời phản biện

Nếu hội đồng hỏi "hệ thống còn hạn chế gì?", có thể trả lời:

> Hạn chế chính hiện không nằm ở lớp sinh SQL hay kiểm soát quyền, vì phần đó đã
> có RBAC injection, AST guard, readonly ClickHouse và audit. Các điểm cần cải
> thiện chủ yếu là hardening vận hành: shared secret nội bộ nên được thay bằng
> token ngắn hạn có nonce hoặc `jti`; rate-limit hiện fail-open khi Redis lỗi nên
> cần circuit breaker để tránh cost spike; và LLM provider hiện có retry nhưng
> chưa có provider fallback. Đây là các bước nâng cấp cho production, còn nguyên
> tắc an toàn dữ liệu của kiến trúc hiện tại vẫn giữ được.

## Ba gạch đầu dòng nên nhớ khi bảo vệ

1. **Token:** hiện là shared secret tĩnh + `compare_digest`, không phải time-based token; cải tiến là short-lived signed token + `jti`/nonce + rotation.
2. **Rate limit:** Redis Lua atomic là đúng, nhưng fail-open cần thêm circuit breaker/local quota khi production.
3. **LLM:** có retry SDK, nhưng chưa có fallback provider; khi provider down nên degrade về verified templates/clarification.

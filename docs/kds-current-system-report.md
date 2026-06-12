# Báo cáo hệ thống hiển thị bếp (KDS)

Tài liệu này tổng hợp phần hệ thống bếp đã hoàn thiện trong FERN và so sánh kiến trúc hiện tại với cách hiển thị FIFO truyền thống, phục vụ đưa vào báo cáo.

## 1. Mục tiêu hệ thống bếp

Kitchen Display System (KDS) là màn hình vận hành cho nhân viên bếp/bar, dùng để nhận ticket từ POS, theo dõi trạng thái từng món, cảnh báo trễ SLA và đồng bộ realtime khi đơn hàng thay đổi.

Trong FERN, KDS không phải là một hệ thống tách rời mà là một phân hệ nằm trong `sales-service`, vì ticket bếp được sinh ra từ vòng đời đơn bán (`sale_record`). Frontend hiển thị qua trang `KitchenDisplayPage`, backend quản lý dữ liệu qua `kitchen_ticket` và `kitchen_ticket_item`.

## 2. Những phần đã làm được

### 2.1. Mô hình dữ liệu KDS

Hệ thống đã có hai bảng chính trong PostgreSQL:

| Bảng | Vai trò |
|---|---|
| `core.kitchen_ticket` | Ticket bếp cấp đơn hàng, lưu thông tin sale, outlet, bàn, loại đơn, trạng thái, SLA, thời điểm tạo/bắt đầu/ready/served. |
| `core.kitchen_ticket_item` | Danh sách món trong ticket, snapshot tên món, số lượng, modifier, allergen, ghi chú và trạng thái từng món. |

Thiết kế này dùng **snapshot model**: tên món, modifier, allergen được chụp tại thời điểm tạo ticket. Nhờ vậy KDS vẫn đọc được lịch sử đúng ngay cả khi sản phẩm đổi tên, đổi modifier hoặc product-service không sẵn sàng.

### 2.2. Vòng đời ticket và item

Ticket bếp có state machine:

```text
new -> in_progress -> ready -> served
  \                         \
   \-----------------------> cancelled
```

Item trong ticket có state machine:

```text
new -> preparing -> ready -> served
  \                         \
   \-----------------------> cancelled
```

Backend kiểm soát transition để tránh cập nhật trạng thái sai thứ tự. Ví dụ, món `new` chỉ được chuyển sang `preparing` hoặc `cancelled`; món đã `served` hoặc `cancelled` là trạng thái kết thúc.

### 2.3. Tạo ticket từ đơn hàng

KDS ticket được tạo khi đơn được duyệt/confirm:

- POS/staff tạo đơn: `sale_record.status = order_created`.
- Staff duyệt hoặc confirm đơn public QR: `sale_record.status = order_approved`.
- Sau khi approve, `KitchenTicketService.createFromSale(...)` tạo ticket bếp.
- Ticket được tạo idempotent theo `sale_id`, tránh sinh trùng ticket khi retry.

Lý do chọn điểm tạo ticket ở bước approve: bếp chỉ nhận đơn đã được xác nhận, tránh chế biến nhầm đơn khách chưa được duyệt.

### 2.4. Hủy ticket khi đơn bị hủy

Phần đã bổ sung: khi sale bị `cancel`, `void` hoặc refund path dẫn tới hủy đơn, hệ thống tự động hủy kitchen ticket tương ứng.

Luồng xử lý:

```text
cancel/void/refund sale
        |
        v
SalesService.cancelKitchenTicket(saleId)
        |
        v
KitchenTicketService.cancelBySale(saleId)
        |
        v
KitchenTicketRepository.cancelTicketBySale(saleId)
        |
        v
ticket + item chưa terminal -> cancelled
        |
        v
broadcast realtime để màn hình bếp gỡ ticket
```

Điểm quan trọng: hook hủy ticket là **idempotent** và không throw ngược lên nghiệp vụ sale. Nếu KDS lỗi, việc hủy đơn vẫn không bị chặn.

### 2.5. Realtime và fallback

Frontend KDS nhận realtime event qua WebSocket:

- `kitchen.ticket.created`
- `kitchen.ticket.updated`
- `kitchen.sla.breached`

Ngoài WebSocket, frontend vẫn hydrate định kỳ bằng REST mỗi 30 giây. Điều này giúp màn hình tự phục hồi nếu mất kết nối WebSocket ngắn hạn.

### 2.6. SLA động và thuật toán hiển thị hiện tại

Trước đây ticket có SLA cố định 900 giây. Kiến trúc hiện tại đã chuyển sang SLA động tuyến tính:

```text
prepSla = baseSeconds + perItemSeconds * totalUnits
```

Mặc định:

```text
baseSeconds = 120
perItemSeconds = 60
```

Ví dụ:

| Đơn | Số món | SLA |
|---|---:|---:|
| 1 món | 1 | 180s |
| 3 món | 3 | 300s |
| 8 món | 8 | 600s |

Ticket sau đó được sắp xếp bằng **EDF (Earliest Deadline First)**:

```text
deadline = createdAt + prepSlaSeconds
```

Ticket có deadline gần nhất được hiển thị trước. Nếu nhiều ticket có cùng deadline, hệ thống dùng `createdAt` làm tie-break để giữ tính FIFO.

## 3. Kiến trúc hiện tại

### 3.1. Backend

| Thành phần | Vai trò |
|---|---|
| `KitchenTicketService` | Orchestrate tạo/hủy/list ticket, tính SLA động, gọi sync publisher. |
| `KitchenTicketRepository` | Thao tác DB, quản lý state machine item/ticket, rollup trạng thái ticket. |
| `KitchenScheduling` | Class thuần chứa thuật toán SLA động và comparator EDF. |
| `KitchenSlaJob` | Scheduled job quét ticket quá SLA và phát cảnh báo realtime. |
| `KitchenSyncPublisher` | Gửi event realtime sang gateway/WebSocket. |

### 3.2. Frontend

| Thành phần | Vai trò |
|---|---|
| `KitchenDisplayPage.tsx` | Màn hình bếp fullscreen, dark UI, hiển thị ticket, all-day items, SLA progress, filter trạng thái. |
| `kitchen-api.ts` | API client gọi REST `/api/v1/sales/kitchen/tickets`. |
| WebSocket `/ws/sync/{outletId}` | Nhận ticket created/updated/SLA breach realtime. |

Frontend mirror lại comparator EDF để các ticket vừa nhận qua WebSocket vẫn giữ đúng thứ tự trước khi hydrate lại từ backend.

## 4. So sánh FIFO và kiến trúc hiện tại

### 4.1. FIFO truyền thống

FIFO (First In, First Out) xử lý ticket theo thời điểm vào hàng đợi:

```text
ticket nào tạo trước -> hiển thị trước
```

Ví dụ:

```text
A tạo 10:00
B tạo 10:01
C tạo 10:02

FIFO: A -> B -> C
```

Ưu điểm:

- Rất dễ hiểu.
- Công bằng theo thứ tự đến.
- Dễ triển khai, ít dữ liệu đầu vào.

Nhược điểm:

- Không xét độ lớn của đơn.
- Không xét deadline/SLA.
- Đơn nhỏ nhưng cần ra nhanh vẫn phải chờ sau đơn lớn.
- Dễ làm tăng thời gian chờ cảm nhận của khách ở các đơn nhỏ.

### 4.2. Kiến trúc hiện tại: Dynamic SLA + EDF

Kiến trúc hiện tại không chỉ nhìn thời điểm tạo ticket mà tính deadline theo khối lượng công việc:

```text
prepSla = 120 + 60 * totalUnits
deadline = createdAt + prepSla
sort by deadline ASC, tie-break by createdAt ASC
```

Ví dụ:

| Ticket | Created | Số món | SLA | Deadline |
|---|---|---:|---:|---|
| A | 10:00 | 8 | 600s | 10:10 |
| B | 10:01 | 1 | 180s | 10:04 |
| C | 10:02 | 3 | 300s | 10:07 |

Kết quả:

```text
FIFO cũ: A -> B -> C
EDF hiện tại: B -> C -> A
```

Ý nghĩa:

- A vào trước nhưng là đơn lớn, deadline xa hơn.
- B vào sau nhưng chỉ có 1 món, deadline gần nhất, nên được ưu tiên.
- C đứng giữa vì deadline nằm giữa B và A.

### 4.3. Bảng so sánh

| Tiêu chí | FIFO cũ | Kiến trúc hiện tại (Dynamic SLA + EDF) |
|---|---|---|
| Tiêu chí sắp xếp | `createdAt` | `createdAt + prepSlaSeconds` |
| Có xét số lượng món không | Không | Có |
| Có xét SLA/deadline không | Không | Có |
| Công bằng theo thứ tự đến | Cao | Có khi deadline bằng nhau |
| Phù hợp đơn nhỏ cần ra nhanh | Kém | Tốt hơn |
| Rủi ro đơn lớn chặn hàng đợi | Cao | Giảm đáng kể |
| Dễ giải thích | Rất dễ | Dễ, có cơ sở lý thuyết EDF |
| Tối ưu chính | Công bằng theo arrival | Giảm trễ deadline / giảm max lateness |
| Khả năng cấu hình | Gần như không | Có `baseSeconds`, `perItemSeconds` |
| Tương thích hành vi cũ | Chính là hành vi cũ | Suy biến về FIFO nếu SLA bằng nhau |

## 5. Lý do chọn kiến trúc hiện tại

### 5.1. Có cơ sở lý thuyết

EDF là thuật toán lập lịch kinh điển trong real-time scheduling. Với mô hình một máy và deadline, EDF là lựa chọn tự nhiên để ưu tiên công việc có hạn hoàn thành gần nhất.

### 5.2. Không phá vỡ FIFO

Nếu mọi ticket có cùng `prepSlaSeconds`, thì:

```text
deadline = createdAt + constant
```

Khi đó thứ tự EDF giống FIFO. Điều này cho thấy kiến trúc hiện tại là **tổng quát hóa của FIFO**, không phải thay đổi tùy tiện.

### 5.3. Phù hợp nghiệp vụ quán đồ uống

Trong quán đồ uống/đồ ăn nhanh:

- Đơn 1 món không nên chờ sau đơn 8 món chỉ vì đến sau 1 phút.
- Đơn takeaway/delivery thường cần kiểm soát deadline chặt hơn.
- Bếp cần nhìn được ticket sắp trễ để xử lý sớm.

Dynamic SLA + EDF giải quyết tốt các điểm này trong khi vẫn giữ thuật toán đơn giản, dễ test và dễ vận hành.

## 6. Điểm khác biệt nghiệp vụ sau khi cải tiến

### Trước cải tiến

```text
Ticket mới -> sắp xếp FIFO theo createdAt -> bếp làm theo thứ tự cũ nhất
```

Hạn chế:

- Đơn lớn có thể chiếm đầu hàng.
- Đơn nhỏ vào sau bị chậm.
- SLA hiển thị không phản ánh độ phức tạp đơn.
- Sale bị hủy không tự động gỡ ticket bếp.

### Sau cải tiến

```text
Ticket mới -> tính SLA động -> tính deadline -> sắp EDF -> hiển thị realtime
Sale bị hủy -> tự hủy ticket bếp -> broadcast cập nhật
```

Lợi ích:

- Ticket hiển thị theo deadline gần nhất.
- SLA phản ánh tương đối số lượng món.
- Màn hình bếp giảm rủi ro chế biến đơn đã hủy.
- Frontend và backend cùng một policy hiển thị.
- Có unit test cho thuật toán và state behavior.

## 7. Kiểm thử và build

Các phần đã kiểm tra:

| Hạng mục | Kết quả |
|---|---|
| Unit test KDS scheduling | Pass |
| Unit test Kitchen controller/service | Pass |
| Maven build `sales-service` kèm dependencies | Pass |
| Frontend typecheck/build | Pass |

Lệnh đã dùng:

```sh
mvn -q -pl services/sales-service -am clean package
cd frontend && npm run build
```

## 8. Hạn chế hiện tại và hướng phát triển

Hạn chế hiện tại:

- SLA động mới dựa trên số lượng món, chưa dựa trên thời gian chế biến riêng từng sản phẩm.
- Chưa có routing theo station (`bar`, `kitchen`, `expo`).
- Chưa có chế độ Round-Robin item queue để xoay vòng từng món giữa các đơn.
- Realtime kitchen event đang đi qua WebSocket/gateway, chưa có outbox/Kafka bền vững riêng cho KDS.

Hướng phát triển:

1. Thêm `prep_seconds` theo sản phẩm hoặc category để SLA chính xác hơn.
2. Thêm station routing cho từng món.
3. Thêm chế độ hiển thị Round-Robin item queue: A một món, B một món, C một món lần lượt.
4. Bổ sung Kafka/outbox event cho thay đổi ticket bếp nếu cần audit/replay mạnh hơn.

## 9. Kết luận

So với FIFO truyền thống, kiến trúc hiện tại của KDS trong FERN đã tiến thêm một bước từ hàng đợi tuyến tính sang lập lịch theo deadline. Hệ thống hiện có đủ các phần cốt lõi: dữ liệu ticket/item, state machine, realtime update, SLA động, EDF scheduling, auto-cancel khi sale bị hủy và frontend hiển thị bếp.

FIFO phù hợp khi mọi đơn giống nhau và mục tiêu chỉ là công bằng theo thứ tự đến. Tuy nhiên, với bối cảnh POS nhà hàng/quán đồ uống, đơn hàng khác nhau về số lượng món và deadline phục vụ, **Dynamic SLA + EDF** phù hợp hơn vì vừa đơn giản, vừa có cơ sở lý thuyết, vừa cải thiện khả năng ưu tiên các ticket cần hoàn thành sớm.


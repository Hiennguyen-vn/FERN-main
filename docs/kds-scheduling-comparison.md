# So sánh thuật toán lập lịch hiển thị bếp (KDS Scheduling)

Tài liệu này so sánh các thuật toán điều phối/hiển thị ticket cho Kitchen Display System (KDS)
của FERN, phục vụ việc lựa chọn và bảo vệ thuật toán. Trạng thái hiện tại của hệ thống:

- Hạ tầng KDS có sẵn từ migration `V79` (`core.kitchen_ticket`, `core.kitchen_ticket_item`).
- Thuật toán hiển thị hiện đang dùng: **EDF (Earliest Deadline First)** với SLA động tuyến tính,
  cài đặt tại `services/sales-service/.../kitchen/KitchenScheduling.java` và mirror ở frontend
  `frontend/src/pages/KitchenDisplayPage.tsx`.

## 1. Mô hình hóa bài toán

Coi bếp như bài toán **lập lịch 1 máy** (single-machine scheduling):

| Khái niệm lập lịch | Ánh xạ trong bếp |
|---|---|
| Máy (machine) | 1 đầu bếp / 1 trạm chế biến (xử lý tuần tự) |
| Job / đơn vị công việc | 1 món trong ticket |
| Đơn (ticket) | Nhóm món cùng một bàn / một khách |
| Deadline | `createdAt + prepSlaSeconds` |
| Quantum (Round-Robin) | Lượng công việc mỗi lượt = 1 món |

Ba chỉ số đánh giá:

- **Response time**: thời gian đến *món đầu tiên* của mỗi đơn (khách thấy "có đồ ra").
- **Completion time**: thời gian *hoàn tất cả đơn*.
- **Fairness**: mức đồng đều giữa các bàn / chống starvation (bỏ đói).

## 2. Các thuật toán ứng viên

| Thuật toán | Quy tắc | Tối ưu hóa | Nguồn gốc kinh điển |
|---|---|---|---|
| **FIFO / FCFS** | Làm hết đơn đến trước rồi sang đơn sau | Công bằng theo thứ tự đến | Hàng đợi, OS |
| **EDF (Earliest Deadline First)** | Ưu tiên đơn có deadline gần nhất | Min max-lateness (định lý Jackson, 1955) | Real-time scheduling |
| **SPT (Shortest Processing Time)** | Món/đơn nhanh nhất trước | Min thời gian chờ trung bình | Job-shop dispatching |
| **Round-Robin (RR)** | Xoay vòng, mỗi lượt 1 món/đơn | Min response time TB + fairness | CPU scheduling (OS) |
| **EDF + Round-Robin** *(đề xuất nâng cao)* | EDF xếp thứ tự trong vòng, RR xoay vòng từng món | Vừa tránh trễ vừa đều tay | Hybrid |

### Mô hình SLA động (đang dùng cho EDF)

```text
prepSla = base-seconds + per-item-seconds × tổng_số_đơn_vị
```

Mặc định: `base = 120s`, `per-item = 60s` (cấu hình tại `fern.kitchen.sla.*`).
Ví dụ: 1 món → 180s; đơn 5 món → 420s. Deadline = `createdAt + prepSla`.

Đặc tính quan trọng: khi mọi đơn có cùng SLA, EDF **suy biến về FIFO** → là tổng quát hóa
của hành vi cũ, không phá vỡ tương thích.

## 3. Ví dụ số minh họa

Giả định: 1 đầu bếp, 3 đơn cùng đến lúc `t = 0`, mỗi món mất **2 phút**.

| Đơn | Số món |
|---|---|
| A | 3 |
| B | 1 |
| C | 2 |

Tổng: 6 món × 2 phút = 12 phút.

Trình tự xử lý và kết quả (đơn vị: phút):

| Thuật toán | Trình tự món | Response A / B / C | Response TB | Max response | Completion A / B / C |
|---|---|---|---|---|---|
| **FIFO** | A₁ A₂ A₃ · B₁ · C₁ C₂ | 2 / 8 / 12 | **7.33** | 12 | 6 / 8 / 12 |
| **EDF** ¹ | B₁ · C₁ C₂ · A₁ A₂ A₃ | 8 / 2 / 4 | 4.67 | 8 | 12 / 2 / 6 |
| **Round-Robin** | A₁ B₁ C₁ · A₂ C₂ · A₃ | 2 / 4 / 6 | **4.0** | **6** | 12 / 4 / 10 |

¹ EDF với deadline B(3′) < C(4′) < A(5′).

Diễn giải:

- **Round-Robin** cho **response time trung bình tốt nhất (4.0′)** và **max response nhỏ nhất (6′)**
  → mọi bàn đều có món ra sớm, không bàn nào chờ tới cuối. Đây đúng là yêu cầu
  "A một món, B một món, C một món, lần lượt".
- **FIFO** làm đơn lớn A xong sớm nhất (6′) nhưng B, C chờ rất lâu mới thấy món đầu.
- **EDF** bảo vệ deadline (B, C nhỏ xong trước) nhưng đơn lớn A phải chờ đến cuối mới bắt đầu.

## 4. Round-Robin chi tiết

Thay vì xử lý hết một đơn rồi mới sang đơn khác, Round-Robin luân phiên lấy 1 đơn vị công việc
(1 món) từ mỗi đơn theo vòng:

```text
Vòng 1:  A₁ → B₁ → C₁
Vòng 2:  A₂ →      C₂      (B đã hết món, bỏ qua)
Vòng 3:  A₃ → ...
```

- **Quantum** = lượng công việc mỗi lượt; ở đây = 1 món. Quantum càng nhỏ càng công bằng.
- Thứ tự *bắt đầu vòng* nên do một luật ưu tiên quyết định. Kết hợp tốt nhất là **EDF rồi RR**:
  EDF xếp thứ tự A/B/C trong mỗi vòng theo deadline, RR đảm bảo không đơn nào bị bỏ đói.

## 5. Đánh đổi (trade-offs)

| Ưu điểm Round-Robin | Nhược điểm Round-Robin |
|---|---|
| Công bằng tuyệt đối giữa các bàn | **Mất hiệu quả gom mẻ (batching)** — làm xen kẽ có thể chậm hơn gộp món giống nhau |
| Response time mỗi khách thấp nhất | Đơn lớn hoàn tất muộn hơn FIFO |
| Chống starvation hoàn toàn | Nhiều "chuyển ngữ cảnh" giữa món → overhead thao tác thật |
| Triển khai O(n), dễ giải thích | Không tối ưu deadline như EDF |

Câu chốt khi bảo vệ:

> Round-Robin tối ưu *trải nghiệm từng bàn* (response time + fairness), đổi lại hy sinh
> *throughput tổng* và hiệu quả gom mẻ. Vì vậy phù hợp quán phục vụ tại chỗ nhiều bàn, nơi
> "khách nào cũng thấy món ra" quan trọng hơn "xong sớm một đơn".

## 6. Khuyến nghị: lai EDF + Round-Robin

Kết hợp khắc phục nhược điểm của cả hai:

1. **EDF** quyết định *thứ tự các đơn trong mỗi vòng* (đơn sắp trễ đứng đầu vòng).
2. **Round-Robin** đảm bảo *mỗi vòng mỗi đơn được 1 món* (công bằng, không bỏ đói).

Kết quả: vừa ưu tiên đơn gấp, vừa để mọi bàn thấy món ra đều. Đây là lựa chọn dễ bảo vệ nhất vì
trả lời được cả hai câu hỏi: "tại sao không để đơn trễ?" và "tại sao không bỏ rơi bàn nhỏ?".

### Hướng triển khai (khi cần)

- **Backend**: thêm hàm thuần `roundRobinItemOrder(tickets)` cạnh `KitchenScheduling`, trả về
  danh sách món đã interleave (EDF xếp thứ tự vòng + RR xoay vòng).
- **Frontend**: thêm một **chế độ xem mới "hàng đợi món" (item work-queue)** bên cạnh chế độ
  "thẻ ticket EDF" hiện tại, để bếp chọn cách hiển thị phù hợp ca làm.

## 7. Tóm tắt lựa chọn

| Bối cảnh | Thuật toán nên dùng |
|---|---|
| Mọi món tương đương, cần đơn giản | FIFO |
| Có ràng buộc thời hạn (takeaway/delivery) | **EDF** (đang dùng) |
| Nhiều bàn tại chỗ, cần mọi bàn có món đều | **Round-Robin** |
| Vừa tránh trễ vừa công bằng | **EDF + Round-Robin** (khuyến nghị) |

## Tham chiếu mã nguồn

- `services/sales-service/src/main/java/com/fern/services/sales/application/kitchen/KitchenScheduling.java`
  — policy thuần (SLA động + comparator EDF).
- `services/sales-service/src/main/java/com/fern/services/sales/application/kitchen/KitchenTicketService.java`
  — tạo ticket với SLA động, liệt kê ticket theo EDF.
- `services/sales-service/src/test/java/com/fern/services/sales/application/kitchen/KitchenSchedulingTest.java`
  — kiểm thử SLA tuyến tính, EDF, suy biến FIFO.
- `frontend/src/pages/KitchenDisplayPage.tsx` — sắp xếp EDF phía client (mirror backend).

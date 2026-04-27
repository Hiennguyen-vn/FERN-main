# FERN POS — Hướng dẫn vận hành pilot (Phase 8)

**Dành cho**: Nhân viên thu ngân, Quản lý ca  
**Môi trường**: PWA trên máy tính / tablet tại quầy  
**Phiên bản**: MVP 1.0

---

## 1. Mở ca (đầu ngày / đầu ca)

1. Mở trình duyệt → vào `http://pos.local` (hoặc IP quầy)
2. Đăng nhập bằng username + mật khẩu FERN
3. Màn hình tự chuyển sang **Mở ca**
4. Đếm tiền lẻ mặt trong két → nhập số tiền vào ô "Tiền mặt đầu ca"
5. Bấm **Xác nhận mở ca**
6. Màn hình chuyển sang giao diện bán hàng

> **Mất mạng lúc mở ca?**  
> Hệ thống tự chuyển sang chế độ offline. Đăng nhập vẫn thành công nếu tài khoản đã từng đăng nhập online trong vòng 24 giờ. Dữ liệu ca sẽ sync lên máy chủ khi có mạng trở lại.

---

## 2. Bán hàng

1. Giao diện hiển thị menu sản phẩm
2. Bấm sản phẩm → thêm vào giỏ (bấm nhiều lần để tăng số lượng)
3. Sản phẩm **xám / không bấm được** = hết nguyên liệu
4. Bấm **Thanh toán** (góc phải dưới)
5. Chọn phương thức: Tiền mặt / Chuyển khoản / Thẻ
6. Nếu thanh toán tiền mặt: nhập số tiền khách đưa → hệ thống tính tiền thừa
7. Bấm **Xác nhận** → hóa đơn in tự động

> **Mất mạng giữa ca?**  
> Tiếp tục bán bình thường. Đơn hàng được lưu cục bộ và sẽ tự đồng bộ khi có mạng. Biểu tượng WiFi góc trên = đang online; dấu X đỏ = offline (bình thường trong vòng 24h).

---

## 3. Ghi thất thoát (Waste)

Dùng khi: đổ vỡ, hết hạn, kiểm tra chất lượng, hàng hỏng.

1. Bấm nút **Thất thoát** (màu vàng, góc trên màn hình bán hàng)
2. Chọn nguyên liệu bị thất thoát
3. Nhập số lượng
4. Chọn lý do: SPILL / EXPIRED / TEST / DAMAGED / OTHER
5. Thêm ghi chú nếu cần
6. Bấm **Xác nhận**

> **Lưu ý**: Thất thoát số lượng lớn có thể yêu cầu PIN quản lý (>= ngưỡng cấu hình). Mọi bản ghi thất thoát đều được lưu với lý do — quản lý có thể xem báo cáo cuối ngày.

---

## 4. Đóng ca (cuối ngày / cuối ca)

1. Bấm menu (3 gạch) → **Đóng ca**
2. Đếm toàn bộ tiền mặt trong két
3. Nhập số tiền thực đếm vào ô "Tiền mặt thực tế"
4. Hệ thống hiển thị:
   - Tiền mặt kỳ vọng = tiền đầu ca + doanh thu cash - chi quỹ
   - Chênh lệch = thực tế - kỳ vọng
5. Nếu chênh lệch < 50,000 VND: bấm **Xác nhận đóng ca**
6. Nếu chênh lệch ≥ 50,000 VND: cần PIN quản lý + nhập ghi chú giải thích

> **Không đóng ca trước khi in báo cáo ca!** Bấm **In báo cáo ca** để lưu bản in trước.

---

## 5. Xử lý tình huống mất mạng kéo dài

| Tình huống | Hành động |
|---|---|
| Mất mạng < 24h | Tiếp tục bán bình thường, không cần làm gì |
| Mất mạng > 24h | Liên hệ IT để gia hạn grace window; không tắt app |
| App báo "Phiên offline hết hạn" | Kết nối mạng → đăng nhập lại |
| Máy in không phản hồi | Bấm "In lại" hoặc dùng nút "In dự phòng" (mở cửa sổ in hệ thống) |
| Màn hình trắng / lỗi | Refresh trang (F5); nếu vẫn lỗi gọi IT |
| Mất điện đột ngột | Khởi động lại máy → app tự khôi phục từ dữ liệu cục bộ |

---

## 6. Quy trình cuối ngày (quản lý)

1. Đảm bảo tất cả ca đã đóng
2. Vào dashboard Grafana (IT cấp link) → xem:
   - Doanh thu outlet hôm nay
   - Waste rate (cảnh báo nếu > 5%)
   - Chênh lệch ca (cảnh báo nếu > 50k VND)
3. Nếu có cảnh báo DLQ (đơn chưa sync): liên hệ IT để xử lý trước khi đóng ngày
4. Xuất báo cáo ngày từ giao diện quản lý

---

## 7. Liên hệ hỗ trợ

- **IT hotline**: _(điền số nội bộ)_
- **Slack/Zalo**: _(điền kênh hỗ trợ)_
- Khi gọi, cung cấp:
  - Tên outlet
  - Thời gian xảy ra sự cố
  - Màn hình lỗi (chụp ảnh nếu được)
  - Đang online hay offline lúc xảy ra

---

## 8. Disaster drill (IT thực hiện định kỳ)

| Kịch bản | Tần suất | Kết quả kỳ vọng |
|---|---|---|
| Tắt internet outlet 4h | Hàng tháng | Bán hàng không gián đoạn, sync thành công khi có mạng |
| Kéo phích máy tính đột ngột | Hàng quý | Khởi động lại OK, không mất đơn hàng |
| Đổi giá trên central | Trước mỗi pilot sprint | Edge nhận giá mới trong < 5s |
| Revoke device | Khi nghỉ việc/mất máy | App logout ngay khi có mạng |

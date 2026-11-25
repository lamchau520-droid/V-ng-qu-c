# Vườn Câu Pixel Online

Game làm vườn và câu cá nhiều người chơi. Mọi người thấy nhau đi lại trong làng, chat chung và dùng chung đồng hồ (thương nhân xuất hiện cùng giờ cho tất cả). Nông trại, túi đồ và thú cưng của mỗi người lưu riêng trên trình duyệt của họ.

## Cấu trúc
- `server.js`: máy chủ Node (HTTP + WebSocket tại `/ws`)
- `public/index.html`: toàn bộ game (client)
- `render.yaml`, `package.json`: cấu hình Render

## Chạy thử trên máy
```
npm install
npm start
```
Mở `http://localhost:3000` ở hai tab để thấy nhau. Có thể đặt `ADMIN_KEY=matkhau npm start` để thử lệnh admin.

## Đưa lên Render
1. Tạo repo GitHub và đẩy toàn bộ thư mục này lên.
2. Vào https://dashboard.render.com → **New → Blueprint** (hoặc **New → Web Service**) và chọn repo.
3. Nếu dùng Web Service thủ công: Runtime **Node**, Build Command `npm install`, Start Command `npm start`, Health Check Path `/healthz`.
4. Trong **Environment**, thêm biến `ADMIN_KEY` với mã bí mật của bạn.
5. Deploy xong, Render cấp link dạng `https://ten-game.onrender.com`. Gửi link này cho bạn bè.

## Lệnh trong chat
- `/who`: xem ai đang online
- `/login <mã>`: mở khóa lệnh admin (mã là `ADMIN_KEY`)
- `/help`: danh sách lệnh admin (xu, do, hat, ca, thu, kn, no, gio, caylon, tuoi, dat, nangcap)

Khi chơi online, lệnh admin bị khóa cho đến khi nhập đúng mã. Nếu không đặt `ADMIN_KEY` thì không ai dùng được lệnh admin. `/gio` đổi giờ chung cho cả server.

## Lưu ý với gói Free của Render
- Server tự ngủ sau khoảng 15 phút không có ai truy cập, lần mở đầu tiên sau đó mất khoảng một phút.
- Không có ổ đĩa lưu trữ, nên server không lưu dữ liệu người chơi. Tiến độ nằm trong localStorage của từng trình duyệt (xóa dữ liệu trình duyệt là mất).

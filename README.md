# FaceAttend — Hệ Thống Điểm Danh Khuôn Mặt

Hệ thống chấm công nhận diện khuôn mặt thời gian thực, xây dựng bằng FastAPI + React + OpenCV. Hỗ trợ đăng ký khuôn mặt, điểm danh tự động qua webcam/mobile, báo cáo xuất Excel và quản lý nhân viên đầy đủ.

**Demo:** https://doan-pi.vercel.app/

---

## Tính năng

- Nhận diện khuôn mặt realtime qua webcam (PC & mobile)
- Đăng ký khuôn mặt với 5 ảnh + augmentation (tối đa 25 encodings/nhân viên)
- Check-in / Check-out tự động, ghi nhận đúng giờ / trễ / vắng
- WebSocket broadcast kết quả điểm danh realtime
- Auto checkout + mark vắng lúc 00:05 hàng ngày (có catch-up khi server restart)
- Dashboard thống kê theo tháng + biểu đồ
- Xuất báo cáo Excel
- Quản lý nhân viên, tài khoản, cấu hình hệ thống
- JWT authentication (admin + nhân viên)

---

## Kiến trúc

```
Webcam / Mobile
      ↓
React + Vite (Frontend)
      ↓  REST API + WebSocket
FastAPI (Backend)
      ↓
OpenCV — LBP Face Recognition
      ↓
PostgreSQL (Database)
```

```
doan/
├── backend/
│   ├── main.py               # FastAPI app + scheduler auto-checkout/absent
│   ├── database.py           # SQLAlchemy + PostgreSQL
│   ├── models.py             # ORM: Employee, Attendance, User, Config
│   ├── schemas.py            # Pydantic schemas
│   ├── auth.py               # JWT authentication
│   ├── websocket.py          # WebSocket broadcast realtime
│   ├── ai/
│   │   └── detector.py       # LBP face detection & recognition (6400-dim)
│   └── routes/
│       ├── public_route.py   # /face-checkin (không cần token)
│       ├── employee_route.py # CRUD nhân viên + đăng ký mặt
│       ├── attendance_route.py
│       ├── config_route.py
│       ├── auth_route.py
│       └── export_route.py
└── frontend/
    └── src/
        ├── App.jsx
        ├── api/axios.js       # Axios instances (api / employeeApi / publicApi)
        ├── context/AuthContext.jsx
        └── pages/
            ├── Login.jsx
            ├── Dashboard.jsx
            ├── Realtime.jsx          # Điểm danh realtime
            ├── RegisterFace.jsx      # Admin đăng ký mặt
            ├── RegisterFacePage.jsx  # Nhân viên tự đăng ký
            ├── Employees.jsx
            └── Admin.jsx
```

---

## AI — Nhận diện khuôn mặt

Thuật toán: **LBP Histogram + Cosine Similarity**

- Phát hiện mặt: Haar Cascade (frontal + alt2 + profile), fallback nhiều điều kiện ánh sáng
- Encoding: LBP 5×5 grid × 256 bins = **6400 chiều**
- So sánh: Top-3 voting (70% top1 + 30% avg top3)
- Threshold: **0.72** (có thể chỉnh trong Admin → Config)
- Augmentation khi đăng ký: brightness ×4 biến thể → tối đa 25 encodings/nhân viên
- EXIF rotation fix cho ảnh mobile

| Tiêu chí | Giá trị |
|---|---|
| Encoding dimension | 6400 |
| Threshold mặc định | 0.72 |
| Tốc độ inference | ~200ms/ảnh (CPU) |
| Encodings/nhân viên | tối đa 25 |

---

## Stack

| Thành phần | Công nghệ |
|---|---|
| Backend | FastAPI 0.111, Python 3.11 |
| Database | PostgreSQL + SQLAlchemy 2.0 |
| AI | OpenCV 4.9, NumPy, Pillow |
| Frontend | React 18, Vite, Axios |
| Auth | JWT (python-jose) |
| Realtime | WebSocket (websockets) |
| Scheduler | APScheduler |
| Export | openpyxl |
| Deploy |Vercel (Frontend) + Render (Backend) |

---

## Cài đặt local

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Tạo file .env
cp .env.example .env
# Chỉnh DATABASE_URL và SECRET_KEY trong .env

uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Truy cập: http://localhost:5173

---

## Biến môi trường

### Backend (`.env`)

```env
DATABASE_URL=postgresql://user:password@host/dbname
SECRET_KEY=your-secret-key
```

### Frontend (`.env.production`)

```env
VITE_API_URL=https://your-backend.onrender.com
VITE_WS_URL=wss://your-backend.onrender.com/ws
```

---

## Deploy

### Backend — Render.com (Web Service)

- **Build command:** `pip install -r requirements.txt`
- **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Environment variables:** `DATABASE_URL`, `SECRET_KEY`

### Frontend — Vercel

- **Project:** https://vercel.com/nguyenvinhkhans-projects/chamcong
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment variables:** `VITE_API_URL`, `VITE_WS_URL`

---

## Tài khoản mặc định

Sau khi deploy, tài khoản admin mặc định:

| Username | Password |
|---|---|
| admin | Admin@123 |

> ⚠️ Đổi mật khẩu ngay sau khi đăng nhập lần đầu.

---

## API chính

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập admin |
| GET | `/api/employees/` | Danh sách nhân viên |
| POST | `/api/employees/{id}/register-face` | Đăng ký khuôn mặt |
| POST | `/public/face-checkin` | Điểm danh (không cần token) |
| GET | `/api/attendance/` | Lịch sử điểm danh |
| GET | `/api/export/excel` | Xuất báo cáo Excel |
| WS | `/ws` | WebSocket realtime |

---

## Lưu ý

- Render free tier sleep sau 15 phút không có request — lần đầu truy cập có thể chờ ~30 giây
- Sau khi cập nhật `detector.py`, toàn bộ nhân viên cần đăng ký lại khuôn mặt vì encoding format thay đổi
- Nên đăng ký mặt bằng PC/laptop để đảm bảo chất lượng ảnh tốt nhất
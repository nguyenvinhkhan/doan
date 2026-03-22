# FaceAttend — Hệ Thống Điểm Danh Khuôn Mặt

Hệ thống chấm công nhận diện khuôn mặt thời gian thực, xây dựng bằng FastAPI + React + OpenCV. Hỗ trợ đăng ký khuôn mặt, điểm danh tự động qua webcam/mobile, báo cáo xuất Excel và quản lý nhân viên đầy đủ.

**Demo:** https://doan-pi.vercel.app

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
- Rate limiting trên endpoint điểm danh

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
faceattend/
├── backend/
│   ├── main.py               # FastAPI app + scheduler auto-checkout/absent
│   ├── database.py           # SQLAlchemy + PostgreSQL
│   ├── models.py             # ORM: Employee, Attendance, User, Config
│   ├── schemas.py            # Pydantic schemas
│   ├── auth.py               # JWT authentication
│   ├── websocket.py          # WebSocket broadcast realtime
│   ├── ai/
│   │   └── detector.py       # Uniform LBP face detection & recognition (1475-dim)
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

Thuật toán: **Uniform LBP Histogram + Cosine Similarity**

- Phát hiện mặt: Haar Cascade (frontal + alt2 + profile), fallback nhiều điều kiện ánh sáng
- Preprocessing: CLAHE chuẩn hóa ánh sáng + Gaussian blur
- Blur filter: loại ảnh mờ (Laplacian variance < 50) trước khi encode
- Center crop: bỏ 10% border để loại nhiễu tóc/tai/background
- Encoding: Uniform LBP 5×5 grid × 59 bins = **1475 chiều** (rotation invariant)
- Normalize vector trước cosine similarity
- So sánh: Weighted voting top-5 (weight theo similarity)
- Threshold: **0.68** (có thể chỉnh trong Admin → Config)
- Augmentation khi đăng ký: brightness ×4 biến thể → tối đa 25 encodings/nhân viên
- Cache encodings RAM khi server khởi động — giảm query DB mỗi lần check-in
- EXIF rotation fix cho ảnh mobile
- Bounding box realtime trên browser qua face-api.js (TinyFaceDetector)

| Tiêu chí | Giá trị |
|---|---|
| Encoding dimension | 1475 (Uniform LBP) |
| Threshold mặc định | 0.68 |
| Tốc độ inference | ~200ms/ảnh (CPU) |
| Encodings/nhân viên | tối đa 25 |
| Browser detect | face-api.js TinyFaceDetector |

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
| Deploy | Vercel (Frontend) + Render (Backend) + Database (Supabase) |

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
| admin | 123456 |

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

## Demo

### 1 — Frontend local + Backend Render (không cần cài Python)

Dùng khi chỉ muốn chạy thử giao diện, backend dùng server production sẵn có.

**Bước 1** — Tạo file `frontend/.env.local`:
```env
VITE_API_URL=https://doan-uh5r.onrender.com
VITE_WS_URL=wss://doan-uh5r.onrender.com/ws
```

**Bước 2** — Chạy frontend:
```bash
cd frontend
npm install
npm run dev
```

Truy cập: http://localhost:5173

> ⚠️ Render free tier có thể sleep — lần đầu load có thể chờ ~30 giây.

---

### 2 — Frontend local + Backend local (full local)

Dùng khi muốn phát triển, debug hoặc chạy offline.

**Yêu cầu:** Python 3.11+, PostgreSQL đang chạy trên máy.

**Bước 1** — Tạo database local:
```sql
CREATE DATABASE face_attendance;
```

**Bước 2** — Tạo `backend/.env`:
```env
DATABASE_URL=postgresql://postgres:YourPassword@localhost:5432/face_attendance
SECRET_KEY=local-dev-secret-key
ACCESS_TOKEN_EXPIRE_MINUTES=480
```

**Bước 3** — Chạy backend:
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Bước 4** — Tạo `frontend/.env.local`:
```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws
```

**Bước 5** — Chạy frontend:
```bash
cd frontend
npm install
npm run dev
```

Truy cập: http://localhost:5173 — đăng nhập `admin / 123456`



---

## Lưu ý

- Render free tier sleep sau 15 phút không có request — lần đầu truy cập có thể chờ ~30 giây
- Sau khi cập nhật `detector.py`, toàn bộ nhân viên cần đăng ký lại khuôn mặt vì encoding format thay đổi
- Nên đăng ký mặt bằng PC/laptop để đảm bảo chất lượng ảnh tốt nhất
# 🎯 FaceAttend — Hệ Thống Điểm Danh Khuôn Mặt

Hệ thống điểm danh thông minh sử dụng nhận diện khuôn mặt thời gian thực.

---

## 🏗️ Kiến Trúc

```
doan/
├── backend/                  # FastAPI + Python
│   ├── ai/
│   │   └── detector.py       # Face detection & recognition (face_recognition / dlib)
│   ├── routes/
│   │   ├── auth_route.py     # Đăng nhập, đăng ký tài khoản
│   │   ├── employee_route.py # CRUD nhân viên, đăng ký khuôn mặt
│   │   └── attendance_route.py # Điểm danh bằng khuôn mặt, thống kê
│   ├── main.py               # FastAPI app entry point
│   ├── database.py           # PostgreSQL connection (SQLAlchemy)
│   ├── models.py             # ORM models: User, Employee, Attendance
│   ├── schemas.py            # Pydantic schemas
│   ├── auth.py               # JWT authentication
│   ├── websocket.py          # WebSocket realtime
│   └── requirements.txt
└── frontend/                 # React 18 + Vite
    └── src/
        ├── pages/
        │   ├── Login.jsx         # Trang đăng nhập
        │   ├── Dashboard.jsx     # Thống kê tổng quan + biểu đồ
        │   ├── Realtime.jsx      # Camera + điểm danh realtime
        │   ├── Employees.jsx     # Quản lý nhân viên
        │   ├── RegisterFace.jsx  # Đăng ký khuôn mặt
        │   └── Admin.jsx         # Lịch sử & quản trị
        ├── components/Navbar.jsx
        ├── context/AuthContext.jsx
        └── api/axios.js
```

---

## 🚀 Cài Đặt & Chạy

### Yêu Cầu
- Python 3.10+
- Node.js 18+
- PostgreSQL 14+
- cmake (để cài dlib/face_recognition)

### Backend

```bash
cd backend

# Tạo virtual environment
python -m venv venv
source venv/bin/activate       # Linux/Mac
# venv\Scripts\activate        # Windows

# Cài dependencies
pip install -r requirements.txt

# Cấu hình môi trường
cp .env.example .env
# Sửa DATABASE_URL và SECRET_KEY trong .env

# Tạo database
createdb face_attendance

# Chạy server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

> **Lưu ý:** `face_recognition` yêu cầu `dlib`. Nếu gặp lỗi cài đặt:
> ```bash
> # Ubuntu/Debian
> sudo apt-get install cmake libopenblas-dev liblapack-dev
> pip install dlib face_recognition
> ```

### Frontend

```bash
cd frontend

npm install

cp .env.example .env

npm run dev
# Mở http://localhost:5173
```

---

## 📖 API Endpoints

### Auth
| Method | URL | Mô tả |
|--------|-----|-------|
| POST | `/api/auth/login` | Đăng nhập |
| POST | `/api/auth/register` | Tạo tài khoản admin |
| GET  | `/api/auth/me` | Thông tin user hiện tại |

### Nhân viên
| Method | URL | Mô tả |
|--------|-----|-------|
| GET  | `/api/employees/` | Danh sách (có filter search, dept) |
| POST | `/api/employees/` | Thêm nhân viên |
| PUT  | `/api/employees/{id}` | Sửa nhân viên |
| DELETE | `/api/employees/{id}` | Xóa nhân viên |
| POST | `/api/employees/{id}/register-face` | Đăng ký khuôn mặt |

### Điểm danh
| Method | URL | Mô tả |
|--------|-----|-------|
| POST | `/api/attendance/face-checkin` | Điểm danh bằng ảnh khuôn mặt |
| GET  | `/api/attendance/` | Lịch sử (filter date, employee) |
| GET  | `/api/attendance/stats/summary` | Thống kê tháng |
| GET  | `/api/attendance/stats/daily` | Thống kê theo ngày (cho chart) |

### WebSocket
```
ws://localhost:8000/ws/attendance
```
Nhận events realtime khi có điểm danh mới.

---

## ✨ Tính Năng

- **Nhận diện khuôn mặt** — So sánh với database sử dụng FaceNet/dlib
- **Check-in / Check-out** — Tự động phát hiện lần vào và ra
- **Phát hiện đi trễ** — Sau 08:30 tự động đánh dấu "late"
- **Realtime WebSocket** — Thông báo ngay khi có điểm danh
- **Dashboard thống kê** — Biểu đồ theo ngày và tháng
- **Tự động quét** — Camera quét liên tục mỗi 3 giây
- **Quản lý nhân viên** — CRUD đầy đủ + filter + search
- **JWT Authentication** — Phân quyền admin / viewer

---

## 🔒 Bảo Mật

- Mật khẩu hash bằng **bcrypt**
- Token **JWT** với thời hạn 8 giờ
- Route admin được bảo vệ bởi `require_admin` dependency
- CORS chỉ cho phép origin đã cấu hình

---

## 🛠️ Công Nghệ

| Layer | Công nghệ |
|-------|-----------|
| Backend | FastAPI, SQLAlchemy, Alembic |
| Database | PostgreSQL |
| AI | face_recognition, dlib, NumPy, Pillow |
| Auth | python-jose (JWT), passlib (bcrypt) |
| Frontend | React 18, Vite, React Router 6 |
| Charts | Recharts |
| Realtime | WebSocket (native FastAPI) |

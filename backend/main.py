from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database import Base, engine
from routes import auth_route, employee_route, attendance_route, config_route, public_route, export_route, proxy_route
from websocket import router as ws_router
import models  # noqa: F401

def run_migrations():
    """Thêm các cột mới vào bảng đã tồn tại nếu chưa có."""
    with engine.connect() as conn:
        # Thêm cột employee_id vào bảng users nếu chưa có
        conn.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='users' AND column_name='employee_id'
                ) THEN
                    ALTER TABLE users ADD COLUMN employee_id INTEGER REFERENCES employees(id);
                END IF;
            END$$;
        """)
        conn.commit()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tạo bảng nếu chưa có
    Base.metadata.create_all(bind=engine)

    # Chạy migration thủ công (thêm cột mới nếu thiếu)
    try:
        run_migrations()
        print("[INIT] Migration hoàn tất")
    except Exception as e:
        print(f"[WARN] Migration lỗi (có thể bỏ qua): {e}")

    # Tạo tài khoản admin mặc định nếu chưa có
    from database import SessionLocal
    from auth import hash_password
    db = SessionLocal()
    try:
        if not db.query(models.User).filter(models.User.username == "admin").first():
            admin = models.User(
                username="admin",
                email="admin@faceattend.com",
                password=hash_password("Admin@123"),
                role="admin",
                is_active=True,
            )
            db.add(admin)
            db.commit()
            print("[INIT] Tạo tài khoản admin: admin / Admin@123")
    finally:
        db.close()

    # Khởi tạo cấu hình mặc định
    from routes.config_route import init_default_configs
    db2 = SessionLocal()
    try:
        init_default_configs(db2)
        print("[INIT] Khởi tạo cấu hình mặc định xong")
    finally:
        db2.close()

    yield

app = FastAPI(
    title="Hệ Thống Điểm Danh Khuôn Mặt",
    description="API nhận diện khuôn mặt & quản lý điểm danh",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes cần đăng nhập
app.include_router(auth_route.router,       prefix="/api/auth",       tags=["Auth"])
app.include_router(employee_route.router,   prefix="/api/employees",  tags=["Employees"])
app.include_router(attendance_route.router, prefix="/api/attendance", tags=["Attendance"])
app.include_router(config_route.router,     prefix="/api/configs",    tags=["Configs"])
app.include_router(export_route.router,     prefix="/api/export",     tags=["Export"])
app.include_router(proxy_route.router,      prefix="/proxy",          tags=["Proxy"])

# Route công khai (không cần đăng nhập)
app.include_router(public_route.router,     prefix="/public",         tags=["Public"])
app.include_router(ws_router,               prefix="/ws",             tags=["WebSocket"])

@app.get("/")
def root():
    return {"message": "Face Attendance API is running 🚀"}
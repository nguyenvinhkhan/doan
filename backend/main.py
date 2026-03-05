from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database import Base, engine
from routes import auth_route, employee_route, attendance_route, config_route, public_route, export_route
from websocket import router as ws_router
import models  # noqa: F401

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tạo bảng nếu chưa có
    Base.metadata.create_all(bind=engine)
    # Tạo tài khoản admin mặc định nếu chưa có
    from database import SessionLocal
    from auth import hash_password
    db = SessionLocal()
    try:
        if not db.query(models.User).filter(models.User.username == "admin").first():
            admin = models.User(
                username="admin",
                email="admin@.com",
                password=hash_password("123456"),
                role="admin",
                is_active=True,
            )
            db.add(admin)
            db.commit()
            print("[INIT] Tạo tài khoản admin: admin / 123456")
    finally:
        db.close()
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

# Route công khai (không cần đăng nhập)
app.include_router(public_route.router,     prefix="/public",         tags=["Public"])

app.include_router(ws_router,               prefix="/ws",             tags=["WebSocket"])

@app.get("/")
def root():
    return {"message": "Face Attendance API is running 🚀"}
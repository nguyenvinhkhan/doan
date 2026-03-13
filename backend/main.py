from fastapi import FastAPI
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database import Base, engine
from routes import auth_route, employee_route, attendance_route, config_route, public_route, export_route, proxy_route
from websocket import router as ws_router
import models  # noqa: F401
from ai.detector import cache_load_all

def run_migrations():
    """Thêm các cột mới vào bảng đã tồn tại nếu chưa có."""
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='users' AND column_name='employee_id'
                ) THEN
                    ALTER TABLE users ADD COLUMN employee_id INTEGER REFERENCES employees(id);
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='attendances' AND column_name='note'
                ) THEN
                    ALTER TABLE attendances ADD COLUMN note TEXT;
                END IF;
            END$$;
        """))
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
                password=hash_password("123456"),
                role="admin",
                is_active=True,
            )
            db.add(admin)
            db.commit()
            print("[INIT] Tạo tài khoản admin: admin / 123456")
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

    # Load encodings vào RAM cache
    db3 = SessionLocal()
    try:
        active_emps = db3.query(models.Employee).filter(
            models.Employee.is_active == True,
            models.Employee.face_encoding != None
        ).all()
        cache_load_all(active_emps)
    finally:
        db3.close()

    # ── Catch-up: chạy bù nếu server bị ngủ lúc 00:05 ─────────────────────────
    # Kiểm tra xem hôm qua đã có record absent/auto-checkout chưa.
    # Nếu chưa (server ngủ) thì chạy ngay khi wake up.
    try:
        from database import SessionLocal as _SL
        from datetime import datetime, timezone, timedelta as _td
        _VN = timezone(_td(hours=7))
        _now = datetime.now(_VN)
        _yesterday = (_now - _td(days=1)).date().isoformat()
        _db = _SL()
        try:
            # Nếu có ít nhất 1 nhân viên active mà không có record nào ngày hôm qua
            # → job chưa chạy → chạy bù ngay
            _active_count = _db.query(models.Employee).filter(
                models.Employee.is_active == True
            ).count()
            _attended_count = _db.query(models.Attendance).filter(
                models.Attendance.date == _yesterday
            ).count()
            # Chỉ chạy bù nếu: có nhân viên active VÀ không có record nào hôm qua
            # (tránh chạy lại khi đã có dữ liệu rồi)
            if _active_count > 0 and _attended_count == 0:
                print(f"[INIT] Phát hiện ngày {_yesterday} chưa xử lý — chạy bù auto_end_of_day")
                auto_end_of_day()
            else:
                print(f"[INIT] Catch-up check: ngày {_yesterday} đã có {_attended_count} record, bỏ qua")
        finally:
            _db.close()
    except Exception as _e:
        print(f"[INIT] Catch-up lỗi (bỏ qua): {_e}")

    # Khởi động scheduler bên trong lifespan — đảm bảo restart đúng khi Render wake up
    scheduler = BackgroundScheduler(timezone="Asia/Ho_Chi_Minh")
    scheduler.add_job(auto_end_of_day, CronTrigger(hour=0, minute=5))
    scheduler.start()
    print("[INIT] Scheduler khởi động — auto checkout + mark absent lúc 00:05 hàng ngày")

    yield

    scheduler.shutdown(wait=False)
    print("[SHUTDOWN] Scheduler đã dừng")

# ── Auto checkout + Mark absent cuối ngày ────────────────────────────────────
def auto_end_of_day():
    """
    Chạy lúc 00:05 mỗi ngày:
    1. Auto checkout các ca chưa checkout ngày hôm trước → check_out = 23:59:59
    2. Tạo record absent cho nhân viên active không có record ngày hôm qua
    """
    from database import SessionLocal
    import models
    from datetime import datetime, timezone, timedelta

    VN_TZ     = timezone(timedelta(hours=7))
    now       = datetime.now(VN_TZ)
    yesterday = (now - timedelta(days=1)).date().isoformat()
    eod       = datetime(now.year, now.month, now.day, 0, 0, 0, tzinfo=VN_TZ) - timedelta(seconds=1)

    db = SessionLocal()
    try:
        # 1. Auto checkout
        missing_checkout = db.query(models.Attendance).filter(
            models.Attendance.date == yesterday,
            models.Attendance.check_out.is_(None),
        ).all()
        for rec in missing_checkout:
            rec.check_out = eod
            rec.note = (rec.note or "") + " | Auto checkout cuối ngày"
        db.commit()
        print(f"[AutoCheckout] {len(missing_checkout)} bản ghi ngày {yesterday} checkout tự động")

        # 2. Mark absent — nhân viên active không có bất kỳ record nào ngày hôm qua
        all_active = db.query(models.Employee).filter(
            models.Employee.is_active == True
        ).all()
        attended_ids = {
            row.employee_id for row in
            db.query(models.Attendance.employee_id).filter(
                models.Attendance.date == yesterday
            ).all()
        }
        absent_count = 0
        for emp in all_active:
            if emp.id not in attended_ids:
                db.add(models.Attendance(
                    employee_id = emp.id,
                    date        = yesterday,
                    status      = "absent",
                    check_in    = None,
                    check_out   = None,
                    note        = "Vắng mặt (tự động)",
                ))
                absent_count += 1
        db.commit()
        print(f"[MarkAbsent] {absent_count} nhân viên vắng ngày {yesterday}")

    except Exception as e:
        print(f"[AutoEndOfDay] Lỗi: {e}")
        db.rollback()
    finally:
        db.close()


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

@app.get("/health")
def health_check():
    """Endpoint ping — dùng cho UptimeRobot để giữ server không sleep."""
    from datetime import datetime, timezone, timedelta
    return {"status": "ok", "time": datetime.now(timezone(timedelta(hours=7))).isoformat()}

@app.get("/")
def root():
    return {"message": "Face Attendance API is running 🚀"}
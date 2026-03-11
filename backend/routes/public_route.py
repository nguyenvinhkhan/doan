"""
Route công khai — không cần JWT.
Dùng cho trang điểm danh realtime (màn hình kiosk/tablet).
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta, date
import time
import threading
import asyncio

VN_TZ = timezone(timedelta(hours=7))
from database import get_db
from ai.detector import unified_face_match
from routes.config_route import get_config
from schemas import FaceCheckIn
from websocket import notify_attendance
import models

router = APIRouter()


# ── Rate Limiter đơn giản (in-memory, per-IP) ─────────────────────────────────
_rate_data: dict = {}
_rate_lock = threading.Lock()
MAX_CALLS   = 5
TIME_WINDOW = 10

def _check_rate_limit(ip: str):
    now = time.time()
    with _rate_lock:
        timestamps = _rate_data.get(ip, [])
        timestamps = [t for t in timestamps if now - t < TIME_WINDOW]
        if len(timestamps) >= MAX_CALLS:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "RATE_LIMIT",
                    "msg": f"Quá nhiều yêu cầu. Vui lòng chờ {TIME_WINDOW} giây rồi thử lại.",
                }
            )
        timestamps.append(now)
        _rate_data[ip] = timestamps


# ── Cooldown per-employee ─────────────────────────────────────────────────────
_emp_cooldown: dict = {}
_cooldown_lock = threading.Lock()
EMP_COOLDOWN = 30  # giây

def _check_employee_cooldown(emp_id: int):
    now = time.time()
    with _cooldown_lock:
        last = _emp_cooldown.get(emp_id, 0)
        remaining = EMP_COOLDOWN - (now - last)
        if remaining > 0:
            raise HTTPException(status_code=429, detail={
                "code": "EMPLOYEE_COOLDOWN",
                "msg":  f"Vừa điểm danh xong. Vui lòng chờ {int(remaining)} giây.",
            })
        _emp_cooldown[emp_id] = now


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/face-checkin")
async def public_face_checkin(
    request: Request,
    payload: FaceCheckIn,
    db: Session = Depends(get_db),
):
    """Điểm danh công khai — không cần token."""

    # Rate limit theo IP
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    now   = datetime.now(VN_TZ)
    today = now.date().isoformat()

    employees = db.query(models.Employee).filter(
        models.Employee.is_active == True,
        models.Employee.face_encoding.isnot(None),
    ).all()

    if not employees:
        raise HTTPException(status_code=404, detail={
            "code": "NO_EMPLOYEES",
            "msg": "Chưa có nhân viên nào đăng ký khuôn mặt",
        })

    threshold = float(get_config(db, "face_threshold"))

    # ── Nhận diện bằng hàm dùng chung ────────────────────────────────────────
    result = unified_face_match(employees, payload.image_base64, threshold)

    if not result["matched"]:
        raise HTTPException(status_code=404, detail={
            "code":       result["error_code"],
            "msg":        result["error_msg"],
            "confidence": result["confidence"],
        })

    best_emp = result["employee"]
    best_sim = result["confidence"]

    # ── Cooldown per-employee (chặn check-in/out liên tiếp cùng người) ────────
    _check_employee_cooldown(best_emp.id)

    # ── Ghi chấm công ─────────────────────────────────────────────────────────
    record = db.query(models.Attendance).filter(
        models.Attendance.employee_id == best_emp.id,
        models.Attendance.date == today,
    ).first()

    if record:
        if record.check_out:
            raise HTTPException(status_code=400, detail={
                "code": "ALREADY_CHECKED_OUT",
                "msg":  f"{best_emp.full_name} đã điểm danh ra ca rồi.",
            })
        record.check_out = now
        db.commit()
        event = {
            "action":         "check_out",
            "employee":       best_emp.full_name,
            "employee_code":  best_emp.employee_code,
            "department":     best_emp.department,
            "confidence":     best_sim,
            "confidence_pct": f"{best_sim*100:.1f}%",
            "time":           now.isoformat(),
        }
        # Broadcast realtime đến tất cả màn hình kiosk đang mở
        asyncio.create_task(notify_attendance(event))
        return event
    else:
        late_hour   = int(get_config(db, "late_hour"))
        late_minute = int(get_config(db, "late_minute"))
        status = "late" if (now.hour > late_hour or (now.hour == late_hour and now.minute >= late_minute)) else "present"

        db.add(models.Attendance(
            employee_id=best_emp.id,
            check_in=now,
            date=today,
            status=status,
            confidence=best_sim,
        ))
        db.commit()
        event = {
            "action":          "check_in",
            "employee":        best_emp.full_name,
            "employee_code":   best_emp.employee_code,
            "department":      best_emp.department,
            "confidence":      best_sim,
            "confidence_pct":  f"{best_sim*100:.1f}%",
            "status":          status,
            "late_threshold":  f"{late_hour:02d}:{late_minute:02d}",
            "time":            now.isoformat(),
        }
        # Broadcast realtime đến tất cả màn hình kiosk đang mở
        asyncio.create_task(notify_attendance(event))
        return event


@router.get("/today-feed")
def get_today_feed(db: Session = Depends(get_db)):
    """Lấy nhật ký chấm công hôm nay — public, dùng cho trang kiosk."""
    today = datetime.now(VN_TZ).date().isoformat()
    records = db.query(models.Attendance, models.Employee).join(
        models.Employee, models.Attendance.employee_id == models.Employee.id
    ).filter(
        models.Attendance.date == today
    ).order_by(models.Attendance.check_in.desc()).all()

    feed = []
    for att, emp in records:
        if att.check_out:
            feed.append({
                "action": "check_out",
                "employee": emp.full_name,
                "employee_code": emp.employee_code,
                "department": emp.department,
                "confidence": att.confidence,
                "status": att.status,
                "time": att.check_out.isoformat() if att.check_out else None,
            })
        if att.check_in:
            feed.append({
                "action": "check_in",
                "employee": emp.full_name,
                "employee_code": emp.employee_code,
                "department": emp.department,
                "confidence": att.confidence,
                "status": att.status,
                "time": att.check_in.isoformat() if att.check_in else None,
            })
    feed.sort(key=lambda x: x["time"] or "", reverse=True)
    return feed[:50]


@router.get("/debug/encoding-info")
def debug_encoding_info(db: Session = Depends(get_db)):
    """Endpoint tạm — kiểm tra encoding dimension trong DB."""
    import json
    employees = db.query(models.Employee).filter(
        models.Employee.face_encoding.isnot(None)
    ).all()
    result = []
    for emp in employees:
        try:
            stored = json.loads(emp.face_encoding)
            if isinstance(stored[0], list):
                dim = len(stored[0])
                count = len(stored)
            else:
                dim = len(stored)
                count = 1
            result.append({"name": emp.full_name, "encodings": count, "dim": dim})
        except Exception as e:
            result.append({"name": emp.full_name, "error": str(e)})
    return {"employees": result}
"""
Route công khai — không cần JWT.
Dùng cho trang điểm danh realtime (màn hình kiosk/tablet).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, date, timezone, timedelta

VN_TZ = timezone(timedelta(hours=7))  # UTC+7 Việt Nam
from database import get_db
from ai.detector import compare_faces
from routes.config_route import get_config
from schemas import FaceCheckIn
import models

router = APIRouter()


@router.post("/face-checkin")
def public_face_checkin(
    payload: FaceCheckIn,
    db: Session = Depends(get_db),
):
    """Điểm danh công khai — không cần token."""
    today = date.today().isoformat()
    now   = datetime.now(VN_TZ)

    employees = db.query(models.Employee).filter(
        models.Employee.is_active == True,
        models.Employee.face_encoding.isnot(None),
    ).all()

    if not employees:
        raise HTTPException(status_code=404, detail="Chưa có nhân viên nào đăng ký khuôn mặt")

    threshold       = float(get_config(db, "face_threshold"))
    best_match      = None
    best_confidence = 0.0

    for emp in employees:
        is_match, confidence = compare_faces(emp.face_encoding, payload.image_base64, threshold)
        if is_match and confidence > best_confidence:
            best_match      = emp
            best_confidence = confidence

    if not best_match:
        raise HTTPException(status_code=404, detail="Không nhận diện được khuôn mặt")

    record = db.query(models.Attendance).filter(
        models.Attendance.employee_id == best_match.id,
        models.Attendance.date == today,
    ).first()

    if record:
        if record.check_out:
            raise HTTPException(status_code=400, detail=f"{best_match.full_name} đã điểm danh ra rồi")
        record.check_out = now
        db.commit()
        return {
            "action":        "check_out",
            "employee":      best_match.full_name,
            "employee_code": best_match.employee_code,
            "department":    best_match.department,
            "confidence":    best_confidence,
            "time":          now.isoformat(),
        }
    else:
        late_hour   = int(get_config(db, "late_hour"))
        late_minute = int(get_config(db, "late_minute"))
        status = "present"
        if now.hour > late_hour or (now.hour == late_hour and now.minute >= late_minute):
            status = "late"

        db.add(models.Attendance(
            employee_id=best_match.id,
            check_in=now,
            date=today,
            status=status,
            confidence=best_confidence,
        ))
        db.commit()
        return {
            "action":          "check_in",
            "employee":        best_match.full_name,
            "employee_code":   best_match.employee_code,
            "department":      best_match.department,
            "confidence":      best_confidence,
            "status":          status,
            "late_threshold":  f"{late_hour:02d}:{late_minute:02d}",
            "time":            now.isoformat(),
        }
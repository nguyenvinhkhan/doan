from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, date, timezone, timedelta

VN_TZ = timezone(timedelta(hours=7))  # UTC+7
from database import get_db
from schemas import AttendanceOut, FaceCheckIn
from auth import get_current_user, require_admin
from ai.detector import compare_faces
from routes.config_route import get_config
import models

router = APIRouter()


@router.post("/face-checkin")
def face_checkin(
    payload: FaceCheckIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    now   = datetime.now(VN_TZ)
    today = now.date().isoformat()

    employees = db.query(models.Employee).filter(
        models.Employee.is_active == True,
        models.Employee.face_encoding.isnot(None),
    ).all()

    if not employees:
        raise HTTPException(status_code=404, detail="Chưa có nhân viên nào đăng ký khuôn mặt")

    # Đọc ngưỡng nhận diện từ cấu hình
    threshold = float(get_config(db, "face_threshold"))

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
        db.refresh(record)
        return {
            "action": "check_out",
            "employee": best_match.full_name,
            "employee_code": best_match.employee_code,
            "confidence": best_confidence,
            "time": now.isoformat(),
        }
    else:
        # Đọc giờ đi trễ từ cấu hình
        late_hour   = int(get_config(db, "late_hour"))
        late_minute = int(get_config(db, "late_minute"))

        status = "present"
        if now.hour > late_hour or (now.hour == late_hour and now.minute >= late_minute):
            status = "late"

        new_record = models.Attendance(
            employee_id=best_match.id,
            check_in=now,
            date=today,
            status=status,
            confidence=best_confidence,
        )
        db.add(new_record)
        db.commit()
        db.refresh(new_record)
        return {
            "action": "check_in",
            "employee": best_match.full_name,
            "employee_code": best_match.employee_code,
            "confidence": best_confidence,
            "status": status,
            "late_threshold": f"{late_hour:02d}:{late_minute:02d}",
            "time": now.isoformat(),
        }


@router.get("/", response_model=List[AttendanceOut])
def list_attendance(
    date_str: Optional[str] = Query(None, alias="date"),
    employee_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(models.Attendance)
    if date_str:
        q = q.filter(models.Attendance.date == date_str)
    if employee_id:
        q = q.filter(models.Attendance.employee_id == employee_id)
    if status:
        q = q.filter(models.Attendance.status == status)
    return q.order_by(models.Attendance.check_in.desc()).offset(skip).limit(limit).all()


@router.get("/stats/summary")
def attendance_summary(
    month: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    now   = datetime.now(VN_TZ)
    today = now.date()
    m = month or today.month
    y = year or today.year
    prefix = f"{y}-{m:02d}"

    total_employees = db.query(func.count(models.Employee.id)).filter(
        models.Employee.is_active == True).scalar()
    present = db.query(func.count(models.Attendance.id)).filter(
        models.Attendance.date.like(f"{prefix}%"),
        models.Attendance.status == "present").scalar()
    late = db.query(func.count(models.Attendance.id)).filter(
        models.Attendance.date.like(f"{prefix}%"),
        models.Attendance.status == "late").scalar()
    absent = db.query(func.count(models.Attendance.id)).filter(
        models.Attendance.date.like(f"{prefix}%"),
        models.Attendance.status == "absent").scalar()
    today_count = db.query(func.count(models.Attendance.id)).filter(
        models.Attendance.date == today.isoformat()).scalar()

    # Đọc giờ trễ hiện tại
    late_hour   = get_config(db, "late_hour")
    late_minute = get_config(db, "late_minute")

    return {
        "total_employees": total_employees,
        "month": m,
        "year": y,
        "present": present,
        "late": late,
        "absent": absent,
        "today_count": today_count,
        "late_threshold": f"{int(late_hour):02d}:{int(late_minute):02d}",
    }


@router.get("/stats/daily")
def daily_stats(
    days: int = Query(30, le=90),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = (
        db.query(models.Attendance.date, func.count(models.Attendance.id).label("count"))
        .group_by(models.Attendance.date)
        .order_by(models.Attendance.date.desc())
        .limit(days)
        .all()
    )
    return [{"date": r.date, "count": r.count} for r in reversed(rows)]


@router.delete("/{attendance_id}")
def delete_attendance(
    attendance_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Xóa bản ghi điểm danh (chỉ admin)."""
    record = db.query(models.Attendance).filter(
        models.Attendance.id == attendance_id
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản ghi")
    db.delete(record)
    db.commit()
    return {"message": f"Đã xóa bản ghi #{attendance_id}"}
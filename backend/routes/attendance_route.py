from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, date, timezone, timedelta

VN_TZ = timezone(timedelta(hours=7))  # UTC+7
from database import get_db
from schemas import AttendanceOut
from auth import get_current_user, require_admin
from routes.config_route import get_config
import models

router = APIRouter()

# Route /face-checkin đã được chuyển sang public_route.py (không cần token).
# attendance_route.py chỉ giữ các route quản lý dữ liệu điểm danh.


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
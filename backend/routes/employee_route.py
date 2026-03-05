from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from database import get_db
from schemas import EmployeeCreate, EmployeeUpdate, EmployeeOut
from auth import get_current_user, require_admin
from ai.detector import get_face_encoding
import models
import json

router = APIRouter()


@router.get("/", response_model=List[EmployeeOut])
def list_employees(
    search: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(models.Employee)
    if search:
        q = q.filter(or_(
            models.Employee.full_name.ilike(f"%{search}%"),
            models.Employee.employee_code.ilike(f"%{search}%"),
            models.Employee.email.ilike(f"%{search}%"),
        ))
    if department:
        q = q.filter(models.Employee.department == department)
    if is_active is not None:
        q = q.filter(models.Employee.is_active == is_active)
    return q.offset(skip).limit(limit).all()


@router.post("/", response_model=EmployeeOut, status_code=201)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    if db.query(models.Employee).filter(
        models.Employee.employee_code == payload.employee_code
    ).first():
        raise HTTPException(status_code=400, detail="Mã nhân viên đã tồn tại")

    employee = models.Employee(**payload.model_dump())
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên")
    return emp


@router.put("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(emp, field, value)
    db.commit()
    db.refresh(emp)
    return emp


@router.delete("/{employee_id}", status_code=204)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên")
    # Xóa bản ghi điểm danh liên quan trước
    db.query(models.Attendance).filter(
        models.Attendance.employee_id == employee_id
    ).delete()
    db.delete(emp)
    db.commit()


@router.post("/{employee_id}/register-face")
def register_face(
    employee_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Register / update face encoding for an employee."""
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên")

    image_base64 = payload.get("image_base64")
    if not image_base64:
        raise HTTPException(status_code=400, detail="Thiếu ảnh khuôn mặt")

    encoding = get_face_encoding(image_base64)
    if encoding is None:
        raise HTTPException(status_code=422, detail="Không phát hiện khuôn mặt trong ảnh")

    emp.face_encoding = json.dumps(encoding)
    db.add(emp)
    db.commit()
    db.refresh(emp)
    print(f"[OK] Đã lưu face_encoding cho {emp.full_name}, size={len(emp.face_encoding)}")
    return {"message": "Đăng ký khuôn mặt thành công", "employee_id": employee_id, "encoding_size": len(encoding)}


@router.get("/meta/departments")
def get_departments(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(models.Employee.department).distinct().all()
    return [r[0] for r in rows if r[0]]
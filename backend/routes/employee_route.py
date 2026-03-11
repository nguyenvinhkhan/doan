from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from database import get_db
from schemas import EmployeeCreate, EmployeeUpdate, EmployeeOut
from auth import get_current_user, require_admin, hash_password
from ai.detector import get_face_encoding, get_face_encodings_multi, cache_update, cache_delete
import models
import json

router = APIRouter()


@router.get("/meta/departments")
def get_departments(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(models.Employee.department).distinct().all()
    return [r[0] for r in rows if r[0]]


@router.get("/me/profile")
def get_my_profile(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Nhân viên xem thông tin của chính mình."""
    if current_user.role != "employee":
        raise HTTPException(status_code=403, detail="Chỉ dành cho nhân viên")
    if not current_user.employee_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy hồ sơ nhân viên")
    emp = db.query(models.Employee).filter(
        models.Employee.id == current_user.employee_id
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên")
    return {
        "id": emp.id,
        "employee_code": emp.employee_code,
        "full_name": emp.full_name,
        "department": emp.department,
        "position": emp.position,
        "has_face": emp.has_face,
    }


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

    emp_data = payload.model_dump()
    employee = models.Employee(**emp_data)
    db.add(employee)
    db.flush()  # để lấy employee.id

    # Tự động tạo tài khoản cho nhân viên
    # username = mã nhân viên (viết thường), password mặc định = mã nhân viên
    username = payload.employee_code.lower()
    emp_email = payload.email or f"{username}@faceattend.local"

    # Kiểm tra username chưa tồn tại
    existing_user = db.query(models.User).filter(models.User.username == username).first()
    if not existing_user:
        emp_user = models.User(
            username=username,
            email=emp_email,
            password=hash_password("123456"),  # mật khẩu mặc định
            role="employee",
            is_active=True,
            employee_id=employee.id,
        )
        db.add(emp_user)

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
    # Xóa theo đúng thứ tự để tránh foreign key violation:
    # 1. Attendance (tham chiếu employee)
    db.query(models.Attendance).filter(
        models.Attendance.employee_id == employee_id
    ).delete(synchronize_session=False)
    # 2. User có employee_id trỏ vào nhân viên này
    db.query(models.User).filter(
        models.User.employee_id == employee_id
    ).delete(synchronize_session=False)
    # 3. Sau đó mới xóa employee
    db.delete(emp)
    db.commit()


@router.post("/{employee_id}/register-face")
def register_face(
    employee_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Đăng ký khuôn mặt.
    - Admin: đăng ký cho bất kỳ nhân viên nào (qua trang /register-face)
    - Employee: chỉ đăng ký khuôn mặt của chính mình (qua trang /register-face-employee)
    """
    if current_user.role == "employee" and current_user.employee_id != employee_id:
        raise HTTPException(status_code=403, detail="Bạn chỉ có thể đăng ký khuôn mặt của chính mình")
    if current_user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewer không có quyền đăng ký khuôn mặt")
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên")

    # Hỗ trợ cả 1 ảnh (image_base64) lẫn nhiều ảnh (images_base64)
    images = payload.get("images_base64") or []
    single = payload.get("image_base64")
    if single and single not in images:
        images.insert(0, single)

    if not images:
        raise HTTPException(status_code=400, detail="Thiếu ảnh khuôn mặt")

    # Debug log
    print(f"[DEBUG] Nhận {len(images)} ảnh")
    for i, img in enumerate(images):
        prefix = img[:30] if img else "EMPTY"
        print(f"[DEBUG] Ảnh {i+1}: len={len(img)}, prefix={prefix}")

    encodings = get_face_encodings_multi(images)
    found = len(encodings) if encodings else 0
    print(f"[DEBUG] Encodings tìm được: {found} / {len(images)} ảnh")
    if not encodings:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "NO_FACE_DETECTED",
                "msg": f"Không phát hiện khuôn mặt trong {len(images)} ảnh. Đảm bảo: khuôn mặt rõ, đủ sáng, không đeo khẩu trang, nhìn thẳng vào camera.",
            }
        )

    # Lưu list of encodings (định dạng mới, tương thích ngược)
    emp.face_encoding = json.dumps(encodings)
    cache_update(emp.id, emp.face_encoding)
    db.add(emp)
    db.commit()
    db.refresh(emp)
    print(f"[OK] Đã lưu {len(encodings)} encoding cho {emp.full_name}")
    return {
        "message": "Đăng ký khuôn mặt thành công",
        "employee_id": employee_id,
        "encodings_count": len(encodings),
        "total_images": len(images),
    }
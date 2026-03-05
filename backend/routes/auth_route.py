from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from schemas import UserLogin, UserCreate, Token, UserOut
from auth import hash_password, verify_password, create_access_token, get_current_user, require_admin
import models

router = APIRouter()


class ChangePassword(BaseModel):
    current_password: str
    new_password: str

class UpdateRole(BaseModel):
    role: str  # "admin" | "viewer"

class UpdateUser(BaseModel):
    email: Optional[str] = None
    is_active: Optional[bool] = None
    role: Optional[str] = None


# ── Đăng ký ──────────────────────────────────────────────────────────────────
@router.post("/register", response_model=UserOut, status_code=201)
def register(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),   # Chỉ admin mới tạo được tài khoản mới
):
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username đã tồn tại")
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email đã tồn tại")
    user = models.User(
        username=payload.username,
        email=payload.email,
        password=hash_password(payload.password),
        role=payload.role or "viewer",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ── Đăng nhập ────────────────────────────────────────────────────────────────
@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password):
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Tài khoản đã bị vô hiệu hóa")
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": user}


# ── Thông tin cá nhân ────────────────────────────────────────────────────────
@router.get("/me", response_model=UserOut)
def me(current_user: models.User = Depends(get_current_user)):
    return current_user


# ── Đổi mật khẩu (tự đổi) ────────────────────────────────────────────────────
@router.post("/change-password")
def change_password(
    payload: ChangePassword,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.password):
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không đúng")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu mới phải có ít nhất 6 ký tự")
    current_user.password = hash_password(payload.new_password)
    db.commit()
    return {"message": "Đổi mật khẩu thành công"}


# ── Danh sách tài khoản (admin) ───────────────────────────────────────────────
@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    return db.query(models.User).order_by(models.User.id).all()


# ── Cập nhật tài khoản (admin: đổi role, khóa/mở) ────────────────────────────
@router.put("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UpdateUser,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    if payload.role is not None:
        if payload.role not in ["admin", "viewer"]:
            raise HTTPException(status_code=400, detail="Role phải là admin hoặc viewer")
        user.role = payload.role
    if payload.email is not None:
        user.email = payload.email
    if payload.is_active is not None:
        # Không cho phép tự khóa chính mình
        if user.id == current_user.id and not payload.is_active:
            raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản của mình")
        user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return user


# ── Reset mật khẩu (admin reset cho người khác) ──────────────────────────────
@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    new_password = payload.get("new_password", "")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu phải có ít nhất 6 ký tự")
    user.password = hash_password(new_password)
    db.commit()
    return {"message": f"Đã reset mật khẩu cho {user.username}"}


# ── Xóa tài khoản (admin) ────────────────────────────────────────────────────
@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Không thể xóa tài khoản của chính mình")
    db.delete(user)
    db.commit()
    return {"message": f"Đã xóa tài khoản {user.username}"}
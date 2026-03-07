from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


# ─── Auth ────────────────────────────────────────────────────────────────────
class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: Optional[str] = "admin"

class UserOut(BaseModel):
    id: int
    username: str
    email: str
    role: str
    is_active: bool
    employee_id: Optional[int] = None
    created_at: datetime
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


# ─── Employee ────────────────────────────────────────────────────────────────
class EmployeeCreate(BaseModel):
    employee_code: str
    full_name: str
    email: Optional[EmailStr] = None
    department: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    avatar_url: Optional[str] = None

class EmployeeUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    department: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: Optional[bool] = None

class EmployeeOut(BaseModel):
    id: int
    employee_code: str
    full_name: str
    email: Optional[str]
    department: Optional[str]
    position: Optional[str]
    phone: Optional[str]
    avatar_url: Optional[str]
    is_active: bool
    created_at: datetime
    face_encoding: Optional[str] = None   # dùng để check has_face ở frontend
    has_face: Optional[bool] = False      # True nếu đã đăng ký khuôn mặt

    class Config:
        from_attributes = True

    def model_post_init(self, __context):
        # Tự động tính has_face từ face_encoding
        object.__setattr__(self, "has_face", self.face_encoding is not None)
        # Ẩn face_encoding khỏi response (không trả về raw data)
        object.__setattr__(self, "face_encoding", None)


# ─── Attendance ───────────────────────────────────────────────────────────────
class AttendanceOut(BaseModel):
    id: int
    employee_id: int
    check_in: Optional[datetime]
    check_out: Optional[datetime]
    date: str
    status: str
    confidence: Optional[float]
    note: Optional[str]
    employee: Optional[EmployeeOut]
    class Config:
        from_attributes = True

class AttendanceCreate(BaseModel):
    employee_id: int
    status: Optional[str] = "present"
    note: Optional[str] = None

class FaceCheckIn(BaseModel):
    image_base64: str   # base64 encoded image from webcam
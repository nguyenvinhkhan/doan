from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class User(Base):
    __tablename__ = "users"

    id          = Column(Integer, primary_key=True, index=True)
    username    = Column(String(50), unique=True, nullable=False, index=True)
    email       = Column(String(100), unique=True, nullable=False)
    password    = Column(String(255), nullable=False)
    role        = Column(String(20), default="admin")   # admin | viewer | employee
    is_active   = Column(Boolean, default=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    employee = relationship("Employee", foreign_keys=[employee_id])


class Employee(Base):
    __tablename__ = "employees"

    id            = Column(Integer, primary_key=True, index=True)
    employee_code = Column(String(20), unique=True, nullable=False, index=True)
    full_name     = Column(String(100), nullable=False)
    email         = Column(String(100), unique=True)
    department    = Column(String(100))
    position      = Column(String(100))
    phone         = Column(String(20))
    avatar_url    = Column(Text)
    face_encoding = Column(Text)
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), onupdate=func.now())

    attendances = relationship("Attendance", back_populates="employee", cascade="all, delete-orphan")

    @property
    def has_face(self) -> bool:
        return self.face_encoding is not None


class Attendance(Base):
    __tablename__ = "attendances"

    id          = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    check_in    = Column(DateTime(timezone=True))
    check_out   = Column(DateTime(timezone=True))
    date        = Column(String(10), nullable=False, index=True)
    status      = Column(String(20), default="present")
    confidence  = Column(Float)
    note        = Column(Text)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    employee = relationship("Employee", back_populates="attendances")


class SystemConfig(Base):
    __tablename__ = "system_configs"

    id         = Column(Integer, primary_key=True, index=True)
    key        = Column(String(100), unique=True, nullable=False, index=True)
    value      = Column(String(255), nullable=False)
    label      = Column(String(200))
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
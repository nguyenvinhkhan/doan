from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_admin
import models

router = APIRouter()

# Cấu hình mặc định
DEFAULT_CONFIGS = [
    {
        "key": "late_hour",
        "value": "8",
        "label": "Giờ đi trễ (giờ)",
    },
    {
        "key": "late_minute",
        "value": "30",
        "label": "Phút đi trễ (phút)",
    },
    {
        "key": "work_start",
        "value": "07:00",
        "label": "Giờ bắt đầu làm việc",
    },
    {
        "key": "work_end",
        "value": "17:00",
        "label": "Giờ kết thúc làm việc",
    },
    {
        "key": "face_threshold",
        "value": "0.75",
        "label": "Ngưỡng nhận diện khuôn mặt (0.0 - 1.0)",
    },
]


def init_default_configs(db: Session):
    """Tạo cấu hình mặc định nếu chưa có."""
    for cfg in DEFAULT_CONFIGS:
        exists = db.query(models.SystemConfig).filter(
            models.SystemConfig.key == cfg["key"]
        ).first()
        if not exists:
            db.add(models.SystemConfig(**cfg))
    db.commit()


def get_config(db: Session, key: str) -> str:
    """Lấy giá trị cấu hình theo key, trả về giá trị mặc định nếu chưa có."""
    record = db.query(models.SystemConfig).filter(
        models.SystemConfig.key == key
    ).first()
    if record:
        return record.value
    # Tìm trong DEFAULT_CONFIGS
    for cfg in DEFAULT_CONFIGS:
        if cfg["key"] == key:
            return cfg["value"]
    return ""


@router.get("/")
def list_configs(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Lấy toàn bộ cấu hình hệ thống."""
    init_default_configs(db)
    configs = db.query(models.SystemConfig).all()
    return [
        {
            "id": c.id,
            "key": c.key,
            "value": c.value,
            "label": c.label,
            "updated_at": c.updated_at,
        }
        for c in configs
    ]


@router.put("/{key}")
def update_config(
    key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Cập nhật giá trị cấu hình theo key."""
    value = payload.get("value")
    if value is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Thiếu giá trị value")
    
    # Validate giá trị
    if key in ["late_hour"] and not str(value).isdigit():
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Giờ phải là số nguyên (0-23)")
    if key in ["late_minute"] and not str(value).isdigit():
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Phút phải là số nguyên (0-59)")
    if key == "face_threshold":
        try:
            v = float(value)
            if not (0.0 <= v <= 1.0):
                from fastapi import HTTPException
                raise HTTPException(status_code=400, detail="Ngưỡng phải từ 0.0 đến 1.0")
        except ValueError:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Ngưỡng phải là số thực")

    record = db.query(models.SystemConfig).filter(
        models.SystemConfig.key == key
    ).first()

    if record:
        record.value = str(value)
    else:
        # Tìm label mặc định
        label = next((c["label"] for c in DEFAULT_CONFIGS if c["key"] == key), key)
        db.add(models.SystemConfig(key=key, value=str(value), label=label))

    db.commit()
    if record:
        db.refresh(record)
    return {
        "message": "Cập nhật thành công",
        "key": key,
        "value": str(value),
        "updated_at": record.updated_at if record else None
    }
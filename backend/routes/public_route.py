"""
Route công khai — không cần JWT.
Dùng cho trang điểm danh realtime (màn hình kiosk/tablet).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta

VN_TZ = timezone(timedelta(hours=7))
from database import get_db
from ai.detector import get_face_encoding, compare_faces
from routes.config_route import get_config
from schemas import FaceCheckIn
import models
import numpy as np

router = APIRouter()


def _cosine_sim(a, b) -> float:
    a, b = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _best_sim_against_stored(stored_json: str, unknown_vec) -> float:
    """Tính similarity cao nhất giữa unknown và tất cả encoding đã lưu."""
    import json
    stored = json.loads(stored_json)
    if isinstance(stored[0], list):
        known_vecs = [np.array(e, dtype=np.float32) for e in stored]
    else:
        known_vecs = [np.array(stored, dtype=np.float32)]
    sims = [_cosine_sim(kv, unknown_vec) for kv in known_vecs]
    weights = np.array([max(0, s) ** 2 for s in sims])
    best_top = max(sims)
    best_avg = float(np.average(sims, weights=weights)) if weights.sum() > 0 else best_top
    # Trả về điểm kết hợp: 70% max + 30% weighted avg
    return round(best_top * 0.7 + best_avg * 0.3, 4)


@router.post("/face-checkin")
def public_face_checkin(
    payload: FaceCheckIn,
    db: Session = Depends(get_db),
):
    """Điểm danh công khai — không cần token."""
    now   = datetime.now(VN_TZ)
    today = now.date().isoformat()

    employees = db.query(models.Employee).filter(
        models.Employee.is_active == True,
        models.Employee.face_encoding.isnot(None),
    ).all()

    if not employees:
        raise HTTPException(status_code=404, detail={
            "code": "NO_EMPLOYEES",
            "msg": "Chưa có nhân viên nào đăng ký khuôn mặt"
        })

    threshold = float(get_config(db, "face_threshold"))

    # ── Bước 1: Trích xuất encoding từ ảnh chụp ──────────────────────────────
    unknown_enc = get_face_encoding(payload.image_base64)
    if unknown_enc is None:
        raise HTTPException(status_code=404, detail={
            "code": "NO_FACE",
            "msg": "Không phát hiện khuôn mặt. Nhìn thẳng vào camera và đảm bảo đủ ánh sáng."
        })

    unknown_vec = np.array(unknown_enc, dtype=np.float32)

    # ── Bước 2: So sánh với TẤT CẢ nhân viên, chọn người khớp NHẤT ─────────
    scores = []
    for emp in employees:
        sim = _best_sim_against_stored(emp.face_encoding, unknown_vec)
        scores.append((emp, sim))

    # Sắp xếp giảm dần theo điểm
    scores.sort(key=lambda x: x[1], reverse=True)
    best_emp, best_sim = scores[0]
    second_sim = scores[1][1] if len(scores) > 1 else 0.0

    # ── Bước 3: Kiểm tra ngưỡng + khoảng cách với người thứ 2 ───────────────
    # Yêu cầu: vượt threshold VÀ cách xa người thứ 2 ít nhất 3%
    margin = best_sim - second_sim
    is_match = best_sim >= threshold and (len(scores) == 1 or margin >= 0.03)

    if not is_match:
        # Phân loại lỗi rõ ràng
        if best_sim >= threshold and margin < 0.03:
            raise HTTPException(status_code=404, detail={
                "code": "AMBIGUOUS",
                "msg": f"Khuôn mặt không rõ ràng ({best_sim*100:.0f}%). Nhìn thẳng và chụp lại.",
                "confidence": round(best_sim, 4),
            })
        elif best_sim >= threshold * 0.82:
            raise HTTPException(status_code=404, detail={
                "code": "LOW_CONFIDENCE",
                "msg": f"Gần khớp ({best_sim*100:.0f}%) nhưng chưa đủ tin cậy. Cải thiện ánh sáng.",
                "confidence": round(best_sim, 4),
            })
        elif best_sim >= threshold * 0.65:
            raise HTTPException(status_code=404, detail={
                "code": "POOR_LIGHT",
                "msg": "Không nhận diện được. Kiểm tra ánh sáng và nhìn thẳng vào camera.",
                "confidence": round(best_sim, 4),
            })
        else:
            raise HTTPException(status_code=404, detail={
                "code": "NOT_REGISTERED",
                "msg": "Khuôn mặt chưa đăng ký hoặc quá khác biệt. Liên hệ quản trị viên.",
                "confidence": round(best_sim, 4),
            })

    # ── Bước 4: Ghi chấm công ────────────────────────────────────────────────
    record = db.query(models.Attendance).filter(
        models.Attendance.employee_id == best_emp.id,
        models.Attendance.date == today,
    ).first()

    if record:
        if record.check_out:
            raise HTTPException(status_code=400, detail={
                "code": "ALREADY_CHECKED_OUT",
                "msg": f"{best_emp.full_name} đã điểm danh ra ca rồi.",
            })
        record.check_out = now
        db.commit()
        return {
            "action":         "check_out",
            "employee":       best_emp.full_name,
            "employee_code":  best_emp.employee_code,
            "department":     best_emp.department,
            "confidence":     round(best_sim, 4),
            "confidence_pct": f"{best_sim*100:.1f}%",
            "time":           now.isoformat(),
        }
    else:
        late_hour   = int(get_config(db, "late_hour"))
        late_minute = int(get_config(db, "late_minute"))
        status = "late" if (now.hour > late_hour or (now.hour == late_hour and now.minute >= late_minute)) else "present"

        db.add(models.Attendance(
            employee_id=best_emp.id,
            check_in=now,
            date=today,
            status=status,
            confidence=round(best_sim, 4),
        ))
        db.commit()
        return {
            "action":          "check_in",
            "employee":        best_emp.full_name,
            "employee_code":   best_emp.employee_code,
            "department":      best_emp.department,
            "confidence":      round(best_sim, 4),
            "confidence_pct":  f"{best_sim*100:.1f}%",
            "status":          status,
            "late_threshold":  f"{late_hour:02d}:{late_minute:02d}",
            "time":            now.isoformat(),
        }


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
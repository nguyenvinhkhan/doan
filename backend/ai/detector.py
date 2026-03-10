"""
FaceAttend AI — LBP gốc (đã kiểm chứng) + multi-image + augmentation
Encoding: 6400 chiều (5×5 grid × 256 bins) — KHÔNG THAY ĐỔI
Threshold: 0.72 — KHÔNG THAY ĐỔI
Cải tiến thêm:
  - Hỗ trợ 5 ảnh × augmentation → tối đa 25 encodings/nhân viên
  - EXIF rotation fix cho mobile
  - Thử nhiều điều kiện ánh sáng khi detect
  - unified_face_match dùng Top-K voting thay vì 1 encoding
"""
import base64
import json
import numpy as np
from io import BytesIO
from PIL import Image, ImageOps
from typing import Optional, Tuple
import cv2

_CASCADE_FRONTAL = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
_CASCADE_ALT     = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
_CASCADE_PROFILE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")

THRESHOLD = 0.72   # giữ nguyên threshold gốc


# ── Tiện ích ──────────────────────────────────────────────────────────────────

def _base64_to_bgr(image_base64: str) -> np.ndarray:
    if "," in image_base64:
        image_base64 = image_base64.split(",")[1]
    img = Image.open(BytesIO(base64.b64decode(image_base64)))
    img = ImageOps.exif_transpose(img).convert("RGB")   # fix EXIF mobile
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def _preprocess_gray(bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    return gray


# ── Phát hiện mặt (giữ nguyên logic gốc + thêm thử ánh sáng) ─────────────────

def _detect_faces(gray: np.ndarray):
    for scale in [1.05, 1.1, 1.15, 1.2]:
        for neighbors in [3, 4, 5]:
            faces = _CASCADE_FRONTAL.detectMultiScale(
                gray, scaleFactor=scale, minNeighbors=neighbors,
                minSize=(40, 40), flags=cv2.CASCADE_SCALE_IMAGE
            )
            if len(faces) > 0:
                return faces
    faces = _CASCADE_ALT.detectMultiScale(gray, 1.1, 3, minSize=(40, 40))
    if len(faces) > 0:
        return faces
    faces = _CASCADE_PROFILE.detectMultiScale(gray, 1.1, 3, minSize=(40, 40))
    if len(faces) > 0:
        return faces
    return []


def _get_best_face(bgr: np.ndarray):
    """Thử ảnh gốc → sáng hơn → tối hơn → lật ngang."""
    # Resize nếu quá lớn (tăng tốc detect)
    h, w = bgr.shape[:2]
    if w > 640:
        scale = 640 / w
        bgr = cv2.resize(bgr, (640, int(h * scale)), interpolation=cv2.INTER_AREA)

    attempts = [
        bgr,
        cv2.convertScaleAbs(bgr, alpha=1.5, beta=30),   # thiếu sáng
        cv2.convertScaleAbs(bgr, alpha=0.7, beta=0),    # quá sáng
        cv2.flip(bgr, 1),                                # webcam mirror
    ]
    for img in attempts:
        gray = _preprocess_gray(img)
        faces = _detect_faces(gray)
        if len(faces) > 0:
            largest = max(faces, key=lambda f: f[2] * f[3])
            # Trả về gray từ ảnh gốc (không flip/adjust) để encoding nhất quán
            gray_orig = _preprocess_gray(bgr)
            return gray_orig, largest
    return None, None


# ── Trích xuất đặc trưng — LBP gốc (6400 chiều) ─────────────────────────────

def _extract_lbph_histogram(gray: np.ndarray, face_rect) -> np.ndarray:
    """
    LBP histogram gốc — 5×5 grid × 256 bins = 6400 chiều.
    Giữ nguyên 100% logic gốc đã được kiểm chứng hoạt động tốt.
    """
    x, y, w, h = face_rect
    pad_x = int(w * 0.1);  pad_y = int(h * 0.1)
    x1 = max(0, x - pad_x);  y1 = max(0, y - pad_y)
    x2 = min(gray.shape[1], x + w + pad_x)
    y2 = min(gray.shape[0], y + h + pad_y)
    face_roi = cv2.resize(gray[y1:y2, x1:x2], (100, 100))

    lbp_image = np.zeros_like(face_roi)
    for i in range(1, face_roi.shape[0] - 1):
        for j in range(1, face_roi.shape[1] - 1):
            center = int(face_roi[i, j])
            binary = (
                (int(face_roi[i-1, j-1]) >= center) << 7 |
                (int(face_roi[i-1, j  ]) >= center) << 6 |
                (int(face_roi[i-1, j+1]) >= center) << 5 |
                (int(face_roi[i,   j+1]) >= center) << 4 |
                (int(face_roi[i+1, j+1]) >= center) << 3 |
                (int(face_roi[i+1, j  ]) >= center) << 2 |
                (int(face_roi[i+1, j-1]) >= center) << 1 |
                (int(face_roi[i,   j-1]) >= center) << 0
            )
            lbp_image[i, j] = binary

    grid = 5
    h_cell = lbp_image.shape[0] // grid
    w_cell = lbp_image.shape[1] // grid
    hist_full = []
    for r in range(grid):
        for c in range(grid):
            cell = lbp_image[r*h_cell:(r+1)*h_cell, c*w_cell:(c+1)*w_cell]
            hist = cv2.calcHist([cell], [0], None, [256], [0, 256])
            hist = cv2.normalize(hist, hist).flatten()
            hist_full.extend(hist.tolist())
    return np.array(hist_full, dtype=np.float32)


# ── Augmentation nhẹ khi đăng ký ─────────────────────────────────────────────

def _augment_bgr(bgr: np.ndarray) -> list:
    """
    4 biến thể nhẹ — chỉ thay đổi ánh sáng, không xoay/blur
    để giữ LBP pattern ổn định (LBP nhạy cảm với xoay).
    """
    return [
        cv2.convertScaleAbs(bgr, alpha=0.80, beta=0),   # tối hơn
        cv2.convertScaleAbs(bgr, alpha=0.90, beta=0),
        cv2.convertScaleAbs(bgr, alpha=1.10, beta=0),   # sáng hơn
        cv2.convertScaleAbs(bgr, alpha=1.20, beta=0),
    ]


# ── Public API ────────────────────────────────────────────────────────────────

def get_face_encoding(image_base64: str) -> Optional[list]:
    """Trả về 1 encoding (6400-dim) hoặc None."""
    try:
        bgr = _base64_to_bgr(image_base64)
    except Exception:
        return None
    gray, face = _get_best_face(bgr)
    if face is None:
        return None
    return _extract_lbph_histogram(gray, face).tolist()


def get_face_encodings_multi(images_base64: list) -> Optional[list]:
    """
    Mỗi ảnh → 1 gốc + 4 aug (chỉ brightness) = 5 encodings.
    5 ảnh → tối đa 25 encodings.
    Tất cả đều 6400 chiều — tương thích ngược với DB cũ.
    """
    encodings = []
    for idx, img_b64 in enumerate(images_base64):
        try:
            bgr = _base64_to_bgr(img_b64)
        except Exception as e:
            print(f"[WARN] Ảnh {idx+1} decode lỗi: {e}")
            continue

        gray, face = _get_best_face(bgr)
        if face is None:
            print(f"[WARN] Ảnh {idx+1}: không phát hiện mặt")
            continue

        # Encoding gốc
        enc = _extract_lbph_histogram(gray, face)
        encodings.append(enc.tolist())

        # 4 biến thể brightness
        for aug_bgr in _augment_bgr(bgr):
            gray_aug, face_aug = _get_best_face(aug_bgr)
            if face_aug is not None:
                enc_aug = _extract_lbph_histogram(gray_aug, face_aug)
                encodings.append(enc_aug.tolist())

        print(f"[INFO] Ảnh {idx+1}: OK — tổng {len(encodings)} encodings")

    return encodings if encodings else None


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na = np.linalg.norm(a);  nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _best_score(known_vecs: list, unknown_vec: np.ndarray) -> float:
    """
    Top-3 voting: trung bình 3 encoding khớp nhất.
    Ổn định hơn chỉ dùng top1 khi có nhiều encoding.
    Bỏ qua encoding sai kích thước (dữ liệu cũ).
    """
    sims = []
    for kv in known_vecs:
        if kv.shape != unknown_vec.shape:
            continue
        sims.append(_cosine_similarity(kv, unknown_vec))
    if not sims:
        return 0.0
    sims_arr = np.array(sims)
    top3 = np.sort(sims_arr)[::-1][:3]
    # 70% top1 + 30% avg top3 — cân bằng giữa peak và ổn định
    return round(float(sims_arr.max()) * 0.70 + float(top3.mean()) * 0.30, 4)


def unified_face_match(
    employees: list,
    unknown_image_base64: str,
    threshold: float = THRESHOLD,
) -> dict:
    unknown_enc = get_face_encoding(unknown_image_base64)
    if unknown_enc is None:
        return {"matched": False, "employee": None, "confidence": 0.0,
                "error_code": "NO_FACE",
                "error_msg": "Không phát hiện khuôn mặt. Nhìn thẳng vào camera và đảm bảo đủ ánh sáng."}

    unknown_vec = np.array(unknown_enc, dtype=np.float32)

    scores = []
    for emp in employees:
        try:
            stored = json.loads(emp.face_encoding)
            known_vecs = [np.array(e, dtype=np.float32) for e in stored] \
                if isinstance(stored[0], list) else [np.array(stored, dtype=np.float32)]
            score = _best_score(known_vecs, unknown_vec)
        except Exception:
            score = 0.0
        scores.append((emp, score))

    scores.sort(key=lambda x: x[1], reverse=True)
    best_emp, best_sim = scores[0]
    second_sim = scores[1][1] if len(scores) > 1 else 0.0
    margin = best_sim - second_sim

    is_match = best_sim >= threshold and (len(scores) == 1 or margin >= 0.03)

    print(f"[AI] best={best_sim:.3f} second={second_sim:.3f} margin={margin:.3f}")

    if not is_match:
        if best_sim >= threshold and margin < 0.03:
            code, msg = "AMBIGUOUS", f"Khuôn mặt không rõ ràng ({best_sim*100:.0f}%). Nhìn thẳng và chụp lại."
        elif best_sim >= threshold * 0.85:
            code, msg = "LOW_CONFIDENCE", f"Gần khớp ({best_sim*100:.0f}%) nhưng chưa đủ tin cậy. Cải thiện ánh sáng."
        elif best_sim >= threshold * 0.65:
            code, msg = "POOR_LIGHT", "Không nhận diện được. Kiểm tra ánh sáng và nhìn thẳng vào camera."
        else:
            code, msg = "NOT_REGISTERED", "Khuôn mặt chưa đăng ký hoặc quá khác biệt. Liên hệ quản trị viên."
        return {"matched": False, "employee": None, "confidence": round(best_sim, 4),
                "error_code": code, "error_msg": msg}

    return {"matched": True, "employee": best_emp, "confidence": round(best_sim, 4),
            "error_code": None, "error_msg": None}


def compare_faces(
    known_encoding_json: str,
    unknown_image_base64: str,
    threshold: float = THRESHOLD,
) -> Tuple[bool, float]:
    unknown_enc = get_face_encoding(unknown_image_base64)
    if unknown_enc is None:
        return False, 0.0
    unknown_vec = np.array(unknown_enc, dtype=np.float32)
    stored = json.loads(known_encoding_json)
    known_vecs = [np.array(e, dtype=np.float32) for e in stored] \
        if isinstance(stored[0], list) else [np.array(stored, dtype=np.float32)]
    score = _best_score(known_vecs, unknown_vec)
    return score >= threshold, score


def detect_faces_in_image(image_base64: str) -> int:
    try:
        bgr = _base64_to_bgr(image_base64)
        gray = _preprocess_gray(bgr)
        return len(_detect_faces(gray))
    except Exception:
        return 0
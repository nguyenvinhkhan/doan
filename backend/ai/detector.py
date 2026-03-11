"""
FaceAttend AI — LBP nâng cấp toàn diện
Encoding: 1475 chiều (Uniform LBP 5×5 grid × 59 bins)
Threshold: 0.68
Cải tiến:
  - CLAHE chuẩn hóa ánh sáng
  - Blur filter loại ảnh mờ
  - Center crop 10% border bỏ nhiễu tóc/tai
  - Uniform LBP (59 bins) — rotation invariant
  - Normalize vector trước cosine
  - Weighted voting thay top-3 đơn giản
  - Cache encodings RAM
  - EXIF rotation fix cho mobile
  - Multi-image + augmentation khi đăng ký
"""
import base64
import json
import numpy as np
from io import BytesIO
from PIL import Image, ImageOps
from typing import Optional, Tuple
import cv2
import threading

_CASCADE_FRONTAL = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
_CASCADE_ALT     = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
_CASCADE_PROFILE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")

THRESHOLD   = 0.68
BLUR_THRESH = 50.0
MIN_FACE_PX = 60
N_BINS      = 59

# ── Uniform LBP lookup table ──────────────────────────────────────────────────
def _build_uniform_lbp_table():
    table = np.zeros(256, dtype=np.int32)
    uniform_idx = 0
    for i in range(256):
        bits = format(i, '08b')
        transitions = sum(bits[j] != bits[(j+1) % 8] for j in range(8))
        if transitions <= 2:
            table[i] = uniform_idx
            uniform_idx += 1
        else:
            table[i] = 58
    return table

_UNIFORM_TABLE = _build_uniform_lbp_table()

# ── Cache RAM ─────────────────────────────────────────────────────────────────
_cache_lock = threading.Lock()
_cache: dict = {}

def cache_update(emp_id: int, encodings_json: str):
    try:
        stored = json.loads(encodings_json)
        vecs = [np.array(e, dtype=np.float32) for e in stored] \
               if isinstance(stored[0], list) else [np.array(stored, dtype=np.float32)]
        with _cache_lock:
            _cache[emp_id] = vecs
    except Exception:
        pass

def cache_delete(emp_id: int):
    with _cache_lock:
        _cache.pop(emp_id, None)

def cache_load_all(employees: list):
    with _cache_lock:
        _cache.clear()
        for emp in employees:
            try:
                stored = json.loads(emp.face_encoding)
                vecs = [np.array(e, dtype=np.float32) for e in stored] \
                       if isinstance(stored[0], list) else [np.array(stored, dtype=np.float32)]
                _cache[emp.id] = vecs
            except Exception:
                pass
    print(f"[CACHE] Loaded {len(_cache)} nhân viên vào RAM")

# ── Tiện ích ──────────────────────────────────────────────────────────────────
def _base64_to_bgr(image_base64: str) -> np.ndarray:
    if "," in image_base64:
        image_base64 = image_base64.split(",")[1]
    img = Image.open(BytesIO(base64.b64decode(image_base64)))
    img = ImageOps.exif_transpose(img).convert("RGB")
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

def _preprocess_gray(bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    return gray

def _is_blurry(face_gray: np.ndarray) -> bool:
    return cv2.Laplacian(face_gray, cv2.CV_64F).var() < BLUR_THRESH

# ── Phát hiện mặt ─────────────────────────────────────────────────────────────
def _detect_faces(gray: np.ndarray):
    for scale in [1.05, 1.1, 1.15, 1.2]:
        for neighbors in [3, 4, 5]:
            faces = _CASCADE_FRONTAL.detectMultiScale(
                gray, scaleFactor=scale, minNeighbors=neighbors,
                minSize=(MIN_FACE_PX, MIN_FACE_PX), flags=cv2.CASCADE_SCALE_IMAGE)
            if len(faces) > 0:
                return faces
    faces = _CASCADE_ALT.detectMultiScale(gray, 1.1, 3, minSize=(MIN_FACE_PX, MIN_FACE_PX))
    if len(faces) > 0:
        return faces
    faces = _CASCADE_PROFILE.detectMultiScale(gray, 1.1, 3, minSize=(MIN_FACE_PX, MIN_FACE_PX))
    if len(faces) > 0:
        return faces
    return []

def _get_best_face(bgr: np.ndarray):
    h, w = bgr.shape[:2]
    if w > 640:
        scale = 640 / w
        bgr = cv2.resize(bgr, (640, int(h * scale)), interpolation=cv2.INTER_AREA)
    attempts = [
        bgr,
        cv2.convertScaleAbs(bgr, alpha=1.5, beta=30),
        cv2.convertScaleAbs(bgr, alpha=0.7, beta=0),
        cv2.flip(bgr, 1),
    ]
    for img in attempts:
        gray = _preprocess_gray(img)
        faces = _detect_faces(gray)
        if len(faces) > 0:
            largest = max(faces, key=lambda f: f[2] * f[3])
            return _preprocess_gray(bgr), largest
    return None, None

# ── Uniform LBP encoding (1475 chiều) ─────────────────────────────────────────
def _extract_uniform_lbp(gray: np.ndarray, face_rect) -> Optional[np.ndarray]:
    x, y, w, h = face_rect
    cx = int(w * 0.10); cy = int(h * 0.10)
    x1 = max(0, x + cx);  y1 = max(0, y + cy)
    x2 = min(gray.shape[1], x + w - cx)
    y2 = min(gray.shape[0], y + h - cy)
    face_roi = gray[y1:y2, x1:x2]
    if face_roi.size == 0:
        return None
    if _is_blurry(face_roi):
        return None
    face_roi = cv2.resize(face_roi, (100, 100))

    lbp_image = np.zeros((100, 100), dtype=np.int32)
    for i in range(1, 99):
        for j in range(1, 99):
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
            lbp_image[i, j] = _UNIFORM_TABLE[binary]

    grid = 5
    h_cell = 100 // grid
    w_cell = 100 // grid
    hist_full = []
    for r in range(grid):
        for c in range(grid):
            cell = lbp_image[r*h_cell:(r+1)*h_cell, c*w_cell:(c+1)*w_cell]
            hist = np.bincount(cell.flatten(), minlength=N_BINS).astype(np.float32)
            s = hist.sum()
            if s > 0:
                hist /= s
            hist_full.extend(hist.tolist())

    vec = np.array(hist_full, dtype=np.float32)
    n = np.linalg.norm(vec)
    if n > 0:
        vec = vec / n
    return vec

# ── Augmentation ──────────────────────────────────────────────────────────────
def _augment_bgr(bgr: np.ndarray) -> list:
    return [
        cv2.convertScaleAbs(bgr, alpha=0.80, beta=0),
        cv2.convertScaleAbs(bgr, alpha=0.90, beta=0),
        cv2.convertScaleAbs(bgr, alpha=1.10, beta=0),
        cv2.convertScaleAbs(bgr, alpha=1.20, beta=0),
    ]

# ── Public API ────────────────────────────────────────────────────────────────
def get_face_encoding(image_base64: str) -> Optional[list]:
    try:
        bgr = _base64_to_bgr(image_base64)
    except Exception:
        return None
    gray, face = _get_best_face(bgr)
    if face is None:
        return None
    vec = _extract_uniform_lbp(gray, face)
    return vec.tolist() if vec is not None else None

def get_face_encodings_multi(images_base64: list) -> Optional[list]:
    encodings = []
    for idx, img_b64 in enumerate(images_base64):
        try:
            bgr = _base64_to_bgr(img_b64)
        except Exception as e:
            print(f"[WARN] Ảnh {idx+1} decode lỗi: {e}"); continue
        gray, face = _get_best_face(bgr)
        if face is None:
            print(f"[WARN] Ảnh {idx+1}: không phát hiện mặt"); continue
        vec = _extract_uniform_lbp(gray, face)
        if vec is None:
            print(f"[WARN] Ảnh {idx+1}: ảnh mờ, bỏ qua"); continue
        encodings.append(vec.tolist())
        for aug_bgr in _augment_bgr(bgr):
            gray_aug, face_aug = _get_best_face(aug_bgr)
            if face_aug is not None:
                vec_aug = _extract_uniform_lbp(gray_aug, face_aug)
                if vec_aug is not None:
                    encodings.append(vec_aug.tolist())
        print(f"[INFO] Ảnh {idx+1}: OK — tổng {len(encodings)} encodings")
    return encodings if encodings else None

# ── Scoring ───────────────────────────────────────────────────────────────────
def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))

def _weighted_score(known_vecs: list, unknown_vec: np.ndarray) -> float:
    sims = [_cosine_similarity(kv, unknown_vec)
            for kv in known_vecs if kv.shape == unknown_vec.shape]
    if not sims:
        return 0.0
    top5 = np.sort(sims)[::-1][:5]
    weights = np.maximum(top5, 0)
    total_w = weights.sum()
    return round(float(np.dot(top5, weights) / total_w), 4) if total_w > 0 else 0.0

# ── Match ─────────────────────────────────────────────────────────────────────
def unified_face_match(employees: list, unknown_image_base64: str,
                       threshold: float = THRESHOLD) -> dict:
    unknown_enc = get_face_encoding(unknown_image_base64)
    if unknown_enc is None:
        return {"matched": False, "employee": None, "confidence": 0.0,
                "error_code": "NO_FACE",
                "error_msg": "Không phát hiện khuôn mặt. Nhìn thẳng vào camera và đảm bảo đủ ánh sáng."}

    unknown_vec = np.array(unknown_enc, dtype=np.float32)
    scores = []

    with _cache_lock:
        use_cache = len(_cache) > 0

    if use_cache:
        with _cache_lock:
            cache_snapshot = dict(_cache)
        emp_map = {emp.id: emp for emp in employees}
        for emp_id, known_vecs in cache_snapshot.items():
            emp = emp_map.get(emp_id)
            if emp is None:
                continue
            scores.append((emp, _weighted_score(known_vecs, unknown_vec)))
    else:
        for emp in employees:
            try:
                stored = json.loads(emp.face_encoding)
                known_vecs = [np.array(e, dtype=np.float32) for e in stored] \
                    if isinstance(stored[0], list) else [np.array(stored, dtype=np.float32)]
                score = _weighted_score(known_vecs, unknown_vec)
            except Exception:
                score = 0.0
            scores.append((emp, score))

    if not scores:
        return {"matched": False, "employee": None, "confidence": 0.0,
                "error_code": "NO_EMPLOYEE", "error_msg": "Chưa có nhân viên nào đăng ký."}

    scores.sort(key=lambda x: x[1], reverse=True)
    best_emp, best_sim = scores[0]
    second_sim = scores[1][1] if len(scores) > 1 else 0.0
    margin = best_sim - second_sim
    is_match = best_sim >= threshold and (len(scores) == 1 or margin >= 0.02)

    print(f"[AI] best={best_sim:.3f} second={second_sim:.3f} margin={margin:.3f} cache={'yes' if use_cache else 'no'}")

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

def compare_faces(known_encoding_json: str, unknown_image_base64: str,
                  threshold: float = THRESHOLD) -> Tuple[bool, float]:
    unknown_enc = get_face_encoding(unknown_image_base64)
    if unknown_enc is None:
        return False, 0.0
    unknown_vec = np.array(unknown_enc, dtype=np.float32)
    stored = json.loads(known_encoding_json)
    known_vecs = [np.array(e, dtype=np.float32) for e in stored] \
        if isinstance(stored[0], list) else [np.array(stored, dtype=np.float32)]
    score = _weighted_score(known_vecs, unknown_vec)
    return score >= threshold, score

def detect_faces_in_image(image_base64: str) -> int:
    try:
        bgr = _base64_to_bgr(image_base64)
        gray = _preprocess_gray(bgr)
        return len(_detect_faces(gray))
    except Exception:
        return 0
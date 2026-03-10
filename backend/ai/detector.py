import base64
import json
import numpy as np
from io import BytesIO
from PIL import Image, ImageOps
from typing import Optional, Tuple
import cv2

_CASCADE_FRONTAL = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
_CASCADE_ALT2    = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
_CASCADE_PROFILE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
_EYE_CASCADE     = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye_tree_eyeglasses.xml")

FACE_SIZE = 128


# ── Tiện ích ──────────────────────────────────────────────────────────────────

def _base64_to_bgr(image_base64: str) -> np.ndarray:
    if "," in image_base64:
        image_base64 = image_base64.split(",")[1]
    img_bytes = base64.b64decode(image_base64)
    image = Image.open(BytesIO(img_bytes))
    image = ImageOps.exif_transpose(image)
    image = image.convert("RGB")
    return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)


def _preprocess(bgr: np.ndarray) -> np.ndarray:
    """Grayscale + CLAHE (bỏ bilateralFilter để tăng tốc)."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _resize_if_large(bgr: np.ndarray, max_w: int = 640) -> np.ndarray:
    h, w = bgr.shape[:2]
    if w <= max_w:
        return bgr
    return cv2.resize(bgr, (max_w, int(h * max_w / w)), interpolation=cv2.INTER_AREA)


# ── Phát hiện khuôn mặt ──────────────────────────────────────────────────────

def _nms_faces(faces: np.ndarray, overlap: float = 0.3) -> np.ndarray:
    if len(faces) == 0:
        return faces
    x1 = faces[:, 0].astype(float);  x2 = (faces[:, 0] + faces[:, 2]).astype(float)
    y1 = faces[:, 1].astype(float);  y2 = (faces[:, 1] + faces[:, 3]).astype(float)
    areas = (x2 - x1) * (y2 - y1)
    order = areas.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]; keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]]); yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]]); yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        order = order[1:][inter / (areas[i] + areas[order[1:]] - inter + 1e-6) < overlap]
    return faces[keep]


def _detect_faces(gray: np.ndarray) -> np.ndarray:
    all_faces = []
    for cascade, scale, neighbors in [
        (_CASCADE_FRONTAL, 1.1,  4),
        (_CASCADE_FRONTAL, 1.05, 3),
        (_CASCADE_ALT2,    1.1,  3),
        (_CASCADE_ALT2,    1.05, 3),
    ]:
        faces = cascade.detectMultiScale(
            gray, scaleFactor=scale, minNeighbors=neighbors,
            minSize=(40, 40), flags=cv2.CASCADE_SCALE_IMAGE
        )
        if len(faces) > 0:
            all_faces.append(faces)

    if not all_faces:
        faces = _CASCADE_PROFILE.detectMultiScale(gray, 1.1, 3, minSize=(40, 40))
        if len(faces) > 0:
            return np.array(faces)
        # Fallback cuối: rất dễ tính — chỉ lấy mặt lớn nhất
        for cascade in [_CASCADE_FRONTAL, _CASCADE_ALT2]:
            faces = cascade.detectMultiScale(
                gray, scaleFactor=1.05, minNeighbors=2,
                minSize=(30, 30), flags=cv2.CASCADE_SCALE_IMAGE
            )
            if len(faces) > 0:
                return np.array([max(faces, key=lambda f: f[2] * f[3])])
        return np.array([])

    return _nms_faces(np.vstack(all_faces))


def _get_best_face(bgr: np.ndarray) -> Tuple[Optional[np.ndarray], Optional[tuple]]:
    bgr_small = _resize_if_large(bgr, 640)
    sx = bgr.shape[1] / bgr_small.shape[1]
    sy = bgr.shape[0] / bgr_small.shape[0]

    attempts = [
        bgr_small,
        cv2.convertScaleAbs(bgr_small, alpha=1.5, beta=30),
        cv2.convertScaleAbs(bgr_small, alpha=0.7, beta=0),
        cv2.flip(bgr_small, 1),
    ]

    gray_orig = _preprocess(bgr)

    for i, img in enumerate(attempts):
        gray = _preprocess(img)
        faces = _detect_faces(gray)
        if len(faces) == 0:
            continue

        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        x, y, w, h = int(x*sx), int(y*sy), int(w*sx), int(h*sy)

        if i == 3:  # lật ngang → lấy lại tọa độ từ ảnh gốc
            faces2 = _detect_faces(gray_orig)
            if len(faces2) > 0:
                x, y, w, h = [int(v) for v in max(faces2, key=lambda f: f[2]*f[3])]

        return gray_orig, (x, y, w, h)

    return None, None


# ── Căn chỉnh khuôn mặt ──────────────────────────────────────────────────────

def _align_face(gray: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    pad = int(max(w, h) * 0.20)
    x0 = max(0, x - pad);  y0 = max(0, y - pad)
    x1 = min(gray.shape[1], x + w + pad);  y1 = min(gray.shape[0], y + h + pad)
    face_roi = gray[y0:y1, x0:x1]

    if face_roi.size == 0:
        roi = gray[max(0,y):min(gray.shape[0],y+h), max(0,x):min(gray.shape[1],x+w)]
        return cv2.resize(roi if roi.size > 0 else np.zeros((FACE_SIZE, FACE_SIZE), np.uint8),
                          (FACE_SIZE, FACE_SIZE))

    eyes = _EYE_CASCADE.detectMultiScale(face_roi, 1.1, 3, minSize=(10, 10))
    fh = y1 - y0
    eyes_valid = [e for e in eyes if e[1] < fh * 0.65] if len(eyes) >= 2 else []

    if len(eyes_valid) >= 2:
        eyes_valid = sorted(eyes_valid, key=lambda e: e[0])
        e1, e2 = eyes_valid[0], eyes_valid[1]
        cx1 = int(e1[0] + e1[2] // 2);  cy1 = int(e1[1] + e1[3] // 2)
        cx2 = int(e2[0] + e2[2] // 2);  cy2 = int(e2[1] + e2[3] // 2)
        angle = float(np.degrees(np.arctan2(cy2 - cy1, cx2 - cx1)))
        if abs(angle) > 2.0:
            M = cv2.getRotationMatrix2D((int((cx1+cx2)/2), int((cy1+cy2)/2)), angle, 1.0)
            face_roi = cv2.warpAffine(face_roi, M, (face_roi.shape[1], face_roi.shape[0]),
                                      flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    return cv2.resize(face_roi, (FACE_SIZE, FACE_SIZE), interpolation=cv2.INTER_CUBIC)


# ── Trích xuất đặc trưng ──────────────────────────────────────────────────────

def _lbp_vectorized(face: np.ndarray) -> np.ndarray:
    """LBP 8×8 grid, 256-bin/cell → 16384 chiều."""
    h, w = face.shape
    center = face[1:-1, 1:-1].astype(np.int32)
    neighbors = [face[0:-2,0:-2], face[0:-2,1:-1], face[0:-2,2:], face[1:-1,2:],
                 face[2:,2:], face[2:,1:-1], face[2:,0:-2], face[1:-1,0:-2]]
    lbp = np.zeros_like(center, dtype=np.uint8)
    for bit, nb in enumerate(neighbors):
        lbp |= ((nb.astype(np.int32) >= center) << bit).astype(np.uint8)
    grid = 8
    ch = (h - 2) // grid;  cw = (w - 2) // grid
    hists = []
    for r in range(grid):
        for c in range(grid):
            cell = lbp[r*ch:(r+1)*ch, c*cw:(c+1)*cw]
            hist, _ = np.histogram(cell, bins=256, range=(0, 256))
            hist = hist.astype(np.float32)
            s = hist.sum()
            hists.append(hist / s if s > 0 else hist)
    return np.concatenate(hists)


def _hog_descriptor(face: np.ndarray) -> np.ndarray:
    """HOG → 8100 chiều."""
    hog = cv2.HOGDescriptor(
        _winSize=(FACE_SIZE, FACE_SIZE), _blockSize=(16, 16),
        _blockStride=(8, 8), _cellSize=(8, 8), _nbins=9,
    )
    feat = hog.compute(face).flatten().astype(np.float32)
    norm = np.linalg.norm(feat)
    return feat / norm if norm > 0 else feat


def _gabor_descriptor(face: np.ndarray) -> np.ndarray:
    """Gabor 4 hướng × 3 tần số → 24 chiều."""
    responses = []
    for theta in [0, np.pi/4, np.pi/2, 3*np.pi/4]:
        for lam in [6, 10, 16]:
            kernel = cv2.getGaborKernel((15, 15), sigma=3.0, theta=theta,
                                        lambd=float(lam), gamma=0.5, psi=0, ktype=cv2.CV_32F)
            f = cv2.filter2D(face.astype(np.float32), cv2.CV_32F, kernel)
            responses.extend([f.mean(), f.std()])
    arr = np.array(responses, dtype=np.float32)
    norm = np.linalg.norm(arr)
    return arr / norm if norm > 0 else arr


def _extract_encoding(gray: np.ndarray, face_rect: tuple) -> np.ndarray:
    """
    LBP(50%) + HOG(40%) + Gabor(10%) → 24508 chiều, L2-normalized.
    Kích thước cố định — không bao giờ thay đổi.
    """
    x, y, w, h = face_rect
    face = _align_face(gray, x, y, w, h)
    lbp   = _lbp_vectorized(face)
    hog   = _hog_descriptor(face)
    gabor = _gabor_descriptor(face)
    for arr in [lbp, hog, gabor]:
        n = np.linalg.norm(arr)
        if n > 0: arr /= n
    combined = np.concatenate([lbp * 0.50, hog * 0.40, gabor * 0.10])
    norm = np.linalg.norm(combined)
    return combined / norm if norm > 0 else combined


# ── Augmentation ──────────────────────────────────────────────────────────────

def _augment_face(face: np.ndarray) -> list:
    """Xoay ±5°, ±10° + thay đổi độ sáng → 8 biến thể."""
    cx, cy = FACE_SIZE // 2, FACE_SIZE // 2
    result = []
    for angle in [-10, -5, 5, 10]:
        M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
        result.append(cv2.warpAffine(face, M, (FACE_SIZE, FACE_SIZE), borderMode=cv2.BORDER_REPLICATE))
    for alpha in [0.80, 0.90, 1.10, 1.20]:
        result.append(cv2.convertScaleAbs(face, alpha=alpha, beta=0))
    return result


def _encoding_from_aligned(face: np.ndarray) -> np.ndarray:
    """Tính encoding từ face đã align (không cần detect lại)."""
    lbp   = _lbp_vectorized(face)
    hog   = _hog_descriptor(face)
    gabor = _gabor_descriptor(face)
    for arr in [lbp, hog, gabor]:
        n = np.linalg.norm(arr)
        if n > 0: arr /= n
    combined = np.concatenate([lbp * 0.50, hog * 0.40, gabor * 0.10])
    norm = np.linalg.norm(combined)
    return combined / norm if norm > 0 else combined


# ── Public API ────────────────────────────────────────────────────────────────

def get_face_encoding(image_base64: str) -> Optional[list]:
    try:
        bgr = _base64_to_bgr(image_base64)
    except Exception:
        return None
    gray, face = _get_best_face(bgr)
    if face is None:
        return None
    return _extract_encoding(gray, face).tolist()


def get_face_encodings_multi(images_base64: list) -> Optional[list]:
    """Mỗi ảnh → 1 gốc + 8 augmented = 9 encodings. 5 ảnh → tối đa 45."""
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

        enc = _extract_encoding(gray, face)
        encodings.append(enc.tolist())

        x, y, w, h = face
        face_aligned = _align_face(gray, x, y, w, h)
        for aug in _augment_face(face_aligned):
            encodings.append(_encoding_from_aligned(aug).tolist())

        print(f"[INFO] Ảnh {idx+1}: OK — tổng {len(encodings)} encodings")

    return encodings if encodings else None


def _cosine_score(known_vecs: list, unknown_vec: np.ndarray) -> float:
    """70% top1 + 30% weighted-avg Top-5. Bỏ qua encoding sai kích thước."""
    sims = []
    for kv in known_vecs:
        if kv.shape != unknown_vec.shape:
            continue
        na = np.linalg.norm(kv);  nb = np.linalg.norm(unknown_vec)
        if na > 0 and nb > 0:
            sims.append(float(np.dot(kv, unknown_vec) / (na * nb)))
    if not sims:
        return 0.0
    sims_arr = np.array(sims)
    K = min(5, len(sims_arr))
    top_k = np.sort(sims_arr)[::-1][:K]
    weights = np.array([1.0 / (i + 1) for i in range(K)])
    return round(float(sims_arr.max()) * 0.70 + float(np.average(top_k, weights=weights)) * 0.30, 4)


def unified_face_match(
    employees: list,
    unknown_image_base64: str,
    threshold: float = 0.75,
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
            score = _cosine_score(known_vecs, unknown_vec)
        except Exception:
            score = 0.0
        scores.append((emp, score))

    scores.sort(key=lambda x: x[1], reverse=True)
    best_emp, best_sim = scores[0]
    second_sim = scores[1][1] if len(scores) > 1 else 0.0
    margin = best_sim - second_sim
    is_match = best_sim >= threshold and (len(scores) == 1 or margin >= 0.03)

    if not is_match:
        if best_sim >= threshold and margin < 0.03:
            code, msg = "AMBIGUOUS", f"Khuôn mặt không rõ ràng ({best_sim*100:.0f}%). Nhìn thẳng và chụp lại."
        elif best_sim >= threshold * 0.80:
            code, msg = "LOW_CONFIDENCE", f"Gần khớp ({best_sim*100:.0f}%) nhưng chưa đủ tin cậy. Cải thiện ánh sáng."
        elif best_sim >= threshold * 0.60:
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
    threshold: float = 0.75,
) -> Tuple[bool, float]:
    unknown_enc = get_face_encoding(unknown_image_base64)
    if unknown_enc is None:
        return False, 0.0
    unknown_vec = np.array(unknown_enc, dtype=np.float32)
    stored = json.loads(known_encoding_json)
    known_vecs = [np.array(e, dtype=np.float32) for e in stored] \
        if isinstance(stored[0], list) else [np.array(stored, dtype=np.float32)]
    score = _cosine_score(known_vecs, unknown_vec)
    return score >= threshold, score


def detect_faces_in_image(image_base64: str) -> int:
    try:
        bgr = _base64_to_bgr(image_base64)
    except Exception:
        return 0
    return len(_detect_faces(_preprocess(bgr)))
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

FACE_SIZE = 128   # kích thước chuẩn hóa


# ── Tiện ích ──────────────────────────────────────────────────────────────────

def _base64_to_bgr(image_base64: str) -> np.ndarray:
    if "," in image_base64:
        image_base64 = image_base64.split(",")[1]
    img_bytes = base64.b64decode(image_base64)
    image = Image.open(BytesIO(img_bytes))
    # Fix ảnh bị xoay do EXIF orientation trên camera mobile
    image = ImageOps.exif_transpose(image)
    image = image.convert("RGB")
    arr = np.array(image)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _preprocess(bgr: np.ndarray) -> np.ndarray:
    """Grayscale + CLAHE + bilateral filter."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    gray = cv2.bilateralFilter(gray, 7, 50, 50)
    return gray


# ── Phát hiện khuôn mặt ──────────────────────────────────────────────────────

def _nms_faces(faces, overlap=0.3):
    """Non-Maximum Suppression — loại bỏ bounding box trùng lặp."""
    if len(faces) == 0:
        return faces
    x1 = faces[:, 0].astype(float)
    y1 = faces[:, 1].astype(float)
    x2 = (faces[:, 0] + faces[:, 2]).astype(float)
    y2 = (faces[:, 1] + faces[:, 3]).astype(float)
    areas = (x2 - x1) * (y2 - y1)
    order = areas.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[1:][iou < overlap]
    return faces[keep]


def _detect_faces(gray: np.ndarray) -> np.ndarray:
    """Phát hiện mặt đa cascade, trả về array shape (N,4)."""
    all_faces = []
    params = [
        (_CASCADE_FRONTAL, 1.08, 4),
        (_CASCADE_FRONTAL, 1.12, 3),
        (_CASCADE_ALT2,    1.08, 3),
        (_CASCADE_ALT2,    1.12, 4),
    ]
    for cascade, scale, neighbors in params:
        faces = cascade.detectMultiScale(
            gray, scaleFactor=scale, minNeighbors=neighbors,
            minSize=(30, 30), flags=cv2.CASCADE_SCALE_IMAGE
        )
        if len(faces) > 0:
            all_faces.append(faces)

    if not all_faces:
        # Thử profile face
        faces = _CASCADE_PROFILE.detectMultiScale(gray, 1.1, 3, minSize=(30, 30))
        return np.array(faces) if len(faces) > 0 else np.array([])

    combined = np.vstack(all_faces)
    return _nms_faces(combined)


# ── Căn chỉnh khuôn mặt ──────────────────────────────────────────────────────

def _align_face(gray: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    """
    Căn chỉnh mặt theo 2 mắt: xoay + scale để 2 mắt luôn ở vị trí cố định.
    Tăng độ ổn định khi đầu nghiêng.
    """
    # Mở rộng vùng mặt 20% để có thêm context
    pad = int(max(w, h) * 0.15)
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(gray.shape[1], x + w + pad)
    y1 = min(gray.shape[0], y + h + pad)
    face_roi = gray[y0:y1, x0:x1]

    # Detect mắt trong vùng mặt
    eyes = _EYE_CASCADE.detectMultiScale(
        face_roi, scaleFactor=1.1, minNeighbors=4, minSize=(12, 12)
    )

    if len(eyes) >= 2:
        # Lọc mắt nằm trong nửa trên khuôn mặt
        fh = y1 - y0
        eyes_valid = [e for e in eyes if e[1] < fh * 0.65]
        if len(eyes_valid) >= 2:
            eyes_valid = sorted(eyes_valid, key=lambda e: e[0])
            e1, e2 = eyes_valid[0], eyes_valid[1]
            cx1 = e1[0] + e1[2] // 2
            cy1 = e1[1] + e1[3] // 2
            cx2 = e2[0] + e2[2] // 2
            cy2 = e2[1] + e2[3] // 2

            angle = np.degrees(np.arctan2(cy2 - cy1, cx2 - cx1))
            if abs(angle) > 1.5:
                cx_mid = int((cx1 + cx2) // 2)
                cy_mid = int((cy1 + cy2) // 2)
                M = cv2.getRotationMatrix2D((cx_mid, cy_mid), float(angle), 1.0)
                face_roi = cv2.warpAffine(
                    face_roi, M, (face_roi.shape[1], face_roi.shape[0]),
                    flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
                )

    face_resized = cv2.resize(face_roi, (FACE_SIZE, FACE_SIZE), interpolation=cv2.INTER_CUBIC)
    return face_resized


# ── Trích xuất đặc trưng ──────────────────────────────────────────────────────

def _lbp_vectorized(face: np.ndarray) -> np.ndarray:
    """
    LBP uniform (vectorized numpy) — nhanh và chính xác.
    Chia 8x8 grid, mỗi cell tính histogram 59-bin (uniform patterns).
    """
    h, w = face.shape
    # Tính LBP cho toàn bộ ảnh bằng shift (không dùng vòng for)
    center = face[1:-1, 1:-1].astype(np.int32)
    neighbors = [
        face[0:-2, 0:-2], face[0:-2, 1:-1], face[0:-2, 2:],
        face[1:-1, 2:],
        face[2:,   2:],   face[2:,   1:-1], face[2:,   0:-2],
        face[1:-1, 0:-2],
    ]
    lbp = np.zeros_like(center, dtype=np.uint8)
    for bit, nb in enumerate(neighbors):
        lbp |= ((nb.astype(np.int32) >= center) << bit).astype(np.uint8)

    # Chia grid 8x8
    grid = 8
    ch = (h - 2) // grid
    cw = (w - 2) // grid
    hists = []
    for r in range(grid):
        for c in range(grid):
            cell = lbp[r*ch:(r+1)*ch, c*cw:(c+1)*cw]
            hist, _ = np.histogram(cell, bins=256, range=(0, 256))
            hist = hist.astype(np.float32)
            norm = hist.sum()
            if norm > 0:
                hist /= norm
            hists.append(hist)
    return np.concatenate(hists)


def _hog_descriptor(face: np.ndarray) -> np.ndarray:
    """HOG với tham số tối ưu cho khuôn mặt 128x128."""
    hog = cv2.HOGDescriptor(
        _winSize=(FACE_SIZE, FACE_SIZE),
        _blockSize=(16, 16),
        _blockStride=(8, 8),
        _cellSize=(8, 8),
        _nbins=9,
    )
    feat = hog.compute(face).flatten().astype(np.float32)
    norm = np.linalg.norm(feat)
    return feat / norm if norm > 0 else feat


def _gabor_descriptor(face: np.ndarray) -> np.ndarray:
    """
    Gabor filter — nhạy cảm với texture vân da, góc nhìn khác nhau.
    4 hướng x 3 tần số = 12 filter.
    """
    responses = []
    for theta in [0, np.pi/4, np.pi/2, 3*np.pi/4]:
        for freq in [0.1, 0.2, 0.3]:
            kernel = cv2.getGaborKernel(
                (21, 21), sigma=4.0, theta=theta,
                lambd=1.0/freq, gamma=0.5, psi=0, ktype=cv2.CV_32F
            )
            filtered = cv2.filter2D(face.astype(np.float32), cv2.CV_32F, kernel)
            responses.append(filtered.mean())
            responses.append(filtered.std())
    arr = np.array(responses, dtype=np.float32)
    norm = np.linalg.norm(arr)
    return arr / norm if norm > 0 else arr


def _extract_encoding(gray: np.ndarray, face_rect) -> np.ndarray:
    """
    Kết hợp 3 descriptor:
    - LBP  (60%): texture cục bộ — ổn định với ánh sáng
    - HOG  (30%): hình dạng/gradient — ổn định với biểu cảm
    - Gabor(10%): texture tần số — phân biệt cá nhân tốt hơn
    """
    x, y, w, h = face_rect
    face = _align_face(gray, x, y, w, h)

    lbp  = _lbp_vectorized(face)
    hog  = _hog_descriptor(face)
    gabor = _gabor_descriptor(face)

    # Normalize từng phần
    for arr in [lbp, hog]:
        n = np.linalg.norm(arr)
        if n > 0:
            arr /= n

    combined = np.concatenate([lbp * 0.60, hog * 0.30, gabor * 0.10])
    # L2 normalize toàn bộ
    norm = np.linalg.norm(combined)
    return combined / norm if norm > 0 else combined


# ── Tìm mặt tốt nhất trong ảnh ───────────────────────────────────────────────

def _get_best_face(bgr: np.ndarray):
    """
    Thử nhiều cách để tìm mặt tốt nhất.
    Trả về (gray, face_rect) hoặc (None, None).
    """
    h, w = bgr.shape[:2]
    attempts = [bgr]
    attempts.append(cv2.flip(bgr, 1))                                      # mirror
    attempts.append(cv2.convertScaleAbs(bgr, alpha=1.4, beta=20))          # sáng hơn
    attempts.append(cv2.convertScaleAbs(bgr, alpha=0.75, beta=0))          # tối hơn (overexposed)
    if w > 800:                                                             # resize nếu quá lớn
        scale = 640 / w
        attempts.append(cv2.resize(bgr, (640, int(h * scale))))

    for i, img in enumerate(attempts):
        gray = _preprocess(img)
        faces = _detect_faces(gray)
        if len(faces) > 0:
            # Chọn mặt lớn nhất (gần camera nhất)
            largest = max(faces, key=lambda f: f[2] * f[3])
            # Scale lại toạ độ nếu ảnh đã resize
            if img.shape[1] != bgr.shape[1]:
                sx = bgr.shape[1] / img.shape[1]
                sy = bgr.shape[0] / img.shape[0]
                x, yy, fw, fh = largest
                largest = (int(x*sx), int(yy*sy), int(fw*sx), int(fh*sy))
                gray = _preprocess(bgr)
            # Nếu dùng ảnh lật, không cần scale lại nhưng tọa độ x bị đảo
            # → dùng ảnh gốc để extract encoding
            if i == 1:  # flipped
                gray = _preprocess(bgr)
                faces2 = _detect_faces(gray)
                if len(faces2) > 0:
                    largest = max(faces2, key=lambda f: f[2] * f[3])
                else:
                    largest = largest  # fallback dùng tọa độ lật
            return gray, largest

    return None, None


# ── Augmentation khi đăng ký ─────────────────────────────────────────────────

def _augment_face(face: np.ndarray) -> list:
    """
    Tạo thêm biến thể ảnh khi đăng ký để tăng độ bền nhận diện.
    Trả về list các face đã augment (không bao gồm bản gốc).
    """
    augmented = []
    # Xoay nhẹ ±5 độ
    cx, cy = FACE_SIZE // 2, FACE_SIZE // 2
    for angle in [-5, 5]:
        M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
        rotated = cv2.warpAffine(face, M, (FACE_SIZE, FACE_SIZE),
                                 borderMode=cv2.BORDER_REPLICATE)
        augmented.append(rotated)
    # Thay đổi độ sáng nhẹ
    for alpha in [0.85, 1.15]:
        bright = cv2.convertScaleAbs(face, alpha=alpha, beta=0)
        augmented.append(bright)
    return augmented


# ── Public API ────────────────────────────────────────────────────────────────

def get_face_encoding(image_base64: str) -> Optional[list]:
    """Trích xuất encoding từ 1 ảnh. Trả về list float hoặc None."""
    bgr = _base64_to_bgr(image_base64)
    gray, face = _get_best_face(bgr)
    if face is None:
        return None
    return _extract_encoding(gray, face).tolist()


def get_face_encodings_multi(images_base64: list) -> Optional[list]:
    """
    Trích xuất encoding từ nhiều ảnh + augmentation.
    Mỗi ảnh gốc sinh thêm 4 biến thể → tổng encoding tối đa = N*5.
    """
    encodings = []
    for idx, img_b64 in enumerate(images_base64):
        try:
            bgr = _base64_to_bgr(img_b64)
            print(f"[DEBUG] Ảnh {idx+1}: shape={bgr.shape}, dtype={bgr.dtype}")
        except Exception as e:
            print(f"[DEBUG] Ảnh {idx+1}: decode lỗi — {e}")
            continue
        gray, face = _get_best_face(bgr)
        print(f"[DEBUG] Ảnh {idx+1}: face={'tìm thấy' if face is not None else 'KHÔNG tìm thấy'}")
        if face is None:
            continue
        # Encoding gốc
        enc = _extract_encoding(gray, face)
        encodings.append(enc.tolist())
        # Augmentation
        x, y, w, h = face
        face_img = _align_face(gray, x, y, w, h)
        for aug_face in _augment_face(face_img):
            # Tính encoding trực tiếp từ ảnh đã aligned (không cần detect lại)
            lbp   = _lbp_vectorized(aug_face)
            hog   = _hog_descriptor(aug_face)
            gabor = _gabor_descriptor(aug_face)
            for arr in [lbp, hog]:
                n = np.linalg.norm(arr)
                if n > 0: arr /= n
            combined = np.concatenate([lbp * 0.60, hog * 0.30, gabor * 0.10])
            n = np.linalg.norm(combined)
            if n > 0: combined /= n
            encodings.append(combined.tolist())

    return encodings if encodings else None


def compare_faces(
    known_encoding_json: str,
    unknown_image_base64: str,
    threshold: float = 0.75,
) -> Tuple[bool, float]:
    """
    So sánh encoding đã lưu với ảnh mới.
    Dùng Top-K voting: lấy K similarity cao nhất, tính trung bình có trọng số.
    """
    unknown_enc = get_face_encoding(unknown_image_base64)
    if unknown_enc is None:
        return False, 0.0

    unknown_vec = np.array(unknown_enc, dtype=np.float32)
    stored = json.loads(known_encoding_json)

    if isinstance(stored[0], list):
        known_vecs = [np.array(e, dtype=np.float32) for e in stored]
    else:
        known_vecs = [np.array(stored, dtype=np.float32)]

    # Tính cosine similarity
    sims = []
    for kv in known_vecs:
        na, nb = np.linalg.norm(kv), np.linalg.norm(unknown_vec)
        if na > 0 and nb > 0:
            sims.append(float(np.dot(kv, unknown_vec) / (na * nb)))

    if not sims:
        return False, 0.0

    sims_arr = np.array(sims)

    # Top-K voting (K = min(5, tổng encoding))
    K = min(5, len(sims_arr))
    top_k = np.sort(sims_arr)[::-1][:K]

    # Trọng số theo rank: top1 có trọng số cao nhất
    weights = np.array([1.0 / (i + 1) for i in range(K)])
    score = float(np.average(top_k, weights=weights))

    # Điểm tổng hợp: 65% top1 + 35% weighted avg top-K
    top1 = float(sims_arr.max())
    final_score = top1 * 0.65 + score * 0.35

    is_match = top1 >= threshold and final_score >= threshold * 0.93

    return is_match, round(final_score, 4)


def unified_face_match(
    employees: list,
    unknown_image_base64: str,
    threshold: float = 0.75,
) -> dict:
    """
    Hàm nhận diện khuôn mặt dùng CHUNG cho cả public_route và attendance_route.
    Thuật toán: 70% top1 + 30% weighted-avg, yêu cầu margin >= 3% so với người thứ 2.

    Args:
        employees: list SQLAlchemy Employee objects (phải có face_encoding và id)
        unknown_image_base64: ảnh base64 từ webcam
        threshold: ngưỡng nhận diện

    Returns dict với các key:
        matched (bool), employee (obj|None), confidence (float),
        error_code (str|None), error_msg (str|None)
    """
    unknown_enc = get_face_encoding(unknown_image_base64)
    if unknown_enc is None:
        return {
            "matched": False, "employee": None, "confidence": 0.0,
            "error_code": "NO_FACE",
            "error_msg": "Không phát hiện khuôn mặt. Nhìn thẳng vào camera và đảm bảo đủ ánh sáng.",
        }

    unknown_vec = np.array(unknown_enc, dtype=np.float32)

    def _best_sim(stored_json: str) -> float:
        stored = json.loads(stored_json)
        known_vecs = [np.array(e, dtype=np.float32) for e in stored] \
            if isinstance(stored[0], list) else [np.array(stored, dtype=np.float32)]
        sims = []
        for kv in known_vecs:
            # Bỏ qua encoding không cùng kích thước (dữ liệu cũ không tương thích)
            if kv.shape != unknown_vec.shape:
                continue
            na, nb = np.linalg.norm(kv), np.linalg.norm(unknown_vec)
            if na > 0 and nb > 0:
                sims.append(float(np.dot(kv, unknown_vec) / (na * nb)))
        if not sims:
            return 0.0
        sims_arr = np.array(sims)
        K = min(5, len(sims_arr))
        top_k = np.sort(sims_arr)[::-1][:K]
        weights = np.array([1.0 / (i + 1) for i in range(K)])
        wavg = float(np.average(top_k, weights=weights))
        top1 = float(sims_arr.max())
        return round(top1 * 0.70 + wavg * 0.30, 4)

    scores = sorted(
        [(emp, _best_sim(emp.face_encoding)) for emp in employees],
        key=lambda x: x[1], reverse=True,
    )

    best_emp, best_sim = scores[0]
    second_sim = scores[1][1] if len(scores) > 1 else 0.0
    margin = best_sim - second_sim
    is_match = best_sim >= threshold and (len(scores) == 1 or margin >= 0.03)

    if not is_match:
        if best_sim >= threshold and margin < 0.03:
            code, msg = "AMBIGUOUS", f"Khuôn mặt không rõ ràng ({best_sim*100:.0f}%). Nhìn thẳng và chụp lại."
        elif best_sim >= threshold * 0.82:
            code, msg = "LOW_CONFIDENCE", f"Gần khớp ({best_sim*100:.0f}%) nhưng chưa đủ tin cậy. Cải thiện ánh sáng."
        elif best_sim >= threshold * 0.65:
            code, msg = "POOR_LIGHT", "Không nhận diện được. Kiểm tra ánh sáng và nhìn thẳng vào camera."
        else:
            code, msg = "NOT_REGISTERED", "Khuôn mặt chưa đăng ký hoặc quá khác biệt. Liên hệ quản trị viên."
        return {"matched": False, "employee": None, "confidence": round(best_sim, 4),
                "error_code": code, "error_msg": msg}

    return {"matched": True, "employee": best_emp, "confidence": round(best_sim, 4),
            "error_code": None, "error_msg": None}


def detect_faces_in_image(image_base64: str) -> int:
    bgr = _base64_to_bgr(image_base64)
    gray = _preprocess(bgr)
    faces = _detect_faces(gray)
    return len(faces)
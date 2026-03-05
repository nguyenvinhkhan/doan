"""
Face detection & recognition module.
Sử dụng OpenCV (không cần dlib/CMake):
  - Phát hiện mặt: Haar Cascade với nhiều mức scaleFactor
  - Nhận diện mặt: LBP histogram + cosine similarity
"""
import base64
import json
import numpy as np
from io import BytesIO
from PIL import Image
from typing import Optional, Tuple
import cv2

# Tải các cascade model
_CASCADE_FRONTAL = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
_CASCADE_ALT     = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
_CASCADE_PROFILE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")


def _base64_to_bgr(image_base64: str) -> np.ndarray:
    """Chuyển base64 → numpy array BGR."""
    if "," in image_base64:
        image_base64 = image_base64.split(",")[1]
    img_bytes = base64.b64decode(image_base64)
    image = Image.open(BytesIO(img_bytes)).convert("RGB")
    arr = np.array(image)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _detect_faces(gray: np.ndarray):
    """
    Thử nhiều cascade và nhiều thông số để tăng khả năng phát hiện mặt.
    Trả về list (x, y, w, h) hoặc list rỗng.
    """
    # Thử cascade 1 - mặc định, nhiều mức độ
    for scale in [1.05, 1.1, 1.15, 1.2]:
        for neighbors in [3, 4, 5]:
            faces = _CASCADE_FRONTAL.detectMultiScale(
                gray, scaleFactor=scale, minNeighbors=neighbors,
                minSize=(40, 40), flags=cv2.CASCADE_SCALE_IMAGE
            )
            if len(faces) > 0:
                return faces

    # Thử cascade alt2
    faces = _CASCADE_ALT.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=3, minSize=(40, 40)
    )
    if len(faces) > 0:
        return faces

    # Thử cascade profile (mặt nghiêng)
    faces = _CASCADE_PROFILE.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=3, minSize=(40, 40)
    )
    if len(faces) > 0:
        return faces

    return []


def _preprocess_gray(bgr: np.ndarray) -> np.ndarray:
    """Tiền xử lý ảnh để tăng độ tương phản."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # CLAHE tốt hơn equalizeHist
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    # Giảm nhiễu nhẹ
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    return gray


def _extract_lbph_histogram(gray: np.ndarray, face_rect) -> np.ndarray:
    """
    Cắt vùng mặt → resize 100x100 → tính LBP histogram.
    Vector đặc trưng kích thước 5x5x256 = 6400 chiều.
    """
    x, y, w, h = face_rect
    # Mở rộng vùng mặt thêm 10% để bắt đủ đặc trưng
    pad_x = int(w * 0.1)
    pad_y = int(h * 0.1)
    x1 = max(0, x - pad_x)
    y1 = max(0, y - pad_y)
    x2 = min(gray.shape[1], x + w + pad_x)
    y2 = min(gray.shape[0], y + h + pad_y)

    face_roi = gray[y1:y2, x1:x2]
    face_roi = cv2.resize(face_roi, (100, 100))

    # Tính LBP
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

    # Chia grid 5x5, histogram mỗi ô
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


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Tính độ tương đồng cosine (0.0 → 1.0)."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


# ── Public API ────────────────────────────────────────────────────────────────

def get_face_encoding(image_base64: str) -> Optional[list]:
    """
    Phát hiện khuôn mặt và trích xuất vector đặc trưng.
    Trả về list float hoặc None nếu không tìm thấy mặt.
    """
    bgr  = _base64_to_bgr(image_base64)

    # Thử ảnh gốc trước
    gray  = _preprocess_gray(bgr)
    faces = _detect_faces(gray)

    # Nếu không tìm thấy, thử ảnh lật ngang (selfie camera thường bị lật)
    if len(faces) == 0:
        flipped = cv2.flip(bgr, 1)
        gray    = _preprocess_gray(flipped)
        faces   = _detect_faces(gray)

    # Nếu vẫn không thấy, thử resize nhỏ hơn
    if len(faces) == 0:
        small = cv2.resize(bgr, (320, 240))
        gray  = _preprocess_gray(small)
        faces = _detect_faces(gray)
        if len(faces) > 0:
            # Scale tọa độ về ảnh gốc
            scale_x = bgr.shape[1] / 320
            scale_y = bgr.shape[0] / 240
            faces = [(int(x*scale_x), int(y*scale_y), int(w*scale_x), int(h*scale_y)) for x, y, w, h in faces]
            gray  = _preprocess_gray(bgr)

    if len(faces) == 0:
        return None

    largest   = max(faces, key=lambda f: f[2] * f[3])
    histogram = _extract_lbph_histogram(gray, largest)
    return histogram.tolist()


def compare_faces(
    known_encoding_json: str,
    unknown_image_base64: str,
    threshold: float = 0.72,
) -> Tuple[bool, float]:
    """
    So sánh encoding đã lưu (JSON string) với ảnh mới.
    Trả về (is_match: bool, confidence: float 0-1).
    """
    known_vec = np.array(json.loads(known_encoding_json), dtype=np.float32)

    unknown_encoding = get_face_encoding(unknown_image_base64)
    if unknown_encoding is None:
        return False, 0.0

    unknown_vec = np.array(unknown_encoding, dtype=np.float32)
    similarity  = _cosine_similarity(known_vec, unknown_vec)
    is_match    = similarity >= threshold

    return is_match, round(similarity, 4)


def detect_faces_in_image(image_base64: str) -> int:
    """Đếm số khuôn mặt trong ảnh."""
    bgr   = _base64_to_bgr(image_base64)
    gray  = _preprocess_gray(bgr)
    faces = _detect_faces(gray)
    return len(faces)
import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function RegisterFacePage() {
  const navigate  = useNavigate();
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [employee, setEmployee] = useState(null);
  const [stream,   setStream]   = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [photos,   setPhotos]   = useState([]); // ảnh đã chụp (tối đa 5)
  const [status,   setStatus]   = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [done,     setDone]     = useState(false);

  const token = localStorage.getItem("employee_token");
  const authHeader = { Authorization: `Bearer ${token}` };

  // Kiểm tra đăng nhập
  useEffect(() => {
    if (!token) { navigate("/employee-login"); return; }
    axios.get(`${API}/api/employees/me/profile`, { headers: authHeader })
      .then(r => setEmployee(r.data))
      .catch(() => { localStorage.removeItem("employee_token"); navigate("/employee-login"); });
  }, []);

  // Bật camera
  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 }
      });
      streamRef.current = s;
      videoRef.current.srcObject = s;
      setStream(true);
      setStatus({ type: "info", msg: "Camera đã bật. Hãy nhìn thẳng vào camera và nhấn Chụp." });
    } catch {
      setStatus({ type: "error", msg: "Không thể mở camera. Vui lòng cấp quyền camera cho trình duyệt." });
    }
  };

  // Tắt camera
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStream(false);
  };

  // Chụp ảnh
  const capture = useCallback(() => {
    if (!videoRef.current || capturing) return;
    if (photos.length >= 5) {
      setStatus({ type: "warn", msg: "Đã đủ 5 ảnh. Nhấn Lưu khuôn mặt để hoàn tất." });
      return;
    }
    setCapturing(true);
    const canvas = canvasRef.current;
    canvas.width  = videoRef.current.videoWidth  || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setPhotos(prev => [...prev, dataUrl]);
    setStatus({ type: "success", msg: `✅ Đã chụp ảnh ${photos.length + 1}/5. ${photos.length < 4 ? "Hãy thay đổi góc mặt nhẹ rồi chụp tiếp." : "Đã đủ! Nhấn Lưu khuôn mặt."}` });
    setTimeout(() => setCapturing(false), 500);
  }, [photos, capturing]);

  // Xóa ảnh
  const removePhoto = (idx) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
    setStatus({ type: "info", msg: "Đã xóa ảnh. Chụp lại nếu cần." });
  };

  // Lưu khuôn mặt
  const saveFace = async () => {
    if (photos.length === 0) {
      setStatus({ type: "error", msg: "Chưa có ảnh nào. Vui lòng chụp ít nhất 1 ảnh." });
      return;
    }
    setSaving(true);
    setStatus({ type: "info", msg: "⏳ Đang xử lý và lưu khuôn mặt..." });
    try {
      // Dùng ảnh đầu tiên làm encoding chính (có thể nâng cấp dùng trung bình)
      const image_base64 = photos[0];
      await axios.post(
        `${API}/api/employees/${employee.id}/register-face`,
        { image_base64 },
        { headers: authHeader }
      );
      setDone(true);
      stopCamera();
      setStatus({ type: "success", msg: "🎉 Đăng ký khuôn mặt thành công! Bạn có thể chấm công bằng khuôn mặt từ bây giờ." });
    } catch (err) {
      setStatus({ type: "error", msg: "❌ " + (err.response?.data?.detail || "Lưu thất bại. Thử chụp lại ảnh rõ hơn.") });
    } finally {
      setSaving(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("employee_token");
    localStorage.removeItem("employee_user");
    stopCamera();
    navigate("/employee-login");
  };

  return (
    <div style={S.page}>
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <span style={{ fontSize: "24px" }}>👤</span>
          <div>
            <div style={S.headerTitle}>Đăng ký khuôn mặt</div>
            {employee && (
              <div style={S.headerSub}>
                {employee.full_name} &nbsp;•&nbsp; {employee.employee_code}
                {employee.department && <> &nbsp;•&nbsp; {employee.department}</>}
              </div>
            )}
          </div>
        </div>
        <button onClick={logout} style={S.btnLogout}>Đăng xuất</button>
      </div>

      <div style={S.body}>
        {/* Đã đăng ký thành công */}
        {done && (
          <div style={S.successBox}>
            <div style={{ fontSize: "64px", marginBottom: "16px" }}>🎉</div>
            <div style={{ color: "#00ff88", fontSize: "22px", fontWeight: 700, marginBottom: "8px" }}>
              Đăng ký thành công!
            </div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "15px", marginBottom: "24px" }}>
              Khuôn mặt của bạn đã được lưu. Bạn có thể chấm công bằng khuôn mặt từ bây giờ.
            </div>
            <button onClick={logout} style={S.btnPrimary}>Hoàn tất & Thoát</button>
          </div>
        )}

        {!done && (
          <>
            {/* Hướng dẫn */}
            <div style={S.guideBox}>
              <div style={S.guideTitle}>📋 Hướng dẫn đăng ký</div>
              <div style={S.guideGrid}>
                {[
                  ["1️⃣", "Bật camera"],
                  ["2️⃣", "Nhìn thẳng, chụp 1 ảnh"],
                  ["3️⃣", "Xoay nhẹ đầu, chụp thêm"],
                  ["4️⃣", "Nhấn Lưu khuôn mặt"],
                ].map(([icon, text]) => (
                  <div key={text} style={S.guideItem}>
                    <span style={{ fontSize: "20px" }}>{icon}</span>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "13px" }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Camera */}
            <div style={S.cameraSection}>
              <div style={S.videoWrap}>
                <video ref={videoRef} autoPlay muted playsInline
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: stream ? "block" : "none" }} />
                {!stream && (
                  <div style={S.camPlaceholder}>
                    <div style={{ fontSize: "48px", marginBottom: "12px" }}>📷</div>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "14px" }}>Camera chưa bật</div>
                  </div>
                )}
                {/* Overlay hướng dẫn */}
                {stream && (
                  <div style={S.faceGuide}>
                    <div style={S.faceCircle} />
                  </div>
                )}
              </div>

              {/* Nút điều khiển */}
              <div style={S.controls}>
                {!stream ? (
                  <button onClick={startCamera} style={S.btnPrimary}>📷 Bật camera</button>
                ) : (
                  <>
                    <button onClick={capture} disabled={capturing || photos.length >= 5}
                      style={{ ...S.btnPrimary, flex: 1 }}>
                      {capturing ? "⏳..." : `📸 Chụp (${photos.length}/5)`}
                    </button>
                    <button onClick={stopCamera} style={S.btnSecondary}>⏹ Tắt</button>
                  </>
                )}
              </div>
            </div>

            {/* Thông báo */}
            {status && (
              <div style={{
                ...S.statusBox,
                borderColor: status.type === "success" ? "rgba(0,255,136,0.3)"
                  : status.type === "error" ? "rgba(255,92,92,0.3)"
                  : status.type === "warn" ? "rgba(255,214,0,0.3)"
                  : "rgba(0,229,255,0.3)",
                background: status.type === "success" ? "rgba(0,255,136,0.06)"
                  : status.type === "error" ? "rgba(255,92,92,0.06)"
                  : status.type === "warn" ? "rgba(255,214,0,0.06)"
                  : "rgba(0,229,255,0.06)",
                color: status.type === "success" ? "#00ff88"
                  : status.type === "error" ? "#ff5c5c"
                  : status.type === "warn" ? "#ffd600"
                  : "#00e5ff",
              }}>
                {status.msg}
              </div>
            )}

            {/* Ảnh đã chụp */}
            {photos.length > 0 && (
              <div style={S.photosSection}>
                <div style={S.photosTitle}>Ảnh đã chụp ({photos.length}/5)</div>
                <div style={S.photosGrid}>
                  {photos.map((photo, i) => (
                    <div key={i} style={S.photoWrap}>
                      <img src={photo} alt={`Ảnh ${i + 1}`} style={S.photoImg} />
                      <button onClick={() => removePhoto(i)} style={S.photoRemove}>✕</button>
                      <div style={S.photoLabel}>Ảnh {i + 1}</div>
                    </div>
                  ))}
                </div>

                <button onClick={saveFace} disabled={saving || photos.length === 0}
                  style={{ ...S.btnSave, opacity: saving ? 0.6 : 1 }}>
                  {saving ? "⏳ Đang lưu..." : "💾 Lưu khuôn mặt"}
                </button>
              </div>
            )}

            {/* Trạng thái hiện tại */}
            {employee && (
              <div style={S.currentStatus}>
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>
                  Trạng thái khuôn mặt:
                </span>
                <span style={{
                  color: employee.has_face ? "#00ff88" : "#ffd600",
                  fontWeight: 600, fontSize: "13px"
                }}>
                  {employee.has_face ? "✅ Đã đăng ký" : "⚠️ Chưa đăng ký"}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

const S = {
  page: {
    minHeight: "100vh", background: "linear-gradient(135deg,#0a0e1a,#0d1628)",
    fontFamily: "'Space Grotesk', sans-serif", color: "#fff",
    display: "flex", flexDirection: "column",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.07)",
    background: "rgba(255,255,255,0.02)",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: "12px" },
  headerTitle: { color: "#fff", fontWeight: 700, fontSize: "16px" },
  headerSub: { color: "rgba(255,255,255,0.4)", fontSize: "12px", marginTop: "2px" },
  btnLogout: {
    background: "rgba(255,92,92,0.1)", border: "1px solid rgba(255,92,92,0.3)",
    color: "#ff5c5c", borderRadius: "8px", padding: "7px 14px", cursor: "pointer",
    fontSize: "13px", fontFamily: "inherit",
  },
  body: {
    flex: 1, padding: "24px", maxWidth: "600px", width: "100%",
    margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px",
  },
  guideBox: {
    background: "rgba(0,229,255,0.04)", border: "1px solid rgba(0,229,255,0.15)",
    borderRadius: "14px", padding: "16px 20px",
  },
  guideTitle: { color: "#00e5ff", fontWeight: 700, fontSize: "14px", marginBottom: "12px" },
  guideGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" },
  guideItem: {
    display: "flex", alignItems: "center", gap: "8px",
    background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "8px 12px",
  },
  cameraSection: { display: "flex", flexDirection: "column", gap: "12px" },
  videoWrap: {
    position: "relative", width: "100%", aspectRatio: "4/3", background: "#000",
    borderRadius: "14px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)",
    maxHeight: "360px",
  },
  camPlaceholder: {
    position: "absolute", inset: 0, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
  },
  faceGuide: {
    position: "absolute", inset: 0, display: "flex",
    alignItems: "center", justifyContent: "center", pointerEvents: "none",
  },
  faceCircle: {
    width: "180px", height: "220px", border: "2px dashed rgba(0,229,255,0.5)",
    borderRadius: "50%", boxShadow: "0 0 20px rgba(0,229,255,0.15)",
  },
  controls: { display: "flex", gap: "10px" },
  btnPrimary: {
    background: "linear-gradient(135deg,#00e5ff,#0066ff)", color: "#fff",
    border: "none", borderRadius: "10px", padding: "12px 20px",
    fontWeight: 700, fontSize: "14px", cursor: "pointer", fontFamily: "inherit",
  },
  btnSecondary: {
    background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "12px 16px",
    cursor: "pointer", fontFamily: "inherit", fontSize: "14px",
  },
  statusBox: {
    border: "1px solid", borderRadius: "10px", padding: "12px 16px",
    fontSize: "14px", fontWeight: 600,
  },
  photosSection: {
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "14px", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px",
  },
  photosTitle: { color: "#fff", fontWeight: 700, fontSize: "14px" },
  photosGrid: { display: "flex", gap: "10px", flexWrap: "wrap" },
  photoWrap: {
    position: "relative", width: "100px", height: "100px",
    borderRadius: "10px", overflow: "hidden", border: "2px solid rgba(0,229,255,0.3)",
  },
  photoImg: { width: "100%", height: "100%", objectFit: "cover" },
  photoRemove: {
    position: "absolute", top: "4px", right: "4px",
    background: "rgba(255,92,92,0.8)", color: "#fff", border: "none",
    borderRadius: "50%", width: "20px", height: "20px", cursor: "pointer",
    fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center",
  },
  photoLabel: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: "11px",
    textAlign: "center", padding: "2px",
  },
  btnSave: {
    background: "linear-gradient(135deg,#00ff88,#00cc66)", color: "#0a0e1a",
    border: "none", borderRadius: "10px", padding: "13px",
    fontWeight: 700, fontSize: "15px", cursor: "pointer", fontFamily: "inherit",
  },
  successBox: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    minHeight: "400px", textAlign: "center",
  },
  currentStatus: {
    display: "flex", alignItems: "center", gap: "8px", justifyContent: "center",
  },
};
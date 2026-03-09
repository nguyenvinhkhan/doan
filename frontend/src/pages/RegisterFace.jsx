import { useState, useRef, useEffect, useCallback } from "react";
import api from "../api/axios";

export default function RegisterFace() {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [employees, setEmployees] = useState([]);
  const [selected,  setSelected]  = useState("");
  const [stream,    setStream]    = useState(false);
  const [photos,    setPhotos]    = useState([]);
  const [status,    setStatus]    = useState(null);
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    api.get("/employees/?is_active=true&limit=200").then(r => setEmployees(r.data));
  }, []);

  // Tự tắt camera khi đủ 5 ảnh
  useEffect(() => {
    if (photos.length >= 5) {
      stopCamera();
      setStatus({ type: "success", msg: "✅ Đã chụp đủ 5 ảnh! Nhấn Lưu Khuôn Mặt để hoàn tất." });
    }
  }, [photos.length]);

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus({ type: "error", msg: "❌ Trình duyệt không hỗ trợ camera. Hãy dùng HTTPS hoặc Chrome/Safari mới nhất." });
      return;
    }
    try {
      let s;
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        try {
          s = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: false,
          });
        } catch {
          s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      }
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
      setStream(true);
      setStatus({ type: "info", msg: "Camera đã bật. Nhìn thẳng vào camera và nhấn Chụp." });
    } catch (err) {
      const msg =
        err.name === "NotAllowedError"
          ? "❌ Chưa cấp quyền camera. Vào Cài đặt > Trình duyệt > Camera để cho phép."
          : err.name === "NotFoundError"
          ? "❌ Không tìm thấy camera trên thiết bị này."
          : err.name === "NotReadableError"
          ? "❌ Camera đang được ứng dụng khác sử dụng. Hãy đóng lại và thử lại."
          : `❌ Không thể mở camera: ${err.message}`;
      setStatus({ type: "error", msg });
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStream(false);
  };

  const capture = useCallback(() => {
    if (!videoRef.current || !stream) return;
    if (photos.length >= 5) return;
    const canvas = canvasRef.current;
    canvas.width  = videoRef.current.videoWidth  || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setPhotos(prev => {
      const next = [...prev, dataUrl];
      if (next.length < 5) {
        setStatus({ type: "success", msg: `✅ Đã chụp ${next.length}/5 ảnh. Thay đổi góc mặt nhẹ rồi chụp tiếp.` });
      }
      return next;
    });
  }, [stream, photos.length]);

  const removePhoto = (idx) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!selected) { setStatus({ type: "error", msg: "⚠️ Vui lòng chọn nhân viên trước" }); return; }
    if (photos.length === 0) { setStatus({ type: "error", msg: "⚠️ Vui lòng chụp ít nhất 1 ảnh" }); return; }
    setSaving(true);
    setStatus({ type: "info", msg: "⏳ Đang xử lý và lưu khuôn mặt..." });
    try {
      const res = await api.post(`/employees/${selected}/register-face`, { images_base64: photos });
      setStatus({ type: "success", msg: `✅ Đăng ký thành công! Đã lưu ${res.data.encodings_count} encoding.` });
      setPhotos([]);
      setSelected("");
      const r = await api.get("/employees/?is_active=true&limit=200");
      setEmployees(r.data);
    } catch (err) {
      const msg = err.response?.data?.detail || "Đăng ký thất bại";
      setStatus({
        type: "error",
        msg: `❌ ${msg}`,
        tips: msg.includes("khuôn mặt") || msg.includes("face"),
      });
    } finally {
      setSaving(false);
    }
  };

  const selectedEmp = employees.find(e => String(e.id) === String(selected));
  const registered  = employees.filter(e => e.has_face).length;

  const C = {
    success: { border: "rgba(0,255,136,0.3)", bg: "rgba(0,255,136,0.08)", text: "#00ff88" },
    error:   { border: "rgba(255,92,92,0.3)",  bg: "rgba(255,92,92,0.08)",  text: "#ff5c5c" },
    warn:    { border: "rgba(255,214,0,0.3)",  bg: "rgba(255,214,0,0.08)",  text: "#ffd600" },
    info:    { border: "rgba(0,229,255,0.3)",  bg: "rgba(0,229,255,0.08)",  text: "#00e5ff" },
  };

  return (
    <div style={S.page}>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <h2 style={S.heading}>Đăng Ký Khuôn Mặt</h2>
      <p style={S.sub}>Chụp nhiều góc để tăng độ chính xác nhận diện</p>

      <div style={{ background: "rgba(0,229,255,0.07)", border: "1px solid rgba(0,229,255,0.25)", borderRadius: "12px", padding: "12px 18px", marginBottom: "20px", color: "#00e5ff", fontSize: "13px", display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "20px" }}>🔄</span>
        <span><strong>Thuật toán mới:</strong> Nhân viên đã đăng ký trước đây nên <strong>đăng ký lại</strong> để đạt độ chính xác tốt nhất (LBP vectorized + Gabor + augmentation).</span>
      </div>
      <div style={S.layout} className="rf-layout">
        {/* Cột trái */}
        <div style={S.leftCol}>

          {/* Bước 1 */}
          <div style={S.card}>
            <div style={S.stepHeader}><span style={S.stepNum}>1</span><span style={S.stepTitle}>Chọn nhân viên</span></div>
            <select style={S.select} value={selected}
              onChange={e => { setSelected(e.target.value); setPhotos([]); setStatus(null); }}>
              <option value="">-- Chọn nhân viên --</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  [{e.employee_code}] {e.full_name}{e.has_face ? " ✓" : ""}
                </option>
              ))}
            </select>
            {selectedEmp && (
              <div style={S.empCard}>
                <div style={S.empAvatar}>{selectedEmp.full_name[0]}</div>
                <div>
                  <div style={{ color: "#fff", fontWeight: 700 }}>{selectedEmp.full_name}</div>
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>
                    {selectedEmp.employee_code} • {selectedEmp.department || "Chưa có phòng ban"}
                  </div>
                  <div style={{ color: selectedEmp.has_face ? "#00ff88" : "#ffd600", fontSize: "12px", marginTop: "4px" }}>
                    {selectedEmp.has_face ? "✓ Đã đăng ký — có thể đăng ký lại" : "⚠ Chưa đăng ký khuôn mặt"}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bước 2 */}
          <div style={S.card}>
            <div style={S.stepHeader}><span style={S.stepNum}>2</span><span style={S.stepTitle}>Chụp ảnh ({photos.length}/5)</span></div>
            <div style={S.videoWrap}>
              <video ref={videoRef} autoPlay muted playsInline webkit-playsinline="true"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: stream ? "block" : "none" }} />
              {!stream && (
                <div style={S.camPlaceholder}>
                  <div style={{ fontSize: "48px" }}>📷</div>
                  <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "14px", marginTop: "8px" }}>Camera chưa bật</div>
                </div>
              )}
              {stream && <div style={S.faceGuide}><div style={S.faceCircle} /></div>}
            </div>
            <div style={S.controls}>
              {!stream ? (
                <button onClick={startCamera} style={S.btnStart}>▶ Bật Camera</button>
              ) : (
                <>
                  <button onClick={capture} disabled={photos.length >= 5}
                    style={{ ...S.btnCapture, flex: 1, opacity: photos.length >= 5 ? 0.4 : 1 }}>
                    📸 Chụp ({photos.length}/5)
                  </button>
                  <button onClick={stopCamera} style={S.btnSecondary}>⏹ Tắt</button>
                </>
              )}
              {photos.length > 0 && !stream && (
                <button onClick={startCamera} style={S.btnSecondary}>↩ Chụp thêm</button>
              )}
            </div>
          </div>

          {/* Ảnh đã chụp */}
          {photos.length > 0 && (
            <div style={S.card}>
              <div style={S.stepHeader}><span style={S.stepNum}>3</span><span style={S.stepTitle}>Ảnh đã chụp ({photos.length}/5)</span></div>
              <div style={S.photosGrid}>
                {photos.map((photo, i) => (
                  <div key={i} style={S.photoWrap}>
                    <img src={photo} alt={`Ảnh ${i+1}`} style={S.photoImg} />
                    <button onClick={() => removePhoto(i)} style={S.photoRemove}>✕</button>
                    <div style={S.photoLabel}>Ảnh {i+1}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Thông báo */}
          {status && (
            <div style={{ border: `1px solid ${C[status.type].border}`, background: C[status.type].bg, color: C[status.type].text, borderRadius: "10px", padding: "12px 16px", fontSize: "14px", fontWeight: 600 }}>
              {status.msg}
              {status.tips && (
                <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontWeight: 400, fontSize: "13px" }}>
                  <li>Ánh sáng đủ sáng, không ngược sáng</li>
                  <li>Nhìn thẳng vào camera</li>
                  <li>Khuôn mặt chiếm ít nhất 1/3 khung hình</li>
                  <li>Không đeo khẩu trang, kính râm</li>
                </ul>
              )}
            </div>
          )}

          {/* Nút lưu */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !selected || photos.length === 0}
            style={{ ...S.btnSave, opacity: (saving || !selected || photos.length === 0) ? 0.4 : 1, cursor: (saving || !selected || photos.length === 0) ? "not-allowed" : "pointer" }}
          >
            {saving ? "⏳ Đang xử lý..." : "🪪 Lưu Khuôn Mặt"}
          </button>

        </div>

        {/* Cột phải */}
        <div style={S.rightCol} className="rf-rightcol">
          <div style={S.statsBox}>
            <div style={S.statItem}>
              <div style={{ color: "#00e5ff", fontWeight: 700, fontSize: "28px" }}>{employees.length}</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>Tổng NV</div>
            </div>
            <div style={S.statDivider} />
            <div style={S.statItem}>
              <div style={{ color: "#00ff88", fontWeight: 700, fontSize: "28px" }}>{registered}</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>Đã đăng ký</div>
            </div>
            <div style={S.statDivider} />
            <div style={S.statItem}>
              <div style={{ color: "#ffd600", fontWeight: 700, fontSize: "28px" }}>{employees.length - registered}</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>Chưa đăng ký</div>
            </div>
          </div>

          {employees.filter(e => !e.has_face).length > 0 && (
            <div style={S.unregBox}>
              <div style={S.unregTitle}>⚠ Chưa đăng ký khuôn mặt</div>
              <div style={S.unregList}>
                {employees.filter(e => !e.has_face).map(e => (
                  <div key={e.id} style={S.unregItem}
                    onClick={() => { setSelected(String(e.id)); setPhotos([]); setStatus(null); }}>
                    <div style={S.unregAvatar}>{e.full_name[0]}</div>
                    <div>
                      <div style={{ color: "#fff", fontSize: "13px", fontWeight: 600 }}>{e.full_name}</div>
                      <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "11px" }}>{e.employee_code}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={S.guideBox}>
            <div style={S.guideTitle}>📋 Hướng dẫn chụp ảnh</div>
            {[
              ["💡", "Ánh sáng tốt", "Chiếu sáng đều, tránh ngược sáng"],
              ["👤", "Một mình",     "Chỉ có một khuôn mặt trong khung"],
              ["🎯", "Nhiều góc",    "Chụp thẳng, trái, phải, ngửa nhẹ"],
              ["📐", "Khoảng cách",  "Cách camera 40–60cm"],
              ["😊", "Biểu cảm",     "Tự nhiên, không nhăn mặt"],
            ].map(([icon, title, desc]) => (
              <div key={title} style={S.guideItem}>
                <span style={{ fontSize: "18px" }}>{icon}</span>
                <div>
                  <div style={{ color: "#fff", fontSize: "13px", fontWeight: 600 }}>{title}</div>
                  <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "12px" }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
        * { -webkit-tap-highlight-color: transparent; }
        input, select, button { font-size: 16px !important; }
        @media (max-width: 767px) {
          .rf-layout { grid-template-columns: 1fr !important; }
          .rf-rightcol { display: none !important; }
        }
        select:focus { outline:none; border-color:#00e5ff !important; }
      `}</style>
    </div>
  );
}

const S = {
  page:    { padding: "16px", flex: 1, overflowY: "auto", fontFamily: "'Space Grotesk', sans-serif" },
  heading: { color: "#fff", fontSize: "26px", fontWeight: 700, margin: "0 0 4px" },
  sub:     { color: "rgba(255,255,255,0.35)", fontSize: "14px", marginBottom: "28px" },
  layout:  { display: "grid", gridTemplateColumns: "1fr 300px", gap: "24px", alignItems: "start" }, // responsive qua CSS bên dưới
  leftCol: { display: "flex", flexDirection: "column", gap: "20px" },
  card:    { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" },
  stepHeader: { display: "flex", alignItems: "center", gap: "10px" },
  stepNum:  { width: "26px", height: "26px", borderRadius: "50%", background: "#00e5ff", color: "#0a0e1a", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px", flexShrink: 0 },
  stepTitle:{ color: "#00e5ff", fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.5px" },
  select:   { width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "11px 14px", color: "#fff", fontSize: "14px", fontFamily: "inherit" },
  empCard:  { display: "flex", gap: "12px", alignItems: "center", background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.15)", borderRadius: "10px", padding: "12px" },
  empAvatar:{ width: "40px", height: "40px", borderRadius: "50%", background: "#00e5ff", color: "#0a0e1a", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "16px", flexShrink: 0 },
  videoWrap:{ position: "relative", width: "100%", aspectRatio: "4/3", background: "#000", borderRadius: "12px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "320px" },
  camPlaceholder: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
  faceGuide:{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" },
  faceCircle:{ width: "160px", height: "200px", border: "2px dashed rgba(0,229,255,0.5)", borderRadius: "50%", boxShadow: "0 0 20px rgba(0,229,255,0.15)" },
  controls: { display: "flex", gap: "10px" },
  btnStart:   { background: "#00e5ff", color: "#0a0e1a", border: "none", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnCapture: { background: "#00ff88", color: "#0a0e1a", border: "none", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnSecondary: { background: "rgba(255,255,255,0.07)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "10px 16px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  photosGrid: { display: "flex", gap: "10px", flexWrap: "wrap" },
  photoWrap:  { position: "relative", width: "90px", height: "90px", borderRadius: "10px", overflow: "hidden", border: "2px solid rgba(0,229,255,0.3)" },
  photoImg:   { width: "100%", height: "100%", objectFit: "cover" },
  photoRemove:{ position: "absolute", top: "4px", right: "4px", background: "rgba(255,92,92,0.85)", color: "#fff", border: "none", borderRadius: "50%", width: "20px", height: "20px", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center" },
  photoLabel: { position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: "11px", textAlign: "center", padding: "2px" },
  btnSave:    { width: "100%", background: "linear-gradient(135deg,#00e5ff,#0066ff)", color: "#fff", border: "none", borderRadius: "10px", padding: "14px", fontWeight: 700, fontSize: "15px", fontFamily: "inherit", transition: "opacity .2s" },
  rightCol:   { display: "flex", flexDirection: "column", gap: "16px" },
  statsBox:   { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "20px", display: "flex", justifyContent: "space-around", alignItems: "center" },
  statItem:   { textAlign: "center" },
  statDivider:{ width: "1px", height: "40px", background: "rgba(255,255,255,0.08)" },
  unregBox:   { background: "rgba(255,214,0,0.05)", border: "1px solid rgba(255,214,0,0.15)", borderRadius: "14px", padding: "16px" },
  unregTitle: { color: "#ffd600", fontWeight: 700, fontSize: "13px", marginBottom: "10px" },
  unregList:  { display: "flex", flexDirection: "column", gap: "6px", maxHeight: "200px", overflowY: "auto" },
  unregItem:  { display: "flex", gap: "10px", alignItems: "center", padding: "8px 10px", borderRadius: "8px", cursor: "pointer", background: "rgba(255,255,255,0.03)" },
  unregAvatar:{ width: "28px", height: "28px", borderRadius: "50%", background: "rgba(255,214,0,0.2)", color: "#ffd600", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "12px", flexShrink: 0 },
  guideBox:   { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" },
  guideTitle: { color: "#fff", fontWeight: 700, fontSize: "14px" },
  guideItem:  { display: "flex", gap: "10px", alignItems: "flex-start" },
};
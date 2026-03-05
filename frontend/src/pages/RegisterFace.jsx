import { useState, useRef, useEffect } from "react";
import api from "../api/axios";

export default function RegisterFace() {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);

  const [stream, setStream]         = useState(null);
  const [employees, setEmployees]   = useState([]);
  const [selected, setSelected]     = useState("");
  const [captured, setCaptured]     = useState(null);
  const [status, setStatus]         = useState(null);
  const [saving, setSaving]         = useState(false);
  const [faceDetected, setFaceDetected] = useState(null); // null | true | false

  useEffect(() => {
    api.get("/employees/?is_active=true&limit=200").then(r => setEmployees(r.data));
  }, []);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 }
      });
      videoRef.current.srcObject = s;
      setStream(s);
      setCaptured(null);
      setStatus(null);
      setFaceDetected(null);
    } catch {
      alert("Không thể truy cập camera. Vui lòng cho phép quyền camera!");
    }
  };

  const stopCamera = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
  };

  const capture = () => {
    const canvas = canvasRef.current;
    canvas.width  = videoRef.current.videoWidth  || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0);
    const img = canvas.toDataURL("image/jpeg", 0.92);
    setCaptured(img);
    setFaceDetected(null);
    setStatus(null);
    stopCamera();
  };

  const handleRegister = async () => {
    if (!selected) { setStatus({ success: false, message: "⚠️ Vui lòng chọn nhân viên trước" }); return; }
    if (!captured)  { setStatus({ success: false, message: "⚠️ Vui lòng chụp ảnh khuôn mặt trước" }); return; }

    setSaving(true); setStatus(null); setFaceDetected(null);
    try {
      const res = await api.post(`/employees/${selected}/register-face`, { image_base64: captured });
      setFaceDetected(true);
      setStatus({ success: true, message: "✅ Đăng ký khuôn mặt thành công!" });
      setCaptured(null);
      setSelected("");
      // Reload danh sách để cập nhật trạng thái
      const r = await api.get("/employees/?is_active=true&limit=200");
      setEmployees(r.data);
    } catch (err) {
      const msg = err.response?.data?.detail || "Đăng ký thất bại";
      setFaceDetected(false);
      if (msg.includes("khuôn mặt") || msg.includes("face")) {
        setStatus({
          success: false,
          message: "❌ Không phát hiện khuôn mặt trong ảnh!",
          tips: true,
        });
      } else {
        setStatus({ success: false, message: `❌ ${msg}` });
      }
    } finally {
      setSaving(false);
    }
  };

  const selectedEmp = employees.find(e => String(e.id) === String(selected));
  const registered  = employees.filter(e => e.has_face).length;

  return (
    <div style={styles.page}>
      <h2 style={styles.heading}>Đăng Ký Khuôn Mặt</h2>
      <p style={styles.sub}>Chụp ảnh khuôn mặt nhân viên để đăng ký vào hệ thống điểm danh tự động</p>

      <div style={styles.layout}>
        {/* ── Cột trái ── */}
        <div style={styles.leftCol}>

          {/* Bước 1: Chọn nhân viên */}
          <div style={styles.step}>
            <div style={styles.stepNum}>1</div>
            <div style={{ flex: 1 }}>
              <div style={styles.stepTitle}>Chọn nhân viên</div>
              <select style={styles.select} value={selected} onChange={e => setSelected(e.target.value)}>
                <option value="">-- Chọn nhân viên --</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>
                    [{e.employee_code}] {e.full_name}
                    {e.has_face ? " ✓" : ""}
                  </option>
                ))}
              </select>

              {selectedEmp && (
                <div style={styles.empCard}>
                  <div style={styles.empAvatar}>{selectedEmp.full_name[0]}</div>
                  <div>
                    <div style={{ color: "#fff", fontWeight: 700 }}>{selectedEmp.full_name}</div>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>
                      {selectedEmp.employee_code} • {selectedEmp.department || "Chưa có phòng ban"}
                    </div>
                    <div style={{
                      color: selectedEmp.has_face ? "#00ff88" : "#ffd600",
                      fontSize: "12px", marginTop: "4px"
                    }}>
                      {selectedEmp.has_face
                        ? "✓ Đã đăng ký khuôn mặt — có thể đăng ký lại"
                        : "⚠ Chưa đăng ký khuôn mặt"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bước 2: Chụp ảnh */}
          <div style={styles.step}>
            <div style={styles.stepNum}>2</div>
            <div style={{ flex: 1 }}>
              <div style={styles.stepTitle}>Chụp ảnh khuôn mặt</div>

              {/* Camera / Preview */}
              <div style={{
                ...styles.camBox,
                borderColor: faceDetected === true ? "#00ff88"
                           : faceDetected === false ? "#ff5c5c"
                           : "rgba(255,255,255,0.08)"
              }}>
                <video ref={videoRef} autoPlay muted playsInline
                  style={{ width: "100%", borderRadius: "8px", display: stream ? "block" : "none" }} />
                {captured && !stream && (
                  <div style={{ position: "relative" }}>
                    <img src={captured} alt="captured"
                      style={{ width: "100%", borderRadius: "8px", display: "block" }} />
                    {faceDetected === false && (
                      <div style={styles.faceOverlay}>
                        ❌ Không phát hiện mặt
                      </div>
                    )}
                    {faceDetected === true && (
                      <div style={{ ...styles.faceOverlay, background: "rgba(0,255,136,0.8)" }}>
                        ✅ Đã nhận diện mặt
                      </div>
                    )}
                  </div>
                )}
                {!stream && !captured && (
                  <div style={styles.camPlaceholder}>
                    <span style={{ fontSize: "40px" }}>📸</span>
                    <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "13px", marginTop: "8px" }}>
                      Bật camera để chụp ảnh
                    </p>
                  </div>
                )}
                <canvas ref={canvasRef} style={{ display: "none" }} />
              </div>

              {/* Camera controls */}
              <div style={styles.camControls}>
                {!stream ? (
                  <button onClick={startCamera} style={styles.btnStart}>▶ Bật Camera</button>
                ) : (
                  <button onClick={capture} style={styles.btnCapture}>📸 Chụp Ảnh</button>
                )}
                {captured && !stream && (
                  <button onClick={startCamera} style={styles.btnRetake}>↩ Chụp lại</button>
                )}
              </div>
            </div>
          </div>

          {/* Bước 3: Đăng ký */}
          <div style={styles.step}>
            <div style={styles.stepNum}>3</div>
            <div style={{ flex: 1 }}>
              <div style={styles.stepTitle}>Xác nhận đăng ký</div>

              {/* Thông báo lỗi không nhận mặt */}
              {status && !status.success && status.tips && (
                <div style={styles.tipsBox}>
                  <div style={styles.tipsTitle}>💡 Mẹo chụp ảnh tốt hơn:</div>
                  <ul style={styles.tipsList}>
                    <li>Đảm bảo <strong>ánh sáng đủ sáng</strong>, không ngược sáng</li>
                    <li>Nhìn <strong>thẳng vào camera</strong>, không nghiêng quá nhiều</li>
                    <li>Khuôn mặt chiếm <strong>ít nhất 1/3 khung hình</strong></li>
                    <li>Không đeo <strong>khẩu trang, kính râm</strong></li>
                    <li>Tránh <strong>phông nền quá phức tạp</strong></li>
                  </ul>
                  <button onClick={startCamera} style={styles.btnRetryCamera}>
                    📷 Chụp lại ngay
                  </button>
                </div>
              )}

              {/* Thông báo thành công/thất bại */}
              {status && (
                <div style={{
                  ...styles.statusBox,
                  borderColor: status.success ? "#00ff88" : "#ff5c5c",
                  background: status.success ? "rgba(0,255,136,0.08)" : "rgba(255,92,92,0.08)",
                }}>
                  <span style={{ color: status.success ? "#00ff88" : "#ff5c5c" }}>
                    {status.message}
                  </span>
                </div>
              )}

              <button
                onClick={handleRegister}
                disabled={saving || !selected || !captured}
                style={{
                  ...styles.btnRegister,
                  opacity: (saving || !selected || !captured) ? 0.5 : 1,
                }}
              >
                {saving ? "⏳ Đang xử lý..." : "🪪 Đăng Ký Khuôn Mặt"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Cột phải: Hướng dẫn + thống kê ── */}
        <div style={styles.rightCol}>
          {/* Thống kê */}
          <div style={styles.statsBox}>
            <div style={styles.statItem}>
              <div style={{ color: "#00e5ff", fontWeight: 700, fontSize: "28px" }}>
                {employees.length}
              </div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>Tổng nhân viên</div>
            </div>
            <div style={styles.statDivider} />
            <div style={styles.statItem}>
              <div style={{ color: "#00ff88", fontWeight: 700, fontSize: "28px" }}>
                {registered}
              </div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>Đã đăng ký mặt</div>
            </div>
            <div style={styles.statDivider} />
            <div style={styles.statItem}>
              <div style={{ color: "#ffd600", fontWeight: 700, fontSize: "28px" }}>
                {employees.length - registered}
              </div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>Chưa đăng ký</div>
            </div>
          </div>

          {/* Danh sách chưa đăng ký */}
          {employees.filter(e => !e.has_face).length > 0 && (
            <div style={styles.unregBox}>
              <div style={styles.unregTitle}>⚠ Chưa đăng ký khuôn mặt</div>
              <div style={styles.unregList}>
                {employees.filter(e => !e.has_face).map(e => (
                  <div key={e.id} style={styles.unregItem}
                    onClick={() => setSelected(String(e.id))}>
                    <div style={styles.unregAvatar}>{e.full_name[0]}</div>
                    <div>
                      <div style={{ color: "#fff", fontSize: "13px", fontWeight: 600 }}>{e.full_name}</div>
                      <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "11px" }}>{e.employee_code}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hướng dẫn */}
          <div style={styles.guideBox}>
            <div style={styles.guideTitle}>📋 Hướng dẫn chụp ảnh</div>
            {[
              ["💡", "Ánh sáng tốt", "Chiếu sáng đều, tránh ngược sáng hoặc tối"],
              ["👤", "Một mình",     "Chỉ có một khuôn mặt trong khung hình"],
              ["🎯", "Nhìn thẳng",   "Nhìn thẳng camera, không nghiêng đầu"],
              ["📐", "Khoảng cách",  "Cách camera 40–60cm"],
              ["😊", "Biểu cảm",     "Giữ mặt tự nhiên, không nhăn mặt"],
            ].map(([icon, title, desc]) => (
              <div key={title} style={styles.guideItem}>
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
        select:focus { outline:none; border-color:#00e5ff !important; }
        button:disabled { cursor:not-allowed; }
        li { margin-bottom: 4px; }
      `}</style>
    </div>
  );
}

const styles = {
  page:    { padding: "32px", flex: 1, overflowY: "auto", fontFamily: "'Space Grotesk', sans-serif" },
  heading: { color: "#fff", fontSize: "26px", fontWeight: 700, margin: "0 0 4px" },
  sub:     { color: "rgba(255,255,255,0.35)", fontSize: "14px", marginBottom: "28px" },
  layout:  { display: "grid", gridTemplateColumns: "1fr 300px", gap: "24px", alignItems: "start" },
  // Left col
  leftCol: { display: "flex", flexDirection: "column", gap: "20px" },
  step:    { display: "flex", gap: "14px", alignItems: "flex-start" },
  stepNum: { width: "28px", height: "28px", borderRadius: "50%", background: "#00e5ff", color: "#0a0e1a", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px", flexShrink: 0, marginTop: "2px" },
  stepTitle: { color: "#00e5ff", fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" },
  select:  { width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "11px 14px", color: "#fff", fontSize: "14px", fontFamily: "inherit" },
  empCard: { display: "flex", gap: "12px", alignItems: "center", background: "rgba(0,229,255,0.08)", border: "1px solid rgba(0,229,255,0.2)", borderRadius: "10px", padding: "12px", marginTop: "10px" },
  empAvatar: { width: "40px", height: "40px", borderRadius: "50%", background: "#00e5ff", color: "#0a0e1a", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "16px", flexShrink: 0 },
  camBox:  { background: "#000", borderRadius: "10px", overflow: "hidden", minHeight: "220px", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid", transition: "border-color .3s", marginBottom: "10px" },
  camPlaceholder: { display: "flex", flexDirection: "column", alignItems: "center", padding: "40px" },
  faceOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px", textAlign: "center", background: "rgba(255,92,92,0.85)", color: "#fff", fontWeight: 700, fontSize: "13px" },
  camControls: { display: "flex", gap: "10px" },
  btnStart:   { background: "#00e5ff", color: "#0a0e1a", border: "none", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnCapture: { background: "#00ff88", color: "#0a0e1a", border: "none", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnRetake:  { background: "rgba(255,255,255,0.07)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "10px 16px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  tipsBox:   { background: "rgba(255,214,0,0.08)", border: "1px solid rgba(255,214,0,0.25)", borderRadius: "10px", padding: "14px 16px", marginBottom: "12px" },
  tipsTitle: { color: "#ffd600", fontWeight: 700, fontSize: "14px", marginBottom: "8px" },
  tipsList:  { color: "rgba(255,255,255,0.65)", fontSize: "13px", paddingLeft: "18px", margin: "0 0 10px" },
  btnRetryCamera: { background: "#ffd600", color: "#0a0e1a", border: "none", borderRadius: "8px", padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: "13px", fontFamily: "inherit" },
  statusBox: { border: "1px solid", borderRadius: "10px", padding: "12px 16px", fontSize: "14px", marginBottom: "12px" },
  btnRegister: { width: "100%", background: "linear-gradient(135deg,#00e5ff,#0066ff)", color: "#fff", border: "none", borderRadius: "10px", padding: "14px", fontWeight: 700, cursor: "pointer", fontSize: "15px", fontFamily: "inherit", transition: "opacity .2s" },
  // Right col
  rightCol:   { display: "flex", flexDirection: "column", gap: "16px" },
  statsBox:   { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "20px", display: "flex", justifyContent: "space-around", alignItems: "center" },
  statItem:   { textAlign: "center" },
  statDivider:{ width: "1px", height: "40px", background: "rgba(255,255,255,0.08)" },
  unregBox:   { background: "rgba(255,214,0,0.05)", border: "1px solid rgba(255,214,0,0.15)", borderRadius: "14px", padding: "16px" },
  unregTitle: { color: "#ffd600", fontWeight: 700, fontSize: "13px", marginBottom: "10px" },
  unregList:  { display: "flex", flexDirection: "column", gap: "6px", maxHeight: "200px", overflowY: "auto" },
  unregItem:  { display: "flex", gap: "10px", alignItems: "center", padding: "8px 10px", borderRadius: "8px", cursor: "pointer", background: "rgba(255,255,255,0.03)", transition: "background .15s" },
  unregAvatar:{ width: "28px", height: "28px", borderRadius: "50%", background: "rgba(255,214,0,0.2)", color: "#ffd600", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "12px", flexShrink: 0 },
  guideBox:   { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" },
  guideTitle: { color: "#fff", fontWeight: 700, fontSize: "14px" },
  guideItem:  { display: "flex", gap: "10px", alignItems: "flex-start" },
};
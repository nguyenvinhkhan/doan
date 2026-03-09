import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { employeeApi } from "../api/axios";

export default function RegisterFacePage() {
  const navigate   = useNavigate();
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);

  const [employee,  setEmployee]  = useState(null);
  const [stream,    setStream]    = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [photos,    setPhotos]    = useState([]);
  const [status,    setStatus]    = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [done,      setDone]      = useState(false);
  const [showPwd,   setShowPwd]   = useState(false);
  const [pwdForm,   setPwdForm]   = useState({ current: "", next: "", confirm: "" });
  const [pwdStatus, setPwdStatus] = useState(null);
  const [pwdSaving, setPwdSaving] = useState(false);

  // ── Kiểm tra đăng nhập ────────────────────────────────────────────────────
  useEffect(() => {
    const token   = localStorage.getItem("employee_token");
    const userStr = localStorage.getItem("employee_user");
    if (!token || !userStr) { navigate("/employee-login"); return; }
    try {
      const user = JSON.parse(userStr);
      if (user.role !== "employee" || !user.employee_id) { navigate("/employee-login"); return; }
      employeeApi.get(`/employees/${user.employee_id}`)
        .then(r => setEmployee(r.data))
        .catch(() => { localStorage.removeItem("employee_token"); navigate("/employee-login"); });
    } catch { navigate("/employee-login"); }
  }, []);

  // ── Camera ────────────────────────────────────────────────────────────────
  const startCamera = async () => {
    // HTTP trên mobile không có mediaDevices → báo lỗi rõ ràng
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus({
        type: "error",
        msg: "❌ Trình duyệt không hỗ trợ camera. Hãy dùng HTTPS hoặc Chrome/Safari mới nhất.",
      });
      return;
    }
    try {
      let s;
      // Thử lần 1: front camera + resolution cụ thể
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        // Thử lần 2: chỉ yêu cầu front camera, bỏ resolution
        try {
          s = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: false,
          });
        } catch {
          // Thử lần 3: bất kỳ camera nào (fallback cuối cùng)
          s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      }
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
      setStream(true);
      setStatus({ type: "info", msg: "Camera đã bật. Nhìn thẳng vào camera rồi nhấn Chụp." });
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

  // Tự tắt camera khi đủ 5 ảnh
  useEffect(() => {
    if (photos.length >= 5 && stream) {
      stopCamera();
      setStatus({ type: "success", msg: "✅ Đã chụp đủ 5 ảnh! Nhấn Lưu khuôn mặt để hoàn tất." });
    }
  }, [photos.length]);

  // ── Chụp ảnh ─────────────────────────────────────────────────────────────
  const capture = useCallback(() => {
    if (!videoRef.current || capturing || photos.length >= 5) return;
    setCapturing(true);
    const canvas = canvasRef.current;
    canvas.width  = videoRef.current.videoWidth  || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setPhotos(prev => {
      const next = [...prev, dataUrl];
      if (next.length < 5) {
        setStatus({ type: "success", msg: `✅ Ảnh ${next.length}/5. Thay đổi góc mặt nhẹ rồi chụp tiếp.` });
      }
      return next;
    });
    setTimeout(() => setCapturing(false), 400);
  }, [capturing, photos.length]);

  const removePhoto = (idx) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
    setStatus({ type: "info", msg: "Đã xóa ảnh." });
  };

  // ── Lưu khuôn mặt ────────────────────────────────────────────────────────
  const saveFace = async () => {
    if (!photos.length) return;
    setSaving(true);
    setStatus({ type: "info", msg: "⏳ Đang xử lý và lưu khuôn mặt..." });
    try {
      const res = await employeeApi.post(
        `/employees/${employee.id}/register-face`,
        { images_base64: photos },
      );
      const count = res.data?.encodings_count || photos.length;
      setDone(true);
      stopCamera();
      setStatus({ type: "success", msg: `🎉 Đăng ký thành công! Đã lưu ${count} encoding. Đang chuyển trang...` });
      setTimeout(() => navigate("/checkin"), 3000);
    } catch (err) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === "object" ? detail?.msg : (detail || "Lưu thất bại. Thử chụp lại ảnh rõ hơn.");
      setStatus({ type: "error", msg: "❌ " + msg });
    } finally {
      setSaving(false);
    }
  };

  // ── Đổi mật khẩu ─────────────────────────────────────────────────────────
  const changePassword = async () => {
    if (!pwdForm.current)            { setPwdStatus({ type: "error", msg: "Nhập mật khẩu hiện tại" }); return; }
    if (pwdForm.next.length < 6)     { setPwdStatus({ type: "error", msg: "Mật khẩu mới phải ít nhất 6 ký tự" }); return; }
    if (pwdForm.next !== pwdForm.confirm) { setPwdStatus({ type: "error", msg: "Xác nhận mật khẩu không khớp" }); return; }
    setPwdSaving(true);
    setPwdStatus(null);
    try {
      await employeeApi.post("/auth/change-password",
        { current_password: pwdForm.current, new_password: pwdForm.next },
      );
      setPwdStatus({ type: "success", msg: "✅ Đổi mật khẩu thành công!" });
      setPwdForm({ current: "", next: "", confirm: "" });
      setTimeout(() => { setShowPwd(false); setPwdStatus(null); }, 1800);
    } catch (err) {
      setPwdStatus({ type: "error", msg: "❌ " + (err.response?.data?.detail || "Đổi mật khẩu thất bại") });
    } finally {
      setPwdSaving(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("employee_token");
    localStorage.removeItem("employee_user");
    stopCamera();
    navigate("/employee-login");
  };

  const C = {
    success: { border: "rgba(0,255,136,0.3)",  bg: "rgba(0,255,136,0.07)",  text: "#00ff88" },
    error:   { border: "rgba(255,92,92,0.3)",   bg: "rgba(255,92,92,0.07)",   text: "#ff5c5c" },
    warn:    { border: "rgba(255,214,0,0.3)",   bg: "rgba(255,214,0,0.07)",   text: "#ffd600" },
    info:    { border: "rgba(0,229,255,0.3)",   bg: "rgba(0,229,255,0.07)",   text: "#00e5ff" },
  };

  return (
    <div style={S.page}>
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* ── Header ── */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.avatarDot}>{employee?.full_name?.[0] || "👤"}</div>
          <div>
            <div style={S.headerTitle}>Đăng ký khuôn mặt</div>
            {employee && (
              <div style={S.headerSub}>
                {employee.full_name} • {employee.employee_code}
                {employee.department ? ` • ${employee.department}` : ""}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => { setShowPwd(p => !p); setPwdStatus(null); }} style={S.btnYellow}>
            🔑 Đổi mật khẩu
          </button>
          <button onClick={logout} style={S.btnRed}>Đăng xuất</button>
        </div>
      </div>

      <div style={S.body}>

        {/* ── Thành công ── */}
        {done ? (
          <div style={S.successBox}>
            <div style={{ fontSize: "72px", marginBottom: "16px" }}>🎉</div>
            <div style={{ color: "#00ff88", fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>
              Đăng ký thành công!
            </div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "15px", marginBottom: "28px", textAlign: "center" }}>
              Khuôn mặt đã được lưu với thuật toán mới.<br />Bạn có thể chấm công bằng khuôn mặt ngay bây giờ.
            </div>
            <button onClick={() => navigate("/checkin")} style={S.btnGreen}>
              ✅ Về trang chấm công
            </button>
          </div>
        ) : (
          <>
            {/* ── Banner nhắc đăng ký lại nếu đã có encoding cũ ── */}
            {employee?.has_face && (
              <div style={S.bannerUpgrade}>
                <span style={{ fontSize: "18px" }}>🔄</span>
                <span>
                  <strong>Thuật toán mới:</strong> Bạn đã đăng ký trước đây.
                  Hãy <strong>đăng ký lại</strong> để nhận diện chính xác hơn (LBP + Gabor + augmentation).
                </span>
              </div>
            )}

            {/* ── Trạng thái khuôn mặt ── */}
            {employee && (
              <div style={S.statusFace}>
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>Trạng thái:</span>
                <span style={{ color: employee.has_face ? "#00ff88" : "#ffd600", fontWeight: 700, fontSize: "13px" }}>
                  {employee.has_face ? "✅ Đã đăng ký" : "⚠️ Chưa đăng ký"}
                </span>
              </div>
            )}

            {/* ── Hướng dẫn ── */}
            <div style={S.guideBox}>
              <div style={S.guideTitle}>📋 Hướng dẫn chụp ảnh đạt chất lượng cao</div>
              <div style={S.guideGrid}>
                {[
                  ["1️⃣", "Bật camera, nhìn thẳng"],
                  ["2️⃣", "Chụp ảnh thứ nhất"],
                  ["3️⃣", "Xoay đầu nhẹ trái/phải, chụp tiếp"],
                  ["4️⃣", "Chụp đủ 5 ảnh → Lưu"],
                ].map(([icon, text]) => (
                  <div key={text} style={S.guideItem}>
                    <span>{icon}</span>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "13px" }}>{text}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                {["💡 Ánh sáng đủ sáng", "😶 Không đeo khẩu trang", "📐 Cách 40–60cm", "👁 Nhìn vào camera"].map(tip => (
                  <span key={tip} style={S.tip}>{tip}</span>
                ))}
              </div>
            </div>

            {/* ── Camera ── */}
            <div style={S.cameraCard}>
              <div style={S.stepHeader}>
                <span style={S.stepNum}>2</span>
                <span style={S.stepLabel}>Chụp ảnh ({photos.length}/5)</span>
                {photos.length > 0 && (
                  <span style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
                    {[1,2,3,4,5].map(i => (
                      <span key={i} style={{ width: 8, height: 8, borderRadius: "50%",
                        background: i <= photos.length ? "#00ff88" : "rgba(255,255,255,0.15)" }} />
                    ))}
                  </span>
                )}
              </div>

              <div style={S.videoWrap}>
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  webkit-playsinline="true"
                  style={{
                    width: "100%", height: "100%", objectFit: "cover",
                    display: stream ? "block" : "none", transform: "scaleX(-1)"
                  }}
                />
                {!stream && (
                  <div style={S.camPlaceholder}>
                    <div style={{ fontSize: "52px", marginBottom: "10px" }}>📷</div>
                    <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "14px" }}>Camera chưa bật</div>
                  </div>
                )}
                {stream && (
                  <div style={S.faceGuide}>
                    <div style={S.faceOval} />
                    <div style={S.faceHint}>Đặt mặt vào khung</div>
                  </div>
                )}
                {stream && photos.length < 5 && (
                  <div style={S.photoCount}>{photos.length}/5</div>
                )}
              </div>

              <div style={S.controls}>
                {!stream ? (
                  <button onClick={startCamera} style={{ ...S.btnBlue, flex: 1 }}>
                    📷 Bật Camera
                  </button>
                ) : (
                  <>
                    <button onClick={capture} disabled={capturing || photos.length >= 5}
                      style={{ ...S.btnGreen, flex: 1, opacity: (capturing || photos.length >= 5) ? 0.4 : 1 }}>
                      {capturing ? "⏳..." : `📸 Chụp (${photos.length}/5)`}
                    </button>
                    <button onClick={stopCamera} style={S.btnGray}>⏹ Tắt</button>
                  </>
                )}
                {photos.length > 0 && !stream && (
                  <button onClick={startCamera} style={S.btnGray}>↩ Chụp thêm</button>
                )}
              </div>
            </div>

            {/* ── Thông báo ── */}
            {status && (
              <div style={{ border: `1px solid ${C[status.type].border}`, background: C[status.type].bg,
                color: C[status.type].text, borderRadius: "10px", padding: "12px 16px",
                fontSize: "14px", fontWeight: 600 }}>
                {status.msg}
              </div>
            )}

            {/* ── Ảnh đã chụp ── */}
            {photos.length > 0 && (
              <div style={S.photosCard}>
                <div style={S.stepHeader}>
                  <span style={S.stepNum}>3</span>
                  <span style={S.stepLabel}>Ảnh đã chụp ({photos.length}/5)</span>
                </div>
                <div style={S.photosGrid}>
                  {photos.map((photo, i) => (
                    <div key={i} style={S.photoWrap}>
                      <img src={photo} alt={`Ảnh ${i+1}`} style={S.photoImg} />
                      <button onClick={() => removePhoto(i)} style={S.photoRemove}>✕</button>
                      <div style={S.photoLabel}>Ảnh {i+1}</div>
                    </div>
                  ))}
                  {Array.from({ length: 5 - photos.length }).map((_, i) => (
                    <div key={`empty-${i}`} style={S.photoEmpty}>
                      <span style={{ fontSize: "20px", color: "rgba(255,255,255,0.15)" }}>+</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={saveFace}
                  disabled={saving || photos.length === 0}
                  style={{ ...S.btnSave, opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? "⏳ Đang xử lý và lưu..." : `💾 Lưu Khuôn Mặt (${photos.length} ảnh)`}
                </button>

                {photos.length < 3 && (
                  <div style={{ color: "#ffd600", fontSize: "12px", textAlign: "center" }}>
                    💡 Nên chụp ít nhất 3 ảnh để nhận diện chính xác hơn
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modal đổi mật khẩu ── */}
      {showPwd && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && setShowPwd(false)}>
          <div style={S.pwdCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: "18px" }}>🔑 Đổi mật khẩu</div>
              <button onClick={() => { setShowPwd(false); setPwdStatus(null); setPwdForm({ current: "", next: "", confirm: "" }); }}
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "20px" }}>✕</button>
            </div>

            {[
              { key: "current",  label: "Mật khẩu hiện tại",     placeholder: "Nhập mật khẩu hiện tại" },
              { key: "next",     label: "Mật khẩu mới",          placeholder: "Ít nhất 6 ký tự" },
              { key: "confirm",  label: "Xác nhận mật khẩu mới", placeholder: "Nhập lại mật khẩu mới" },
            ].map(({ key, label, placeholder }) => (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px", fontWeight: 600 }}>{label}</label>
                <input
                  type="password"
                  value={pwdForm[key]}
                  onChange={e => setPwdForm(p => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                  style={S.pwdInput}
                  onKeyDown={e => e.key === "Enter" && changePassword()}
                />
              </div>
            ))}

            {pwdStatus && (
              <div style={{
                padding: "10px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                color: pwdStatus.type === "success" ? "#00ff88" : "#ff5c5c",
                background: pwdStatus.type === "success" ? "rgba(0,255,136,0.08)" : "rgba(255,92,92,0.08)",
                border: `1px solid ${pwdStatus.type === "success" ? "rgba(0,255,136,0.3)" : "rgba(255,92,92,0.3)"}`,
              }}>
                {pwdStatus.msg}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={changePassword} disabled={pwdSaving}
                style={{ ...S.btnBlue, flex: 1, opacity: pwdSaving ? 0.6 : 1 }}>
                {pwdSaving ? "⏳ Đang lưu..." : "💾 Xác nhận"}
              </button>
              <button onClick={() => { setShowPwd(false); setPwdStatus(null); setPwdForm({ current: "", next: "", confirm: "" }); }}
                style={S.btnGray}>
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        button:disabled { cursor: not-allowed; }
        input, button { font-size: 16px !important; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      `}</style>
    </div>
  );
}

const S = {
  page: { minHeight: "100vh", background: "linear-gradient(135deg,#07101f,#0d1628)", fontFamily: "'Space Grotesk',sans-serif", color: "#fff", display: "flex", flexDirection: "column" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "rgba(0,0,0,0.35)", borderBottom: "1px solid rgba(255,255,255,0.07)", flexWrap: "wrap", gap: "10px" },
  headerLeft: { display: "flex", alignItems: "center", gap: "12px" },
  avatarDot: { width: "40px", height: "40px", borderRadius: "50%", background: "linear-gradient(135deg,#00e5ff,#0066ff)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "18px", color: "#fff", flexShrink: 0 },
  headerTitle: { color: "#fff", fontWeight: 700, fontSize: "15px" },
  headerSub: { color: "rgba(255,255,255,0.4)", fontSize: "12px", marginTop: "2px" },
  body: { flex: 1, padding: "16px", maxWidth: "560px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" },
  btnBlue:   { background: "linear-gradient(135deg,#00e5ff,#0066ff)", color: "#fff", border: "none", borderRadius: "10px", padding: "13px 20px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: "48px" },
  btnGreen:  { background: "linear-gradient(135deg,#00ff88,#00cc66)", color: "#0a0e1a", border: "none", borderRadius: "10px", padding: "13px 20px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: "48px" },
  btnGray:   { background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", padding: "12px 16px", cursor: "pointer", fontFamily: "inherit" },
  btnYellow: { background: "rgba(255,214,0,0.1)", border: "1px solid rgba(255,214,0,0.3)", color: "#ffd600", borderRadius: "8px", padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 },
  btnRed:    { background: "rgba(255,92,92,0.1)", border: "1px solid rgba(255,92,92,0.3)", color: "#ff5c5c", borderRadius: "8px", padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" },
  btnSave:   { width: "100%", background: "linear-gradient(135deg,#00e5ff,#0066ff)", color: "#fff", border: "none", borderRadius: "12px", padding: "16px", fontWeight: 700, fontSize: "16px", cursor: "pointer", fontFamily: "inherit", minHeight: "54px" },
  bannerUpgrade: { background: "rgba(0,229,255,0.07)", border: "1px solid rgba(0,229,255,0.25)", borderRadius: "12px", padding: "12px 16px", color: "#00e5ff", fontSize: "13px", display: "flex", alignItems: "flex-start", gap: "10px" },
  statusFace: { display: "flex", alignItems: "center", gap: "8px", justifyContent: "center", padding: "8px", background: "rgba(255,255,255,0.03)", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)" },
  guideBox: { background: "rgba(0,229,255,0.04)", border: "1px solid rgba(0,229,255,0.12)", borderRadius: "14px", padding: "16px" },
  guideTitle: { color: "#00e5ff", fontWeight: 700, fontSize: "13px", marginBottom: "12px" },
  guideGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" },
  guideItem: { display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "8px 10px", fontSize: "13px" },
  tip: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "20px", padding: "4px 10px", fontSize: "12px", color: "rgba(255,255,255,0.5)" },
  cameraCard: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" },
  stepHeader: { display: "flex", alignItems: "center", gap: "10px" },
  stepNum: { width: "24px", height: "24px", borderRadius: "50%", background: "#00e5ff", color: "#07101f", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "12px", flexShrink: 0 },
  stepLabel: { color: "#00e5ff", fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.5px" },
  videoWrap: { position: "relative", width: "100%", aspectRatio: "4/3", background: "#000", borderRadius: "12px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "320px" },
  camPlaceholder: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
  faceGuide: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" },
  faceOval: { width: "160px", height: "200px", border: "2px dashed rgba(0,229,255,0.6)", borderRadius: "50%", boxShadow: "0 0 24px rgba(0,229,255,0.15)" },
  faceHint: { color: "rgba(0,229,255,0.7)", fontSize: "12px", marginTop: "10px", fontWeight: 600 },
  photoCount: { position: "absolute", top: "10px", left: "12px", background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: "20px", padding: "3px 10px", fontSize: "12px", fontWeight: 700 },
  controls: { display: "flex", gap: "10px" },
  photosCard: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "16px", display: "flex", flexDirection: "column", gap: "14px" },
  photosGrid: { display: "flex", gap: "8px", flexWrap: "wrap" },
  photoWrap: { position: "relative", width: "88px", height: "88px", borderRadius: "10px", overflow: "hidden", border: "2px solid rgba(0,229,255,0.4)" },
  photoImg: { width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" },
  photoRemove: { position: "absolute", top: "3px", right: "3px", background: "rgba(255,92,92,0.85)", color: "#fff", border: "none", borderRadius: "50%", width: "20px", height: "20px", cursor: "pointer", fontSize: "10px", display: "flex", alignItems: "center", justifyContent: "center" },
  photoLabel: { position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: "10px", textAlign: "center", padding: "2px" },
  photoEmpty: { width: "88px", height: "88px", borderRadius: "10px", border: "2px dashed rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" },
  successBox: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", textAlign: "center" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" },
  pwdCard: { background: "#0d1628", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "400px", display: "flex", flexDirection: "column", gap: "16px", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" },
  pwdInput: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "12px 14px", color: "#fff", fontFamily: "inherit", width: "100%" },
};
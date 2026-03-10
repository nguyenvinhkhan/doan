import { useState, useRef, useEffect, useCallback } from "react";
import { publicApi } from "../api/axios";

const WS_URL = (import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws") + "/attendance";
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Nếu URL camera là HTTP nhưng trang chạy HTTPS → dùng proxy backend
function getStreamUrl(url) {
  if (!url) return url;
  if (window.location.protocol === "https:" && url.startsWith("http://")) {
    return `${API_BASE}/proxy/stream?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export default function Realtime() {
  const videoRef    = useRef(null);
  const imgRef      = useRef(null);  // dùng cho IP camera (MJPEG)
  const canvasRef   = useRef(null);
  const wsRef       = useRef(null);
  const pingRef     = useRef(null);
  const streamRef   = useRef(null);
  const autoRef     = useRef(false);

  const [camMode, setCamMode]       = useState("webcam"); // "webcam" | "ip"
  const [ipUrl, setIpUrl]           = useState("http://192.168.1.3:4747/mjpegfeed");
  const [isIPMode, setIsIPMode]     = useState(false);
  const [stream, setStream]         = useState(false);
  const [wsStatus, setWsStatus]     = useState("disconnected");
  const [scanning, setScanning]     = useState(false);
  const [autoScan, setAutoScan]     = useState(false);
  const [result, setResult]         = useState(null);
  const [feed, setFeed]             = useState([]);
  const [showIpForm, setShowIpForm] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Đồng hồ thời gian thực
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // WebSocket
  useEffect(() => {
    const connect = () => {
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onopen = () => {
          setWsStatus("connected");
          pingRef.current = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
        };
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.type === "attendance") {
            setFeed(prev => [msg, ...prev].slice(0, 30));
          }
        };
        ws.onclose = () => {
          setWsStatus("disconnected");
          clearInterval(pingRef.current);
          setTimeout(connect, 3000);
        };
      } catch {}
    };
    connect();
    return () => { wsRef.current?.close(); clearInterval(pingRef.current); };
  }, []);

  // Fetch nhật ký hôm nay khi load trang
  useEffect(() => {
    publicApi.get("/public/today-feed")
      .then(r => setFeed(r.data))
      .catch(() => {}); // Nếu lỗi thì thôi, không crash
  }, []);

  // Bật webcam
  const startWebcam = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setResult({ success: false, code: "CAM_ERROR", message: "❌ Trình duyệt không hỗ trợ camera. Dùng HTTPS + Chrome/Safari mới nhất." });
      return;
    }
    try {
      let s;
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        try {
          s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        } catch {
          s = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.src = "";
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.setAttribute("webkit-playsinline", "true");
        await videoRef.current.play().catch(() => {});
      }
      setStream(true);
    } catch (err) {
      const msg = err.name === "NotAllowedError"
        ? "❌ Chưa cấp quyền camera. Vào Cài đặt trình duyệt để cho phép."
        : err.name === "NotFoundError"
        ? "❌ Không tìm thấy camera trên thiết bị."
        : `❌ Không thể mở camera: ${err.message}`;
      setResult({ success: false, code: "CAM_ERROR", message: msg });
    }
  };

  // Kết nối camera IP
  const startIPCamera = () => {
    if (!ipUrl) return;
    stopCamera();
    setIsIPMode(true);
    setStream(true);
    setShowIpForm(false);
    // Dùng img tag cho MJPEG (tương thích hơn video tag)
    setTimeout(() => {
      if (imgRef.current) {
        imgRef.current.src = getStreamUrl(ipUrl) + "?t=" + Date.now();
      }
    }, 100);
  };

  const stopCamera = () => {
    setIsIPMode(false);
    if (imgRef.current) imgRef.current.src = "";
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.src = "";
      videoRef.current.srcObject = null;
    }
    setStream(false);
    setAutoScan(false);
    autoRef.current = false;
  };

  // Chụp & nhận diện
  const capture = useCallback(async () => {
    if (scanning) return;
    // Xác định nguồn hình: webcam hoặc IP camera (dùng imgRef)
    const source = isIPMode ? imgRef.current : videoRef.current;
    if (!source) return;
    if (!isIPMode && !videoRef.current?.videoWidth) return; // video chưa load
    const canvas = canvasRef.current;
    // Resize về tối đa 640px — giảm payload, tăng tốc độ gửi lên server
    const MAX_SIZE = 640;
    const rawW = isIPMode ? (imgRef.current.naturalWidth  || 640) : videoRef.current.videoWidth;
    const rawH = isIPMode ? (imgRef.current.naturalHeight || 480) : videoRef.current.videoHeight;
    const scale = Math.min(1, MAX_SIZE / Math.max(rawW, rawH));
    canvas.width  = Math.round(rawW * scale);
    canvas.height = Math.round(rawH * scale);
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    const image_base64 = canvas.toDataURL("image/jpeg", 0.82);

    setScanning(true);
    try {
      const res = await publicApi.post("/public/face-checkin", { image_base64 });
      const data = res.data;
      const event = { ...data, success: true, timestamp: new Date().toISOString() };
      setResult(event);
      setFeed(prev => [event, ...prev].slice(0, 30));
      // Tắt autoScan sau check-in/check-out thành công, tránh quét lại ngay
      setAutoScan(false);
      // Tự động bật lại sau 10 giây
      setTimeout(() => setAutoScan(true), 10000);
    } catch (err) {
      const detail = err.response?.data?.detail;
      const code   = typeof detail === "object" ? detail?.code  : "UNKNOWN";
      const msg    = typeof detail === "object" ? detail?.msg   : (detail || "Không nhận diện được");
      const conf   = typeof detail === "object" ? detail?.confidence : null;
      setResult({ success: false, code, message: msg, confidence: conf });
      // Delay tuỳ theo loại lỗi
      const delay = (code === "NO_FACE" || code === "POOR_LIGHT") ? 2000
                  : (code === "LOW_CONFIDENCE" || code === "AMBIGUOUS") ? 3000
                  : (code === "ALREADY_CHECKED_OUT") ? 5000
                  : 3000;
      if (err.response?.status === 404 || err.response?.status === 400) {
        setAutoScan(false);
        setTimeout(() => setAutoScan(true), delay);
      }
    } finally {
      setScanning(false);
    }
  }, [scanning]);

  // Auto scan — dùng setTimeout thay vì setInterval để tránh requests chồng nhau
  useEffect(() => { autoRef.current = autoScan; }, [autoScan]);
  useEffect(() => {
    if (!autoScan) return;
    let timer;
    const loop = () => {
      if (!autoRef.current) return;
      capture();
      timer = setTimeout(loop, 3500); // 3.5s đủ để server xử lý + trả về
    };
    timer = setTimeout(loop, 1000); // delay 1s trước khi bắt đầu
    return () => clearTimeout(timer);
  }, [autoScan, capture]);

  const toggleAuto = () => setAutoScan(a => !a);

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.brand}>
          <div style={S.brandDot} />
          <span style={S.brandText}>FaceAttend</span>
          <span style={S.brandSub}>Hệ thống điểm danh</span>
        </div>
        <div style={S.clock}>
          <div style={S.clockTime}>
            {currentTime.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div style={S.clockDate}>
            {currentTime.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}
          </div>
        </div>
        <div style={S.wsChip}>
          <span style={{ ...S.wsDot, background: wsStatus === "connected" ? "#00ff88" : "#ff5c5c" }} />
          <span>{wsStatus === "connected" ? "Trực tuyến" : "Đang kết nối..."}</span>
        </div>

        {/* Điều hướng */}
        <div style={{ display: "flex", gap: "8px" }}>
          <a href="/employee-login" style={S.navBtn}>
            👤 Đăng ký mặt
          </a>
          <a href="/login" style={{ ...S.navBtn, background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)" }}>
            🔐 Quản trị
          </a>
        </div>
      </div>

      <div style={S.body}>
        {/* Camera Panel */}
        <div style={S.cameraCol}>

          {/* Chọn loại camera */}
          <div style={S.camTabs}>
            <button onClick={() => { setCamMode("webcam"); stopCamera(); }}
              style={{ ...S.camTab, ...(camMode === "webcam" ? S.camTabActive : {}) }}>
              📷 Webcam
            </button>
            <button onClick={() => { setCamMode("ip"); stopCamera(); setShowIpForm(true); }}
              style={{ ...S.camTab, ...(camMode === "ip" ? S.camTabActive : {}) }}>
              🌐 Camera IP
            </button>
          </div>

          {/* Form nhập IP camera */}
          {showIpForm && camMode === "ip" && (
            <div style={S.ipForm}>
              <div style={S.ipFormTitle}>🌐 Kết nối Camera IP</div>
              <div style={S.ipExamples}>
                <span style={S.ipLabel}>Ví dụ URL:</span>
                {[
                  { label: "IP Webcam (Android)", url: "http://192.168.1.x:8080/video" },
                  { label: "RTSP Camera",          url: "rtsp://admin:pass@192.168.1.x/stream" },
                  { label: "MJPEG Stream",         url: "http://192.168.1.x/mjpg/video.mjpg" },
                ].map(ex => (
                  <button key={ex.label} onClick={() => setIpUrl(ex.url)} style={S.ipExample}>
                    {ex.label}
                  </button>
                ))}
              </div>
              <input
                style={S.ipInput}
                value={ipUrl}
                onChange={e => setIpUrl(e.target.value)}
                placeholder="Nhập URL camera IP..."
              />
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={startIPCamera} style={S.btnConnect}>▶ Kết nối</button>
                <button onClick={() => setShowIpForm(false)} style={S.btnCancel}>Hủy</button>
              </div>
            </div>
          )}

          {/* Video */}
          <div style={S.videoBox}>
            {/* Webcam */}
            <video
              ref={videoRef}
              autoPlay muted playsInline
              crossOrigin="anonymous"
              style={{ ...S.video, display: (stream && !isIPMode) ? "block" : "none" }}
            />
            {/* IP Camera — dùng img tag để hiển thị MJPEG */}
            <img
              ref={imgRef}
              alt="IP Camera"
              crossOrigin="anonymous"
              style={{ ...S.video, display: (stream && isIPMode) ? "block" : "none", objectFit: "cover" }}
            />
            {!stream && (
              <div style={S.videoPlaceholder}>
                <div style={S.camIcon}>📷</div>
                <p style={S.camHint}>Chọn nguồn camera để bắt đầu</p>
                <div style={S.camBtns}>
                  <button onClick={startWebcam} style={S.btnPrimary}>▶ Bật Webcam</button>
                  <button onClick={() => { setCamMode("ip"); setShowIpForm(true); }} style={S.btnSecondary}>
                    🌐 Camera IP
                  </button>
                </div>
              </div>
            )}

            {/* Scan overlay */}
            {scanning && (
              <div style={S.scanOverlay}>
                <div style={S.scanFrame} />
                <div style={S.scanLine} />
                <div style={S.scanLabel}>Đang nhận diện...</div>
              </div>
            )}

            {/* Auto badge */}
            {autoScan && stream && (
              <div style={S.autoBadge}>🔄 Tự động • mỗi 3 giây</div>
            )}

            <canvas ref={canvasRef} style={{ display: "none" }} />
          </div>

          {/* Controls */}
          {stream && (
            <div style={S.controls}>
              <button onClick={capture} disabled={scanning} style={S.btnCapture}>
                {scanning ? "⏳ Đang quét..." : "📸 Điểm Danh"}
              </button>
              <button onClick={toggleAuto} style={{ ...S.btnAuto, ...(autoScan ? S.btnAutoOn : {}) }}>
                {autoScan ? "⏸ Dừng tự động" : "🔄 Tự động"}
              </button>
              <button onClick={stopCamera} style={S.btnStop}>■ Tắt camera</button>
            </div>
          )}

          {/* Kết quả nhận diện */}
          {result && (
            <div style={{ ...S.resultCard, borderColor: result.success ? "#00ff88" : "#ff5c5c" }}>
              {result.success ? (
                <>
                  <div style={S.resultIcon}>✅</div>
                  <div style={S.resultInfo}>
                    <div style={S.resultName}>{result.employee}</div>
                    <div style={S.resultMeta}>
                      <span style={S.chip}>{result.employee_code}</span>
                      <span style={{ ...S.chip, background: result.action === "check_in" ? "rgba(0,255,136,0.15)" : "rgba(0,229,255,0.15)", color: result.action === "check_in" ? "#00ff88" : "#00e5ff" }}>
                        {result.action === "check_in" ? "✓ Vào ca" : "✓ Tan ca"}
                      </span>
                      {result.status === "late" && <span style={{ ...S.chip, background: "rgba(255,214,0,0.15)", color: "#ffd600" }}>⚠ Đi trễ</span>}
                      <span style={S.chip}>{(result.confidence * 100).toFixed(1)}% khớp</span>
                    </div>
                    <div style={S.resultTime}>
                      {new Date(result.timestamp || result.time).toLocaleTimeString("vi-VN")}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={S.resultIcon}>
                    {result.code === "NO_FACE"           ? "📷"
                   : result.code === "POOR_LIGHT"        ? "💡"
                   : result.code === "LOW_CONFIDENCE"    ? "🔍"
                   : result.code === "AMBIGUOUS"         ? "👥"
                   : result.code === "ALREADY_CHECKED_OUT" ? "✅"
                   : result.code === "NOT_REGISTERED"   ? "❓"
                   : "❌"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      color: result.code === "ALREADY_CHECKED_OUT" ? "#ffd600" : "#ff5c5c",
                      fontWeight: 700, fontSize: "15px", marginBottom: "4px"
                    }}>{result.message}</div>
                    {result.confidence != null && (
                      <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "12px" }}>
                        Điểm khớp cao nhất: {(result.confidence * 100).toFixed(1)}%
                      </div>
                    )}
                    {result.code === "NO_FACE" && (
                      <div style={S.resultHint}>💡 Đảm bảo khuôn mặt trong khung hình</div>
                    )}
                    {result.code === "POOR_LIGHT" && (
                      <div style={S.resultHint}>💡 Tăng ánh sáng hoặc tránh ngược sáng</div>
                    )}
                    {result.code === "NOT_REGISTERED" && (
                      <div style={S.resultHint}>💡 Liên hệ quản trị viên để đăng ký</div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Feed Panel */}
        <div style={S.feedCol} className="faceattend-feed">
          <div style={S.feedHeader}>
            <h3 style={S.feedTitle}>Nhật ký hôm nay</h3>
            <span style={S.feedCount}>{feed.length} sự kiện</span>
          </div>
          <div style={S.feedList}>
            {feed.length === 0 && (
              <div style={S.feedEmpty}>Chưa có điểm danh nào hôm nay</div>
            )}
            {feed.map((f, i) => (
              <div key={i} style={{ ...S.feedItem, borderLeftColor: f.action === "check_in" ? "#00ff88" : "#00e5ff" }}>
                <div style={S.feedName}>{f.employee || "—"}</div>
                <div style={S.feedDetail}>
                  <span style={{ color: f.action === "check_in" ? "#00ff88" : "#00e5ff", fontSize: "12px" }}>
                    {f.action === "check_in" ? "▲ Vào ca" : "▼ Tan ca"}
                  </span>
                  {f.status === "late" && <span style={{ color: "#ffd600", fontSize: "12px" }}> • ⚠ Trễ</span>}
                  <span style={S.feedTime}>
                    {new Date(f.time || f.timestamp).toLocaleTimeString("vi-VN")}
                  </span>
                </div>
                {f.confidence && (
                  <div style={S.feedConf}>{(f.confidence * 100).toFixed(1)}%</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
        @media (min-width: 768px) {
          .faceattend-body { flex-direction: row !important; }
          .faceattend-feed { width: 300px !important; max-height: none !important; border-top: none !important; border-left: 1px solid rgba(255,255,255,0.06) !important; }
        }
        * { -webkit-tap-highlight-color: transparent; }
        input, select, button { font-size: 16px !important; } /* Ngăn zoom trên iOS/Android khi focus */
        @keyframes scanMove { 0%{top:5%} 100%{top:95%} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        input:focus { outline:none; border-color:#00e5ff !important; }
        button:disabled { opacity:0.5; cursor:not-allowed; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-thumb { background:rgba(0,229,255,0.2); border-radius:2px; }
      `}</style>
    </div>
  );
}

const S = {
  page: { minHeight: "100vh", background: "#07101f", fontFamily: "'Space Grotesk', sans-serif", display: "flex", flexDirection: "column" },
  // Header
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(0,229,255,0.1)", flexWrap: "wrap", gap: "8px" },
  brand: { display: "flex", alignItems: "center", gap: "10px" },
  brandDot: { width: "10px", height: "10px", borderRadius: "50%", background: "#00e5ff", boxShadow: "0 0 10px #00e5ff", animation: "pulse 2s infinite" },
  brandText: { color: "#fff", fontWeight: 700, fontSize: "20px" },
  brandSub: { color: "rgba(255,255,255,0.3)", fontSize: "13px" },
  clock: { textAlign: "center" },
  clockTime: { color: "#fff", fontWeight: 700, fontSize: "28px", letterSpacing: "2px", fontVariantNumeric: "tabular-nums" },
  clockDate: { color: "rgba(255,255,255,0.4)", fontSize: "13px", textTransform: "capitalize" },
  navBtn: {
    background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.25)",
    color: "#00e5ff", borderRadius: "8px", padding: "7px 14px", fontSize: "13px",
    fontWeight: 600, textDecoration: "none", fontFamily: "inherit",
    display: "flex", alignItems: "center", gap: "6px",
    transition: "background 0.2s",
  },
  wsChip: { display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "6px 14px", color: "rgba(255,255,255,0.5)", fontSize: "12px" },
  wsDot: { width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0 },
  // Body
  body: { display: "flex", flex: 1, gap: "0", overflow: "hidden",
    flexDirection: "column" }, // stack dọc mặc định, row trên desktop qua CSS

  cameraCol: { flex: 1, padding: "16px", display: "flex", flexDirection: "column", gap: "14px", overflowY: "auto" },
  feedCol: { width: "100%", flexShrink: 0, background: "rgba(0,0,0,0.3)", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", maxHeight: "320px" },
  // Cam tabs
  camTabs: { display: "flex", gap: "8px" },
  camTab: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px 18px", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  camTabActive: { background: "rgba(0,229,255,0.12)", color: "#00e5ff", borderColor: "rgba(0,229,255,0.4)" },
  // IP Form
  ipForm: { background: "rgba(0,229,255,0.05)", border: "1px solid rgba(0,229,255,0.2)", borderRadius: "14px", padding: "20px", display: "flex", flexDirection: "column", gap: "12px" },
  ipFormTitle: { color: "#fff", fontWeight: 700, fontSize: "15px" },
  ipExamples: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" },
  ipLabel: { color: "rgba(255,255,255,0.4)", fontSize: "12px" },
  ipExample: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "4px 10px", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "12px", fontFamily: "inherit" },
  ipInput: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "10px 14px", color: "#fff", fontSize: "14px", fontFamily: "inherit" },
  btnConnect: { background: "#00e5ff", color: "#07101f", border: "none", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnCancel:  { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "none", borderRadius: "8px", padding: "10px 16px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  // Video
  videoBox: { position: "relative", background: "#000", borderRadius: "16px", overflow: "hidden", aspectRatio: "16/9", border: "1px solid rgba(0,229,255,0.15)", maxHeight: "480px" },
  video: { width: "100%", height: "100%", objectFit: "cover" },
  videoPlaceholder: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" },
  camIcon: { fontSize: "56px" },
  camHint: { color: "rgba(255,255,255,0.35)", fontSize: "14px" },
  camBtns: { display: "flex", gap: "10px", marginTop: "4px" },
  scanOverlay: { position: "absolute", inset: 0, background: "rgba(0,229,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center" },
  scanFrame: { position: "absolute", width: "200px", height: "200px", border: "2px solid #00e5ff", borderRadius: "12px", boxShadow: "0 0 20px rgba(0,229,255,0.3)" },
  scanLine: { position: "absolute", left: "calc(50% - 100px)", width: "200px", height: "2px", background: "linear-gradient(90deg,transparent,#00e5ff,transparent)", animation: "scanMove 1.5s ease-in-out infinite" },
  scanLabel: { position: "absolute", bottom: "20px", color: "#00e5ff", fontWeight: 600, fontSize: "14px" },
  autoBadge: { position: "absolute", top: "12px", right: "12px", background: "rgba(0,229,255,0.2)", border: "1px solid rgba(0,229,255,0.4)", borderRadius: "20px", padding: "4px 12px", color: "#00e5ff", fontSize: "12px" },
  // Controls
  controls: { display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" },
  btnPrimary:  { background: "#00e5ff", color: "#07101f", border: "none", borderRadius: "10px", padding: "12px 24px", fontWeight: 700, cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnSecondary:{ background: "rgba(255,255,255,0.07)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", padding: "12px 20px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnCapture:  { background: "#00ff88", color: "#07101f", border: "none", borderRadius: "10px", padding: "14px 28px", fontWeight: 700, cursor: "pointer", fontSize: "15px", fontFamily: "inherit", minHeight: "48px" },
  btnAuto:     { background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", padding: "12px 20px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnAutoOn:   { background: "rgba(0,229,255,0.15)", color: "#00e5ff", borderColor: "rgba(0,229,255,0.4)" },
  btnStop:     { background: "rgba(255,92,92,0.1)", color: "#ff5c5c", border: "1px solid rgba(255,92,92,0.3)", borderRadius: "10px", padding: "12px 20px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  // Result
  resultCard: { display: "flex", alignItems: "center", gap: "14px", background: "rgba(255,255,255,0.04)", border: "1px solid", borderRadius: "14px", padding: "16px 20px", animation: "slideIn .3s ease" },
  resultIcon: { fontSize: "28px", flexShrink: 0 },
  resultInfo: { flex: 1 },
  resultName: { color: "#fff", fontWeight: 700, fontSize: "18px", marginBottom: "6px" },
  resultMeta: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" },
  resultTime: { color: "rgba(255,255,255,0.35)", fontSize: "12px" },
  chip: { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", borderRadius: "20px", padding: "2px 10px", fontSize: "12px" },
  resultHint: { color: "rgba(255,255,255,0.35)", fontSize: "12px", marginTop: "4px" },
  // Feed
  feedHeader: { padding: "16px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" },
  feedTitle:  { color: "#fff", fontWeight: 700, fontSize: "15px", margin: 0 },
  feedCount:  { color: "rgba(255,255,255,0.3)", fontSize: "12px", background: "rgba(255,255,255,0.06)", borderRadius: "20px", padding: "2px 10px" },
  feedList:   { flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" },
  feedEmpty:  { color: "rgba(255,255,255,0.2)", fontSize: "13px", textAlign: "center", padding: "32px 0" },
  feedItem:   { background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "10px 12px", borderLeft: "3px solid #00e5ff", position: "relative", animation: "slideIn .2s ease" },
  feedName:   { color: "#fff", fontWeight: 600, fontSize: "14px", marginBottom: "3px" },
  feedDetail: { display: "flex", alignItems: "center", gap: "4px" },
  feedTime:   { color: "rgba(255,255,255,0.3)", fontSize: "11px", marginLeft: "auto" },
  feedConf:   { position: "absolute", top: "8px", right: "10px", color: "rgba(255,255,255,0.25)", fontSize: "11px" },
};
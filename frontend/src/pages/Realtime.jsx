import { useState, useRef, useEffect, useCallback } from "react";
import { publicApi } from "../api/axios";

const WS_URL  = (import.meta.env.VITE_WS_URL  || "ws://localhost:8000/ws") + "/attendance";
const API_BASE = import.meta.env.VITE_API_URL  || "http://localhost:8000";
const FACEAPI_CDN = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const MODELS_URL  = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights";

function getStreamUrl(url) {
  if (!url) return url;
  if (window.location.protocol === "https:" && url.startsWith("http://"))
    return `${API_BASE}/proxy/stream?url=${encodeURIComponent(url)}`;
  return url;
}

export default function Realtime() {
  const videoRef    = useRef(null);
  const imgRef      = useRef(null);
  const canvasRef   = useRef(null);   // canvas vẽ bounding box
  const captureRef  = useRef(null);   // canvas ẩn để chụp ảnh
  const wsRef       = useRef(null);
  const pingRef     = useRef(null);
  const streamRef   = useRef(null);
  const detectLoopRef = useRef(null);
  const stableRef   = useRef(null);   // timer đếm ổn định mặt
  const scanningRef  = useRef(false);
  const autoRef      = useRef(false);
  const cooldownRef  = useRef(false); // chặn chụp ngay sau khi điểm danh xong

  const [camMode, setCamMode]     = useState("webcam");
  const [ipUrl, setIpUrl]         = useState("http://192.168.1.3:4747/mjpegfeed");
  const [isIPMode, setIsIPMode]   = useState(false);
  const [stream, setStream]       = useState(false);
  const [wsStatus, setWsStatus]   = useState("disconnected");
  const [scanning, setScanning]   = useState(false);
  const [autoScan, setAutoScan]   = useState(false);
  const [result, setResult]       = useState(null);
  const [feed, setFeed]           = useState([]);
  const [showIpForm, setShowIpForm] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [faceApiReady, setFaceApiReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);  // có mặt trong khung không
  const [stableCount, setStableCount]   = useState(0);      // đếm frame ổn định

  // Đồng hồ
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load face-api.js + models
  useEffect(() => {
    const loadFaceApi = async () => {
      if (window.faceapi) { await loadModels(); return; }
      const script = document.createElement("script");
      script.src = FACEAPI_CDN;
      script.onload = async () => { await loadModels(); };
      document.head.appendChild(script);
    };
    const loadModels = async () => {
      try {
        await window.faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
        setFaceApiReady(true);
        console.log("[face-api] Models loaded");
      } catch (e) {
        console.warn("[face-api] Load failed:", e);
        setFaceApiReady(false);
      }
    };
    loadFaceApi();
  }, []);

  // WebSocket
  useEffect(() => {
    const connect = () => {
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onopen  = () => {
          setWsStatus("connected");
          pingRef.current = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
        };
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.type === "attendance") {
            setFeed(prev => {
              // Dedup theo id nếu có, fallback theo employee+action+time (truncate giây)
              const msgId = msg.id || msg.attendance_id;
              const msgKey = `${msg.employee}|${msg.action}|${(msg.time||msg.timestamp||'').slice(0,16)}`;
              const exists = prev.some(f => {
                if (msgId && (f.id || f.attendance_id)) return (f.id || f.attendance_id) === msgId;
                const fKey = `${f.employee}|${f.action}|${(f.time||f.timestamp||'').slice(0,16)}`;
                return fKey === msgKey;
              });
              if (exists) return prev;
              return [msg, ...prev].slice(0, 30);
            });
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

  // Fetch nhật ký hôm nay
  useEffect(() => {
    publicApi.get("/public/today-feed").then(r => setFeed(r.data)).catch(() => {});
  }, []);

  // Bật webcam
  const startWebcam = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setResult({ success: false, code: "CAM_ERROR", message: "❌ Trình duyệt không hỗ trợ camera." });
      return;
    }
    try {
      let s;
      try { s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } } }); }
      catch { try { s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }); }
              catch { s = await navigator.mediaDevices.getUserMedia({ video: true }); } }
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
      const msg = err.name === "NotAllowedError" ? "❌ Chưa cấp quyền camera."
                : err.name === "NotFoundError"   ? "❌ Không tìm thấy camera."
                : `❌ Không thể mở camera: ${err.message}`;
      setResult({ success: false, code: "CAM_ERROR", message: msg });
    }
  };

  const startIPCamera = () => {
    if (!ipUrl) return;
    stopCamera();
    setIsIPMode(true);
    setStream(true);
    setShowIpForm(false);
    setTimeout(() => {
      if (imgRef.current) imgRef.current.src = getStreamUrl(ipUrl) + "?t=" + Date.now();
    }, 100);
  };

  const stopCamera = () => {
    setIsIPMode(false);
    setStream(false);
    setAutoScan(false);
    setFaceDetected(false);
    autoRef.current = false;
    if (imgRef.current) imgRef.current.src = "";
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current)  { videoRef.current.src = ""; videoRef.current.srcObject = null; }
    stopDetectLoop();
  };

  // ── Detect loop — vẽ bounding box realtime ───────────────────────────────────
  const startDetectLoop = useCallback(() => {
    if (!faceApiReady || !window.faceapi) return;
    let _stable = 0;

    const loop = async () => {
      const source = isIPMode ? imgRef.current : videoRef.current;
      const canvas = canvasRef.current;
      if (!source || !canvas) { detectLoopRef.current = requestAnimationFrame(loop); return; }
      if (!isIPMode && (!videoRef.current?.videoWidth)) { detectLoopRef.current = requestAnimationFrame(loop); return; }

      const W = isIPMode ? (source.naturalWidth  || 640) : source.videoWidth;
      const H = isIPMode ? (source.naturalHeight || 480) : source.videoHeight;
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, W, H);

      try {
        const detections = await window.faceapi.detectAllFaces(
          source,
          new window.faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
        );

        if (detections.length > 0) {
          // Resize detection về kích thước canvas
          const resized = window.faceapi.resizeResults(detections, { width: W, height: H });
          resized.forEach(det => {
            const { x, y, width, height } = det.box;
            // Bounding box xanh
            ctx.strokeStyle = scanningRef.current ? "#ffd600" : "#00ff88";
            ctx.lineWidth   = 2.5;
            ctx.strokeRect(x, y, width, height);
            // Góc trang trí
            const cs = 18;
            ctx.strokeStyle = scanningRef.current ? "#ffd600" : "#00e5ff";
            ctx.lineWidth   = 3;
            [
              [x, y, cs, 0, 0, cs],
              [x + width, y, -cs, 0, 0, cs],
              [x, y + height, cs, 0, 0, -cs],
              [x + width, y + height, -cs, 0, 0, -cs],
            ].forEach(([bx, by, dx1, dy1, dx2, dy2]) => {
              ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + dx1, by + dy1); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + dx2, by + dy2); ctx.stroke();
            });
            // Label confidence
            const score = (det.score * 100).toFixed(0);
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(x, y - 22, 80, 20);
            ctx.fillStyle = "#00ff88";
            ctx.font = "bold 12px monospace";
            ctx.fillText(`Mặt ${score}%`, x + 4, y - 7);
          });
          setFaceDetected(true);
          // Đếm ổn định → tự chụp khi auto
          if (autoRef.current && !scanningRef.current && !cooldownRef.current) {
            _stable++;
            setStableCount(_stable);
            if (_stable >= 5) {   // ~1.5s với 300ms/frame
              _stable = 0;
              setStableCount(0);
              captureAndSend();
            }
          }
        } else {
          setFaceDetected(false);
          _stable = 0;
          setStableCount(0);
        }
      } catch {}

      detectLoopRef.current = setTimeout(loop, 300); // 300ms/frame — đủ mượt, không tốn CPU
    };
    loop();
  }, [faceApiReady, isIPMode]);

  const stopDetectLoop = () => {
    if (detectLoopRef.current) {
      clearTimeout(detectLoopRef.current);
      cancelAnimationFrame(detectLoopRef.current);
      detectLoopRef.current = null;
    }
    // Xóa canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setFaceDetected(false);
    setStableCount(0);
  };

  // Khởi detect loop khi stream bật và face-api sẵn sàng
  useEffect(() => {
    if (stream && faceApiReady) {
      const t = setTimeout(() => startDetectLoop(), 500); // chờ video load
      return () => { clearTimeout(t); stopDetectLoop(); };
    } else {
      stopDetectLoop();
    }
  }, [stream, faceApiReady, startDetectLoop]);

  // ── Chụp & gửi lên backend ────────────────────────────────────────────────────
  const captureAndSend = useCallback(async () => {
    if (scanningRef.current) return;
    const source = isIPMode ? imgRef.current : videoRef.current;
    if (!source) return;
    if (!isIPMode && !videoRef.current?.videoWidth) return;

    const canvas = captureRef.current;
    const MAX_SIZE = 640;
    const rawW = isIPMode ? (imgRef.current.naturalWidth  || 640) : videoRef.current.videoWidth;
    const rawH = isIPMode ? (imgRef.current.naturalHeight || 480) : videoRef.current.videoHeight;
    const scale = Math.min(1, MAX_SIZE / Math.max(rawW, rawH));
    canvas.width  = Math.round(rawW * scale);
    canvas.height = Math.round(rawH * scale);
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    const image_base64 = canvas.toDataURL("image/jpeg", 0.82);

    scanningRef.current = true;
    setScanning(true);
    try {
      const res  = await publicApi.post("/public/face-checkin", { image_base64 });
      const data = res.data;
      const event = { ...data, success: true, timestamp: new Date().toISOString(), _local: true };
      setResult(event);
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        setFeed(prev => [event, ...prev].slice(0, 30));
      }
      // Cooldown 8 giây — tránh check-in/out liên tiếp cùng người
      cooldownRef.current = true;
      setTimeout(() => { cooldownRef.current = false; }, 8000);
    } catch (err) {
      const detail = err.response?.data?.detail;
      const code   = typeof detail === "object" ? detail?.code  : "UNKNOWN";
      const msg    = typeof detail === "object" ? detail?.msg   : (detail || "Không nhận diện được");
      const conf   = typeof detail === "object" ? detail?.confidence : null;
      setResult({ success: false, code, message: msg, confidence: conf });
      // Không tắt auto khi lỗi — tiếp tục detect
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, [isIPMode]);

  useEffect(() => { autoRef.current = autoScan; }, [autoScan]);
  const toggleAuto = () => setAutoScan(a => !a);

  // Progress bar ổn định (0-100%)
  const stableProgress = Math.min(100, (stableCount / 5) * 100);

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
        <div style={{ display: "flex", gap: "8px" }}>
          <a href="/employee-login" style={S.navBtn}>👤 Đăng ký mặt</a>
          <a href="/login" style={{ ...S.navBtn, background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)" }}>🔐 Quản trị</a>
        </div>
      </div>

      <div style={S.body}>
        {/* Camera Panel */}
        <div style={S.cameraCol} className="faceattend-cam">
          {/* Tabs */}
          <div style={S.camTabs}>
            <button onClick={() => { setCamMode("webcam"); stopCamera(); }}
              style={{ ...S.camTab, ...(camMode === "webcam" ? S.camTabActive : {}) }}>📷 Webcam</button>
            <button onClick={() => { setCamMode("ip"); stopCamera(); setShowIpForm(true); }}
              style={{ ...S.camTab, ...(camMode === "ip" ? S.camTabActive : {}) }}>🌐 Camera IP</button>
          </div>

          {/* IP Form */}
          {showIpForm && camMode === "ip" && (
            <div style={S.ipForm}>
              <div style={S.ipFormTitle}>🌐 Kết nối Camera IP</div>
              <div style={S.ipExamples}>
                <span style={S.ipLabel}>Ví dụ:</span>
                {[
                  { label: "IP Webcam (Android)", url: "http://192.168.1.x:8080/video" },
                  { label: "MJPEG Stream",         url: "http://192.168.1.x/mjpg/video.mjpg" },
                ].map(ex => (
                  <button key={ex.label} onClick={() => setIpUrl(ex.url)} style={S.ipExample}>{ex.label}</button>
                ))}
              </div>
              <input style={S.ipInput} value={ipUrl} onChange={e => setIpUrl(e.target.value)} placeholder="Nhập URL camera IP..." />
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={startIPCamera} style={S.btnConnect}>▶ Kết nối</button>
                <button onClick={() => setShowIpForm(false)} style={S.btnCancel}>Hủy</button>
              </div>
            </div>
          )}

          {/* Video box — video + canvas overlay chồng lên nhau */}
          <div style={S.videoBox}>
            <video ref={videoRef} autoPlay muted playsInline crossOrigin="anonymous"
              style={{ ...S.video, display: (stream && !isIPMode) ? "block" : "none" }} />
            <img ref={imgRef} alt="IP Camera" crossOrigin="anonymous"
              style={{ ...S.video, display: (stream && isIPMode) ? "block" : "none", objectFit: "cover" }} />

            {/* Canvas bounding box — chồng lên video */}
            <canvas ref={canvasRef} style={S.overlayCanvas} />

            {/* Placeholder khi chưa bật */}
            {!stream && (
              <div style={S.videoPlaceholder}>
                <div style={S.camIcon}>📷</div>
                <p style={S.camHint}>Chọn nguồn camera để bắt đầu</p>
                <div style={S.camBtns}>
                  <button onClick={startWebcam} style={S.btnPrimary}>▶ Bật Webcam</button>
                  <button onClick={() => { setCamMode("ip"); setShowIpForm(true); }} style={S.btnSecondary}>🌐 Camera IP</button>
                </div>
              </div>
            )}

            {/* Loading face-api */}
            {stream && !faceApiReady && (
              <div style={S.loadingBadge}>⏳ Đang tải AI detect...</div>
            )}

            {/* Đang nhận diện overlay */}
            {scanning && (
              <div style={S.scanningOverlay}>
                <div style={S.scanningLabel}>⏳ Đang nhận diện...</div>
              </div>
            )}

            {/* Auto badge + progress */}
            {autoScan && stream && faceApiReady && (
              <div style={S.autoBadge}>
                <span>🔄 Tự động</span>
                {faceDetected && stableCount > 0 && (
                  <div style={S.progressBar}>
                    <div style={{ ...S.progressFill, width: `${stableProgress}%` }} />
                  </div>
                )}
              </div>
            )}

            {/* Face detected indicator */}
            {stream && faceApiReady && !scanning && (
              <div style={{ ...S.faceChip, borderColor: faceDetected ? "#00ff88" : "rgba(255,255,255,0.15)" }}>
                <span style={{ ...S.faceDot, background: faceDetected ? "#00ff88" : "rgba(255,255,255,0.2)" }} />
                <span style={{ color: faceDetected ? "#00ff88" : "rgba(255,255,255,0.3)", fontSize: "11px" }}>
                  {faceDetected ? "Phát hiện mặt" : "Không có mặt"}
                </span>
              </div>
            )}

            <canvas ref={captureRef} style={{ display: "none" }} />
          </div>

          {/* Controls */}
          {stream && (
            <div style={S.controls}>
              <button onClick={captureAndSend} disabled={scanning}
                style={{ ...S.btnCapture, ...(faceDetected ? {} : { opacity: 0.6 }) }}>
                {scanning ? "⏳ Đang quét..." : "📸 Điểm Danh"}
              </button>
              <button onClick={toggleAuto}
                style={{ ...S.btnAuto, ...(autoScan ? S.btnAutoOn : {}) }}>
                {autoScan ? "⏸ Dừng tự động" : "🔄 Tự động"}
              </button>
              <button onClick={stopCamera} style={S.btnStop}>■ Tắt camera</button>
            </div>
          )}

          {/* Gợi ý khi auto bật nhưng chưa có mặt */}
          {autoScan && stream && !faceDetected && !scanning && (
            <div style={S.hint}>💡 Đứng trước camera để tự động điểm danh</div>
          )}

          {/* Kết quả */}
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
                    <div style={S.resultTime}>{new Date(result.timestamp || result.time).toLocaleTimeString("vi-VN")}</div>
                  </div>
                </>
              ) : (
                <>
                  <div style={S.resultIcon}>
                    {result.code === "NO_FACE" ? "📷" : result.code === "POOR_LIGHT" ? "💡"
                   : result.code === "LOW_CONFIDENCE" ? "🔍" : result.code === "AMBIGUOUS" ? "👥"
                   : result.code === "ALREADY_CHECKED_OUT" ? "✅" : result.code === "NOT_REGISTERED" ? "❓" : "❌"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: result.code === "ALREADY_CHECKED_OUT" ? "#ffd600" : "#ff5c5c", fontWeight: 700, fontSize: "15px", marginBottom: "4px" }}>
                      {result.message}
                    </div>
                    {result.confidence != null && (
                      <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "12px" }}>
                        Điểm khớp: {(result.confidence * 100).toFixed(1)}%
                      </div>
                    )}
                    {result.code === "NO_FACE"        && <div style={S.resultHint}>💡 Đảm bảo khuôn mặt trong khung</div>}
                    {result.code === "POOR_LIGHT"     && <div style={S.resultHint}>💡 Tăng ánh sáng hoặc tránh ngược sáng</div>}
                    {result.code === "NOT_REGISTERED" && <div style={S.resultHint}>💡 Liên hệ quản trị viên để đăng ký</div>}
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
            {feed.length === 0 && <div style={S.feedEmpty}>Chưa có điểm danh nào hôm nay</div>}
            {feed.map((f, i) => (
              <div key={i} style={{ ...S.feedItem, borderLeftColor: f.action === "check_in" ? "#00ff88" : "#00e5ff" }}>
                <div style={S.feedName}>{f.employee || "—"}</div>
                <div style={S.feedDetail}>
                  <span style={{ color: f.action === "check_in" ? "#00ff88" : "#00e5ff", fontSize: "12px" }}>
                    {f.action === "check_in" ? "▲ Vào ca" : "▼ Tan ca"}
                  </span>
                  {f.status === "late" && <span style={{ color: "#ffd600", fontSize: "12px" }}> • ⚠ Trễ</span>}
                  <span style={S.feedTime}>{new Date(f.time || f.timestamp).toLocaleTimeString("vi-VN")}</span>
                </div>
                {f.confidence && <div style={S.feedConf}>{(f.confidence * 100).toFixed(1)}%</div>}
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
        input, select, button { font-size: 16px !important; }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideIn{ from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes spin   { to{transform:rotate(360deg)} }
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
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(0,229,255,0.1)", flexWrap: "wrap", gap: "8px" },
  brand: { display: "flex", alignItems: "center", gap: "10px" },
  brandDot: { width: "10px", height: "10px", borderRadius: "50%", background: "#00e5ff", boxShadow: "0 0 10px #00e5ff", animation: "pulse 2s infinite" },
  brandText: { color: "#fff", fontWeight: 700, fontSize: "20px" },
  brandSub: { color: "rgba(255,255,255,0.3)", fontSize: "13px" },
  clock: { textAlign: "center" },
  clockTime: { color: "#fff", fontWeight: 700, fontSize: "28px", letterSpacing: "2px", fontVariantNumeric: "tabular-nums" },
  clockDate: { color: "rgba(255,255,255,0.4)", fontSize: "13px", textTransform: "capitalize" },
  navBtn: { background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.25)", color: "#00e5ff", borderRadius: "8px", padding: "7px 14px", fontSize: "13px", fontWeight: 600, textDecoration: "none", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" },
  wsChip: { display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "6px 14px", color: "rgba(255,255,255,0.5)", fontSize: "12px" },
  wsDot: { width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0 },
  body: { display: "flex", flex: 1, gap: "0", overflow: "hidden", flexDirection: "column" },
  cameraCol: { flex: 1, padding: "16px", display: "flex", flexDirection: "column", gap: "14px", overflowY: "auto" },
  feedCol: { width: "100%", flexShrink: 0, background: "rgba(0,0,0,0.3)", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", maxHeight: "320px" },
  camTabs: { display: "flex", gap: "8px" },
  camTab: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px 18px", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  camTabActive: { background: "rgba(0,229,255,0.12)", color: "#00e5ff", borderColor: "rgba(0,229,255,0.4)" },
  ipForm: { background: "rgba(0,229,255,0.05)", border: "1px solid rgba(0,229,255,0.2)", borderRadius: "14px", padding: "20px", display: "flex", flexDirection: "column", gap: "12px" },
  ipFormTitle: { color: "#fff", fontWeight: 700, fontSize: "15px" },
  ipExamples: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" },
  ipLabel: { color: "rgba(255,255,255,0.4)", fontSize: "12px" },
  ipExample: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "4px 10px", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "12px", fontFamily: "inherit" },
  ipInput: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "10px 14px", color: "#fff", fontSize: "14px", fontFamily: "inherit" },
  btnConnect: { background: "#00e5ff", color: "#07101f", border: "none", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnCancel:  { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "none", borderRadius: "8px", padding: "10px 16px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  videoBox: { position: "relative", background: "#000", borderRadius: "16px", overflow: "hidden", aspectRatio: "16/9", border: "1px solid rgba(0,229,255,0.15)", maxHeight: "480px" },
  video: { width: "100%", height: "100%", objectFit: "cover" },
  overlayCanvas: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" },
  videoPlaceholder: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" },
  camIcon: { fontSize: "56px" },
  camHint: { color: "rgba(255,255,255,0.35)", fontSize: "14px" },
  camBtns: { display: "flex", gap: "10px", marginTop: "4px" },
  loadingBadge: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "rgba(0,0,0,0.7)", color: "#ffd600", padding: "8px 16px", borderRadius: "20px", fontSize: "13px" },
  scanningOverlay: { position: "absolute", inset: 0, background: "rgba(255,214,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" },
  scanningLabel: { background: "rgba(0,0,0,0.7)", color: "#ffd600", padding: "8px 20px", borderRadius: "20px", fontWeight: 600, fontSize: "14px" },
  autoBadge: { position: "absolute", top: "12px", right: "12px", background: "rgba(0,229,255,0.2)", border: "1px solid rgba(0,229,255,0.4)", borderRadius: "20px", padding: "6px 14px", color: "#00e5ff", fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px", minWidth: "120px" },
  progressBar: { height: "3px", background: "rgba(255,255,255,0.15)", borderRadius: "2px", overflow: "hidden" },
  progressFill: { height: "100%", background: "#00ff88", borderRadius: "2px", transition: "width 0.2s" },
  faceChip: { position: "absolute", bottom: "12px", left: "12px", display: "flex", alignItems: "center", gap: "6px", background: "rgba(0,0,0,0.6)", border: "1px solid", borderRadius: "20px", padding: "4px 10px" },
  faceDot: { width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0 },
  controls: { display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" },
  btnPrimary:  { background: "#00e5ff", color: "#07101f", border: "none", borderRadius: "10px", padding: "12px 24px", fontWeight: 700, cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnSecondary:{ background: "rgba(255,255,255,0.07)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", padding: "12px 20px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnCapture:  { background: "#00ff88", color: "#07101f", border: "none", borderRadius: "10px", padding: "14px 28px", fontWeight: 700, cursor: "pointer", fontSize: "15px", fontFamily: "inherit", minHeight: "48px" },
  btnAuto:     { background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", padding: "12px 20px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  btnAutoOn:   { background: "rgba(0,229,255,0.15)", color: "#00e5ff", borderColor: "rgba(0,229,255,0.4)" },
  btnStop:     { background: "rgba(255,92,92,0.1)", color: "#ff5c5c", border: "1px solid rgba(255,92,92,0.3)", borderRadius: "10px", padding: "12px 20px", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  hint: { textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "13px", padding: "4px 0" },
  resultCard: { display: "flex", alignItems: "center", gap: "14px", background: "rgba(255,255,255,0.04)", border: "1px solid", borderRadius: "14px", padding: "16px 20px", animation: "slideIn .3s ease" },
  resultIcon: { fontSize: "28px", flexShrink: 0 },
  resultInfo: { flex: 1 },
  resultName: { color: "#fff", fontWeight: 700, fontSize: "18px", marginBottom: "6px" },
  resultMeta: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" },
  resultTime: { color: "rgba(255,255,255,0.35)", fontSize: "12px" },
  resultHint: { color: "rgba(255,255,255,0.35)", fontSize: "12px", marginTop: "4px" },
  chip: { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", borderRadius: "20px", padding: "2px 10px", fontSize: "12px" },
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
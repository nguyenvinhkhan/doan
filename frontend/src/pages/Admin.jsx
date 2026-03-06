import { useState, useEffect } from "react";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";

export default function Admin() {
  const [tab, setTab]         = useState("attendance");
  // Accounts state
  const { user: me } = useAuth();
  const [users, setUsers]         = useState([]);
  const [usersLoading, setUL]     = useState(false);
  const [acctTab, setAcctTab]     = useState("list");
  const [newUser, setNewUser]     = useState({ username: "", email: "", password: "", role: "viewer" });
  const [creating, setCreating]   = useState(false);
  const [pwForm, setPwForm]       = useState({ current_password: "", new_password: "", confirm: "" });
  const [changingPw, setChangingPw] = useState(false);
  const [acctModal, setAcctModal] = useState(null);
  const [modalVal, setModalVal]   = useState("");
  const [acctMsg, setAcctMsg]     = useState(null);
  const [records, setRecords] = useState([]);
  const [dateFilter, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);

  // Config state
  const [configs, setConfigs]   = useState([]);
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState("");

  // Load attendance
  useEffect(() => {
    if (tab !== "attendance") return;
    setLoading(true);
    api.get(`/attendance/?date=${dateFilter}&limit=200`)
      .then(r => setRecords(r.data))
      .finally(() => setLoading(false));
  }, [tab, dateFilter]);

  // Load configs
  useEffect(() => {
    if (tab !== "config") return;
    api.get("/configs/").then(r => setConfigs(r.data));
  }, [tab]);

  const handleConfigChange = (key, value) => {
    setConfigs(prev => prev.map(c => c.key === key ? { ...c, value } : c));
  };

  const handleSaveConfig = async (key, value) => {
    setSaving(true); setSaveMsg("");
    try {
      await api.put(`/configs/${key}`, { value });
      // Reload lại toàn bộ config để đảm bảo UI đồng bộ với database
      const r = await api.get("/configs/");
      setConfigs(r.data);
      setSaveMsg(`✅ Đã lưu: ${key} = ${value}`);
      setTimeout(() => setSaveMsg(""), 4000);
    } catch (err) {
      const detail = err.response?.data?.detail || "Lỗi không xác định";
      setSaveMsg(`❌ Lưu thất bại: ${detail}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    setSaving(true); setSaveMsg("");
    try {
      await Promise.all(configs.map(c => api.put(`/configs/${c.key}`, { value: c.value })));
      // Reload để đồng bộ với database
      const r = await api.get("/configs/");
      setConfigs(r.data);
      setSaveMsg("✅ Đã lưu tất cả cấu hình!");
      setTimeout(() => setSaveMsg(""), 4000);
    } catch (err) {
      const detail = err.response?.data?.detail || "Lỗi không xác định";
      setSaveMsg(`❌ Lưu thất bại: ${detail}`);
    } finally {
      setSaving(false);
    }
  };
  // ── Account functions ──────────────────────────────────────────────────────
  const notifyAcct = (text, ok = true) => {
    setAcctMsg({ text, ok });
    setTimeout(() => setAcctMsg(null), 3500);
  };

  const loadUsers = async () => {
    setUL(true);
    try { const r = await api.get("/auth/users"); setUsers(r.data); }
    finally { setUL(false); }
  };

  useEffect(() => { if (tab === "accounts") loadUsers(); }, [tab]);

  const handleCreateUser = async () => {
    if (!newUser.username || !newUser.email || !newUser.password)
      return notifyAcct("Vui lòng điền đầy đủ!", false);
    if (newUser.password.length < 6)
      return notifyAcct("Mật khẩu phải ít nhất 6 ký tự!", false);
    setCreating(true);
    try {
      await api.post("/auth/register", newUser);
      notifyAcct("✅ Tạo tài khoản thành công!");
      setNewUser({ username: "", email: "", password: "", role: "viewer" });
      loadUsers(); setAcctTab("list");
    } catch (err) { notifyAcct("❌ " + (err.response?.data?.detail || "Thất bại!"), false); }
    finally { setCreating(false); }
  };

  const handleChangePw = async () => {
    if (!pwForm.current_password || !pwForm.new_password)
      return notifyAcct("Vui lòng điền đầy đủ!", false);
    if (pwForm.new_password !== pwForm.confirm)
      return notifyAcct("❌ Mật khẩu mới không khớp!", false);
    if (pwForm.new_password.length < 6)
      return notifyAcct("❌ Mật khẩu phải ít nhất 6 ký tự!", false);
    setChangingPw(true);
    try {
      await api.post("/auth/change-password", {
        current_password: pwForm.current_password,
        new_password: pwForm.new_password,
      });
      notifyAcct("✅ Đổi mật khẩu thành công!");
      setPwForm({ current_password: "", new_password: "", confirm: "" });
    } catch (err) { notifyAcct("❌ " + (err.response?.data?.detail || "Thất bại!"), false); }
    finally { setChangingPw(false); }
  };

  const handleDeleteRecord = async (id) => {
    if (!window.confirm("Xóa bản ghi điểm danh này?")) return;
    try {
      await api.delete(`/attendance/${id}`);
      setRecords(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      alert("❌ " + (err.response?.data?.detail || "Xóa thất bại!"));
    }
  };

  const handleAcctModal = async () => {
    if (!acctModal) return;
    try {
      if (acctModal.type === "role")   await api.put(`/auth/users/${acctModal.user.id}`, { role: modalVal });
      if (acctModal.type === "reset") {
        if (modalVal.length < 6) return notifyAcct("❌ Mật khẩu phải ít nhất 6 ký tự!", false);
        await api.post(`/auth/users/${acctModal.user.id}/reset-password`, { new_password: modalVal });
      }
      if (acctModal.type === "toggle") await api.put(`/auth/users/${acctModal.user.id}`, { is_active: !acctModal.user.is_active });
      if (acctModal.type === "delete") await api.delete(`/auth/users/${acctModal.user.id}`);
      notifyAcct("✅ Thao tác thành công!");
      setAcctModal(null); setModalVal(""); loadUsers();
    } catch (err) { notifyAcct("❌ " + (err.response?.data?.detail || "Thất bại!"), false); }
  };



  // Nhóm configs
  const timeConfigs = configs.filter(c =>
    ["late_hour", "late_minute", "work_start", "work_end"].includes(c.key)
  );
  const aiConfigs = configs.filter(c => c.key === "face_threshold");

  return (
    <div style={styles.page}>
      <h2 style={styles.heading}>Quản Trị</h2>

      {/* Tabs */}
      <div style={styles.tabs}>
        {[
          ["attendance", "📋 Lịch sử điểm danh"],
          ["config",     "⚙️ Cấu hình hệ thống"],
          ["accounts",   "👤 Tài khoản"],
          ["info",       "ℹ️ Thông tin"],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ ...styles.tab, ...(tab === key ? styles.tabActive : {}) }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Lịch sử điểm danh ── */}
      {tab === "attendance" && (
        <div>
          <div style={styles.toolBar}>
            <label style={styles.filterLabel}>Ngày:</label>
            <input type="date" value={dateFilter} onChange={e => setDate(e.target.value)}
              style={styles.dateInput} />
            <span style={styles.count}>{records.length} bản ghi</span>
          </div>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["#", "Nhân viên", "Mã NV", "Phòng ban", "Giờ vào", "Giờ ra", "Trạng thái", "Độ chính xác", ""].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} style={styles.tdCenter}>Đang tải...</td></tr>}
                {!loading && records.length === 0 && (
                  <tr><td colSpan={9} style={styles.tdCenter}>Không có dữ liệu ngày {dateFilter}</td></tr>
                )}
                {records.map((r, i) => (
                  <tr key={r.id} style={styles.tr}>
                    <td style={styles.td}>{i + 1}</td>
                    <td style={styles.td}>{r.employee?.full_name || "—"}</td>
                    <td style={styles.td}><code style={{ color: "#00e5ff" }}>{r.employee?.employee_code}</code></td>
                    <td style={styles.td}>{r.employee?.department || "—"}</td>
                    <td style={styles.td}>{r.check_in  ? new Date(r.check_in ).toLocaleTimeString("vi-VN") : "—"}</td>
                    <td style={styles.td}>{r.check_out ? new Date(r.check_out).toLocaleTimeString("vi-VN") : "—"}</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, ...badgeColor(r.status) }}>{r.status}</span>
                    </td>
                    <td style={styles.td}>{r.confidence ? (r.confidence * 100).toFixed(1) + "%" : "—"}</td>
                    <td style={styles.td}>
                      <button onClick={() => handleDeleteRecord(r.id)}
                        style={{ background:"rgba(255,92,92,0.1)", border:"1px solid rgba(255,92,92,0.3)", borderRadius:"6px", padding:"4px 10px", cursor:"pointer", color:"#ff5c5c", fontSize:"13px" }}
                        title="Xóa bản ghi">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Cấu hình ── */}
      {tab === "config" && (
        <div style={styles.configPage}>

          {/* Giờ làm việc */}
          <div style={styles.configSection}>
            <div style={styles.sectionHeader}>
              <span style={styles.sectionIcon}>⏰</span>
              <div>
                <div style={styles.sectionTitle}>Quy tắc giờ giấc</div>
                <div style={styles.sectionDesc}>Cấu hình giờ bắt đầu, kết thúc và mốc đi trễ</div>
              </div>
            </div>

            <div style={styles.configGrid}>
              {/* Giờ bắt đầu & Giờ kết thúc làm việc */}
              {["work_start", "work_end"].map(key => {
                const c = timeConfigs.find(x => x.key === key);
                return c ? <ConfigField key={c.key} config={c} onChange={handleConfigChange} onSave={handleSaveConfig} saving={saving} /> : null;
              })}
              {/* Mốc đi trễ: Giờ trễ + Phút trễ cạnh nhau */}
              {["late_hour", "late_minute"].map(key => {
                const c = timeConfigs.find(x => x.key === key);
                return c ? <ConfigField key={c.key} config={c} onChange={handleConfigChange} onSave={handleSaveConfig} saving={saving} /> : null;
              })}
            </div>

            {/* Preview giờ trễ */}
            {timeConfigs.length > 0 && (
              <div style={styles.previewBox}>
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>
                  📌 Nhân viên check-in sau{" "}
                </span>
                <span style={{ color: "#ffd600", fontWeight: 700, fontSize: "15px" }}>
                  {String(configs.find(c => c.key === "late_hour")?.value ?? "8").padStart(2, "0")}:
                  {String(configs.find(c => c.key === "late_minute")?.value ?? "30").padStart(2, "0")}
                </span>
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>
                  {" "}sẽ bị đánh dấu <span style={{ color: "#ffd600" }}>ĐI TRỄ</span>
                </span>
              </div>
            )}
          </div>

          {/* AI Settings */}
          <div style={styles.configSection}>
            <div style={styles.sectionHeader}>
              <span style={styles.sectionIcon}>🤖</span>
              <div>
                <div style={styles.sectionTitle}>Cài đặt nhận diện AI</div>
                <div style={styles.sectionDesc}>Điều chỉnh độ nhạy nhận diện khuôn mặt</div>
              </div>
            </div>

            <div style={styles.configGrid}>
              {aiConfigs.map(c => (
                <ConfigField
                  key={c.key}
                  config={c}
                  onChange={handleConfigChange}
                  onSave={handleSaveConfig}
                  saving={saving}
                />
              ))}
            </div>

            <div style={styles.previewBox}>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>
                📌 Ngưỡng càng cao → nhận diện càng chặt. Khuyên dùng:{" "}
              </span>
              <span style={{ color: "#00e5ff", fontWeight: 700 }}>0.70 – 0.80</span>
            </div>
          </div>

          {/* Nút lưu tất cả */}
          <div style={styles.saveAllRow}>
            {saveMsg && (
              <span style={{ color: saveMsg.startsWith("✅") ? "#00ff88" : "#ff5c5c", fontSize: "14px" }}>
                {saveMsg}
              </span>
            )}
            <button onClick={handleSaveAll} disabled={saving} style={styles.btnSaveAll}>
              {saving ? "⏳ Đang lưu..." : "💾 Lưu tất cả cấu hình"}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Thông tin ── */}

      {/* ── Tab: Tài khoản ── */}
      {tab === "accounts" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Thông báo */}
          {acctMsg && (
            <div style={{ border: "1px solid", borderRadius: "10px", padding: "12px 16px", fontSize: "14px", fontWeight: 600,
              borderColor: acctMsg.ok ? "#00ff88" : "#ff5c5c",
              background: acctMsg.ok ? "rgba(0,255,136,0.08)" : "rgba(255,92,92,0.08)",
              color: acctMsg.ok ? "#00ff88" : "#ff5c5c" }}>
              {acctMsg.text}
            </div>
          )}
          {/* Sub tabs */}
          <div style={{ display: "flex", gap: "8px" }}>
            {[["list","👥 Danh sách"],["create","➕ Tạo mới"],["password","🔑 Đổi mật khẩu"]].map(([k,lb]) => (
              <button key={k} onClick={() => setAcctTab(k)} style={{
                background: acctTab===k ? "rgba(0,229,255,0.12)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${acctTab===k ? "rgba(0,229,255,0.4)" : "rgba(255,255,255,0.1)"}`,
                color: acctTab===k ? "#00e5ff" : "rgba(255,255,255,0.5)",
                borderRadius: "8px", padding: "7px 16px", cursor: "pointer", fontSize: "13px", fontFamily: "inherit"
              }}>{lb}</button>
            ))}
          </div>

          {/* Danh sách */}
          {acctTab === "list" && (
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["#","Tên đăng nhập","Email","Quyền","Trạng thái","Thao tác"].map(h => (
                    <th key={h} style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px", textTransform: "uppercase", padding: "12px 16px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {usersLoading && <tr><td colSpan={6} style={{ textAlign:"center", color:"rgba(255,255,255,0.3)", padding:"24px" }}>Đang tải...</td></tr>}
                  {users.map((u, i) => (
                    <tr key={u.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "11px 16px", color: "rgba(255,255,255,0.6)", fontSize: "13px" }}>{i+1}</td>
                      <td style={{ padding: "11px 16px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                          <div style={{ width:"28px", height:"28px", borderRadius:"50%", background: u.role==="admin"?"#00e5ff":"rgba(255,255,255,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:"12px", color:"#0a0e1a", flexShrink:0 }}>
                            {u.username[0].toUpperCase()}
                          </div>
                          <span style={{ color:"#fff", fontWeight:600, fontSize:"13px" }}>{u.username}</span>
                          {u.id === me?.id && <span style={{ background:"rgba(0,255,136,0.15)", color:"#00ff88", borderRadius:"20px", padding:"1px 8px", fontSize:"11px" }}>Bạn</span>}
                        </div>
                      </td>
                      <td style={{ padding:"11px 16px", color:"rgba(255,255,255,0.6)", fontSize:"13px" }}>{u.email}</td>
                      <td style={{ padding:"11px 16px" }}>
                        <span style={{ borderRadius:"20px", padding:"3px 10px", fontSize:"12px", fontWeight:600,
                          background: u.role==="admin"?"rgba(0,229,255,0.15)":"rgba(255,255,255,0.08)",
                          color: u.role==="admin"?"#00e5ff":"rgba(255,255,255,0.5)" }}>
                          {u.role==="admin"?"Admin":"Viewer"}
                        </span>
                      </td>
                      <td style={{ padding:"11px 16px" }}>
                        <span style={{ color: u.is_active?"#00ff88":"#ff5c5c", fontWeight:600, fontSize:"13px" }}>
                          {u.is_active?"● Hoạt động":"● Đã khóa"}
                        </span>
                      </td>
                      <td style={{ padding:"11px 16px" }}>
                        <div style={{ display:"flex", gap:"4px" }}>
                          <button title="Đổi quyền" onClick={() => { setAcctModal({type:"role",user:u}); setModalVal(u.role); }}
                            style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"6px", padding:"5px 7px", cursor:"pointer", fontSize:"13px" }}>🔐</button>
                          <button title="Reset mật khẩu" onClick={() => { setAcctModal({type:"reset",user:u}); setModalVal(""); }}
                            style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"6px", padding:"5px 7px", cursor:"pointer", fontSize:"13px" }}>🔄</button>
                          {u.id !== me?.id && (
                            <button title={u.is_active?"Khóa":"Mở"} onClick={() => setAcctModal({type:"toggle",user:u})}
                              style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"6px", padding:"5px 7px", cursor:"pointer", fontSize:"13px", color: u.is_active?"#ffd600":"#00ff88" }}>
                              {u.is_active?"🔒":"🔓"}
                            </button>
                          )}
                          {u.id !== me?.id && (
                            <button title="Xóa" onClick={() => setAcctModal({type:"delete",user:u})}
                              style={{ background:"rgba(255,92,92,0.08)", border:"1px solid rgba(255,92,92,0.2)", borderRadius:"6px", padding:"5px 7px", cursor:"pointer", fontSize:"13px", color:"#ff5c5c" }}>🗑</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tạo tài khoản */}
          {acctTab === "create" && (
            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"14px", padding:"24px", maxWidth:"480px" }}>
              <div style={{ color:"#fff", fontWeight:700, fontSize:"15px", marginBottom:"16px" }}>➕ Tạo tài khoản mới</div>
              {[["Tên đăng nhập *","username","text","vd: nhanvien01"],["Email *","email","email","vd: email@example.com"],["Mật khẩu *","password","password","Ít nhất 6 ký tự"]].map(([lb,key,type,ph]) => (
                <div key={key} style={{ marginBottom:"12px" }}>
                  <label style={{ color:"rgba(255,255,255,0.45)", fontSize:"12px", fontWeight:600, display:"block", marginBottom:"5px" }}>{lb}</label>
                  <input type={type} value={newUser[key]} placeholder={ph} onChange={e => setNewUser(p => ({...p,[key]:e.target.value}))}
                    style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", padding:"9px 12px", color:"#fff", fontSize:"13px", fontFamily:"inherit", boxSizing:"border-box" }} />
                </div>
              ))}
              <label style={{ color:"rgba(255,255,255,0.45)", fontSize:"12px", fontWeight:600, display:"block", marginBottom:"8px" }}>Quyền hạn</label>
              <div style={{ display:"flex", gap:"8px", marginBottom:"16px" }}>
                {["admin","viewer"].map(r => (
                  <button key={r} onClick={() => setNewUser(p => ({...p,role:r}))}
                    style={{ flex:1, background: newUser.role===r?"rgba(0,229,255,0.12)":"rgba(255,255,255,0.05)", border:`1px solid ${newUser.role===r?"rgba(0,229,255,0.4)":"rgba(255,255,255,0.1)"}`, color: newUser.role===r?"#00e5ff":"rgba(255,255,255,0.5)", borderRadius:"8px", padding:"9px", cursor:"pointer", fontFamily:"inherit", fontSize:"13px" }}>
                    {r==="admin"?"🔐 Admin — Toàn quyền":"👁 Viewer — Chỉ xem"}
                  </button>
                ))}
              </div>
              <button onClick={handleCreateUser} disabled={creating}
                style={{ background:"linear-gradient(135deg,#00e5ff,#0066ff)", color:"#fff", border:"none", borderRadius:"8px", padding:"10px 24px", fontWeight:700, cursor:"pointer", fontSize:"14px", fontFamily:"inherit", opacity: creating?0.5:1 }}>
                {creating?"⏳ Đang tạo...":"✅ Tạo tài khoản"}
              </button>
            </div>
          )}

          {/* Đổi mật khẩu */}
          {acctTab === "password" && (
            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"14px", padding:"24px", maxWidth:"400px" }}>
              <div style={{ color:"#fff", fontWeight:700, fontSize:"15px", marginBottom:"16px" }}>🔑 Đổi mật khẩu của bạn</div>
              {[["Mật khẩu hiện tại *","current_password"],["Mật khẩu mới *","new_password"],["Xác nhận mật khẩu mới *","confirm"]].map(([lb,key]) => (
                <div key={key} style={{ marginBottom:"12px" }}>
                  <label style={{ color:"rgba(255,255,255,0.45)", fontSize:"12px", fontWeight:600, display:"block", marginBottom:"5px" }}>{lb}</label>
                  <input type="password" value={pwForm[key]} onChange={e => setPwForm(p => ({...p,[key]:e.target.value}))}
                    placeholder="••••••" style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", padding:"9px 12px", color:"#fff", fontSize:"13px", fontFamily:"inherit", boxSizing:"border-box" }} />
                </div>
              ))}
              {pwForm.confirm && pwForm.new_password !== pwForm.confirm && <div style={{ color:"#ff5c5c", fontSize:"12px", marginBottom:"10px" }}>❌ Mật khẩu không khớp</div>}
              {pwForm.confirm && pwForm.new_password === pwForm.confirm && pwForm.confirm.length >= 6 && <div style={{ color:"#00ff88", fontSize:"12px", marginBottom:"10px" }}>✅ Mật khẩu khớp</div>}
              <button onClick={handleChangePw} disabled={changingPw}
                style={{ background:"linear-gradient(135deg,#00e5ff,#0066ff)", color:"#fff", border:"none", borderRadius:"8px", padding:"10px 24px", fontWeight:700, cursor:"pointer", fontSize:"14px", fontFamily:"inherit", opacity: changingPw?0.5:1 }}>
                {changingPw?"⏳ Đang đổi...":"🔑 Đổi mật khẩu"}
              </button>
            </div>
          )}

          {/* Modal */}
          {acctModal && (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}
              onClick={() => setAcctModal(null)}>
              <div style={{ background:"#0d1622", border:"1px solid rgba(0,229,255,0.2)", borderRadius:"16px", padding:"28px", minWidth:"320px", display:"flex", flexDirection:"column", gap:"14px" }}
                onClick={e => e.stopPropagation()}>
                <div style={{ color:"#fff", fontWeight:700, fontSize:"15px" }}>
                  {acctModal.type==="role"   && `🔐 Đổi quyền — ${acctModal.user.username}`}
                  {acctModal.type==="reset"  && `🔄 Reset mật khẩu — ${acctModal.user.username}`}
                  {acctModal.type==="toggle" && (acctModal.user.is_active ? `🔒 Khóa "${acctModal.user.username}"?` : `🔓 Mở "${acctModal.user.username}"?`)}
                  {acctModal.type==="delete" && `🗑 Xóa tài khoản "${acctModal.user.username}"?`}
                </div>
                {acctModal.type==="role" && (
                  <div style={{ display:"flex", gap:"8px" }}>
                    {["admin","viewer"].map(r => (
                      <button key={r} onClick={() => setModalVal(r)}
                        style={{ flex:1, background: modalVal===r?"rgba(0,229,255,0.12)":"rgba(255,255,255,0.05)", border:`1px solid ${modalVal===r?"rgba(0,229,255,0.4)":"rgba(255,255,255,0.1)"}`, color: modalVal===r?"#00e5ff":"rgba(255,255,255,0.5)", borderRadius:"8px", padding:"8px", cursor:"pointer", fontFamily:"inherit", fontSize:"13px" }}>
                        {r==="admin"?"🔐 Admin":"👁 Viewer"}
                      </button>
                    ))}
                  </div>
                )}
                {acctModal.type==="reset" && (
                  <input type="password" value={modalVal} onChange={e => setModalVal(e.target.value)}
                    placeholder="Mật khẩu mới (ít nhất 6 ký tự)"
                    style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", padding:"9px 12px", color:"#fff", fontSize:"13px", fontFamily:"inherit" }} />
                )}
                <div style={{ display:"flex", gap:"8px", justifyContent:"flex-end" }}>
                  <button onClick={() => { setAcctModal(null); setModalVal(""); }}
                    style={{ background:"rgba(255,255,255,0.07)", color:"rgba(255,255,255,0.6)", border:"none", borderRadius:"8px", padding:"8px 18px", cursor:"pointer", fontFamily:"inherit" }}>Hủy</button>
                  <button onClick={handleAcctModal}
                    style={{ background: acctModal.type==="delete"?"rgba(255,92,92,0.15)":"rgba(0,229,255,0.15)", color: acctModal.type==="delete"?"#ff5c5c":"#00e5ff", border:`1px solid ${acctModal.type==="delete"?"rgba(255,92,92,0.3)":"rgba(0,229,255,0.3)"}`, borderRadius:"8px", padding:"8px 18px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>
                    Xác nhận
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {tab === "info" && (
        <div style={styles.infoGrid}>
          {[
            { label: "Backend",   value: "FastAPI (Python 3.11+)", color: "#00e5ff" },
            { label: "Database",  value: "PostgreSQL",             color: "#00ff88" },
            { label: "AI Engine", value: "OpenCV + LBP Histogram", color: "#ffd600" },
            { label: "Frontend",  value: "React 18 + Vite",        color: "#00e5ff" },
            { label: "Realtime",  value: "WebSocket (FastAPI)",     color: "#00ff88" },
            { label: "Auth",      value: "JWT (python-jose)",       color: "#ffd600" },
          ].map(item => (
            <div key={item.label} style={styles.infoCard}>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px", marginBottom: "6px" }}>{item.label}</div>
              <div style={{ color: item.color, fontWeight: 700, fontSize: "15px" }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
        input[type=date]:focus, input[type=number]:focus, input[type=time]:focus, input[type=text]:focus { outline:none; border-color:#00e5ff !important; }
        button:disabled { opacity:0.5; cursor:not-allowed; }
      `}</style>
    </div>
  );
}

// ── Component field cấu hình ──────────────────────────────────────────────────
function ConfigField({ config, onChange, onSave, saving }) {
  const isNumber = ["late_hour", "late_minute"].includes(config.key);
  const isFloat  = config.key === "face_threshold";
  const isTime   = ["work_start", "work_end"].includes(config.key);

  return (
    <div style={fieldStyles.wrap}>
      <label style={fieldStyles.label}>{config.label}</label>
      <div style={fieldStyles.row}>
        <input
          type={isTime ? "time" : isNumber || isFloat ? "number" : "text"}
          value={config.value}
          step={isFloat ? "0.05" : isNumber ? "1" : undefined}
          min={isFloat ? "0.1" : isNumber ? "0" : undefined}
          max={isFloat ? "1.0" : config.key === "late_hour" ? "23" : config.key === "late_minute" ? "59" : undefined}
          onChange={e => onChange(config.key, e.target.value)}
          style={fieldStyles.input}
        />
        <button
          onClick={() => onSave(config.key, config.value)}
          disabled={saving}
          style={fieldStyles.btn}
        >
          Lưu
        </button>
      </div>
    </div>
  );
}

function badgeColor(status) {
  if (status === "present") return { background: "rgba(0,255,136,0.15)", color: "#00ff88" };
  if (status === "late")    return { background: "rgba(255,214,0,0.15)",  color: "#ffd600" };
  return { background: "rgba(255,92,92,0.15)", color: "#ff5c5c" };
}

const fieldStyles = {
  wrap:  { display: "flex", flexDirection: "column", gap: "8px" },
  label: { color: "rgba(255,255,255,0.5)", fontSize: "13px", fontWeight: 600 },
  row:   { display: "flex", gap: "8px" },
  input: { flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "10px 12px", color: "#fff", fontSize: "14px", fontFamily: "inherit" },
  btn:   { background: "rgba(0,229,255,0.15)", color: "#00e5ff", border: "1px solid rgba(0,229,255,0.3)", borderRadius: "8px", padding: "10px 16px", cursor: "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "inherit" },
};

const styles = {
  page:    { padding: "32px", flex: 1, overflowY: "auto", fontFamily: "'Space Grotesk', sans-serif" },
  heading: { color: "#fff", fontSize: "26px", fontWeight: 700, margin: "0 0 20px" },
  tabs:    { display: "flex", gap: "8px", marginBottom: "24px" },
  tab:     { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "9px 18px", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  tabActive: { background: "rgba(0,229,255,0.12)", color: "#00e5ff", borderColor: "rgba(0,229,255,0.4)" },
  toolBar:   { display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" },
  filterLabel: { color: "rgba(255,255,255,0.5)", fontSize: "14px" },
  dateInput: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px 12px", color: "#fff", fontSize: "14px", fontFamily: "inherit" },
  count:     { marginLeft: "auto", color: "rgba(255,255,255,0.3)", fontSize: "13px" },
  tableWrap: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", overflow: "auto" },
  table:     { width: "100%", borderCollapse: "collapse" },
  th:        { color: "rgba(255,255,255,0.4)", fontSize: "11px", textTransform: "uppercase", padding: "10px 14px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.07)" },
  tr:        { borderBottom: "1px solid rgba(255,255,255,0.04)" },
  td:        { color: "rgba(255,255,255,0.8)", fontSize: "13px", padding: "10px 14px" },
  tdCenter:  { color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "24px" },
  badge:     { padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600 },
  // Config styles
  configPage:    { display: "flex", flexDirection: "column", gap: "20px" },
  configSection: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "24px" },
  sectionHeader: { display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "20px" },
  sectionIcon:   { fontSize: "24px", marginTop: "2px" },
  sectionTitle:  { color: "#fff", fontWeight: 700, fontSize: "16px" },
  sectionDesc:   { color: "rgba(255,255,255,0.4)", fontSize: "13px", marginTop: "3px" },
  configGrid:    { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" },
  previewBox:    { marginTop: "16px", background: "rgba(255,214,0,0.06)", border: "1px solid rgba(255,214,0,0.2)", borderRadius: "10px", padding: "12px 16px" },
  saveAllRow:    { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "16px" },
  btnSaveAll:    { background: "linear-gradient(135deg,#00e5ff,#0066ff)", color: "#fff", border: "none", borderRadius: "10px", padding: "12px 28px", fontWeight: 700, cursor: "pointer", fontSize: "15px", fontFamily: "inherit" },
  // Info
  infoGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" },
  infoCard: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "18px" },
};
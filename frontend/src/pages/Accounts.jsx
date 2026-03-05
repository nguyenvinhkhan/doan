import { useState, useEffect } from "react";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";

const ROLES = ["admin", "viewer"];
const ROLE_LABELS = { admin: "Admin", viewer: "Viewer" };
const ROLE_COLORS = { admin: { bg: "rgba(0,229,255,0.15)", color: "#00e5ff" }, viewer: { bg: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" } };

export default function Accounts() {
  const { user: me } = useAuth();
  const [tab, setTab] = useState("list");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  // Form tạo tài khoản
  const [newUser, setNewUser] = useState({ username: "", email: "", password: "", role: "viewer" });
  const [creating, setCreating] = useState(false);

  // Đổi mật khẩu
  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [changingPw, setChangingPw] = useState(false);

  // Modal reset/role
  const [modal, setModal] = useState(null); // { type: "role"|"reset"|"delete", user }
  const [modalVal, setModalVal] = useState("");

  const notify = (text, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3500);
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const r = await api.get("/auth/users");
      setUsers(r.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  // ── Tạo tài khoản ──────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newUser.username || !newUser.email || !newUser.password)
      return notify("Vui lòng điền đầy đủ thông tin!", false);
    if (newUser.password.length < 6)
      return notify("Mật khẩu phải có ít nhất 6 ký tự!", false);
    setCreating(true);
    try {
      await api.post("/auth/register", newUser);
      notify("✅ Tạo tài khoản thành công!");
      setNewUser({ username: "", email: "", password: "", role: "viewer" });
      loadUsers();
      setTab("list");
    } catch (err) {
      notify("❌ " + (err.response?.data?.detail || "Tạo thất bại!"), false);
    } finally {
      setCreating(false);
    }
  };

  // ── Đổi mật khẩu ───────────────────────────────────────────────────────────
  const handleChangePw = async () => {
    if (!pwForm.current_password || !pwForm.new_password)
      return notify("Vui lòng điền đầy đủ!", false);
    if (pwForm.new_password !== pwForm.confirm)
      return notify("❌ Mật khẩu mới không khớp!", false);
    if (pwForm.new_password.length < 6)
      return notify("❌ Mật khẩu mới phải ít nhất 6 ký tự!", false);
    setChangingPw(true);
    try {
      await api.post("/auth/change-password", {
        current_password: pwForm.current_password,
        new_password: pwForm.new_password,
      });
      notify("✅ Đổi mật khẩu thành công!");
      setPwForm({ current_password: "", new_password: "", confirm: "" });
    } catch (err) {
      notify("❌ " + (err.response?.data?.detail || "Đổi thất bại!"), false);
    } finally {
      setChangingPw(false);
    }
  };

  // ── Modal actions ───────────────────────────────────────────────────────────
  const handleModalConfirm = async () => {
    if (!modal) return;
    try {
      if (modal.type === "role") {
        await api.put(`/auth/users/${modal.user.id}`, { role: modalVal });
        notify(`✅ Đã đổi quyền ${modal.user.username} → ${modalVal}`);
      } else if (modal.type === "reset") {
        if (modalVal.length < 6) return notify("❌ Mật khẩu phải ít nhất 6 ký tự!", false);
        await api.post(`/auth/users/${modal.user.id}/reset-password`, { new_password: modalVal });
        notify(`✅ Đã reset mật khẩu cho ${modal.user.username}`);
      } else if (modal.type === "toggle") {
        await api.put(`/auth/users/${modal.user.id}`, { is_active: !modal.user.is_active });
        notify(`✅ ${modal.user.is_active ? "Đã khóa" : "Đã mở"} tài khoản ${modal.user.username}`);
      } else if (modal.type === "delete") {
        await api.delete(`/auth/users/${modal.user.id}`);
        notify(`✅ Đã xóa tài khoản ${modal.user.username}`);
      }
      setModal(null);
      setModalVal("");
      loadUsers();
    } catch (err) {
      notify("❌ " + (err.response?.data?.detail || "Thao tác thất bại!"), false);
    }
  };

  return (
    <div style={S.page}>
      <h2 style={S.heading}>Quản Lý Tài Khoản</h2>

      {/* Thông báo */}
      {msg && (
        <div style={{ ...S.toast, background: msg.ok ? "rgba(0,255,136,0.12)" : "rgba(255,92,92,0.12)", borderColor: msg.ok ? "#00ff88" : "#ff5c5c", color: msg.ok ? "#00ff88" : "#ff5c5c" }}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div style={S.tabs}>
        {[["list","👥 Danh sách tài khoản"], ["create","➕ Tạo tài khoản"], ["password","🔑 Đổi mật khẩu"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Danh sách ── */}
      {tab === "list" && (
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                {["#","Tên đăng nhập","Email","Quyền","Trạng thái","Thao tác"].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={S.tdCenter}>Đang tải...</td></tr>}
              {users.map((u, i) => (
                <tr key={u.id} style={S.tr}>
                  <td style={S.td}>{i + 1}</td>
                  <td style={S.td}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ ...S.avatar, background: u.role === "admin" ? "#00e5ff" : "rgba(255,255,255,0.15)" }}>
                        {u.username[0].toUpperCase()}
                      </div>
                      <span style={{ color: "#fff", fontWeight: 600 }}>{u.username}</span>
                      {u.id === me?.id && <span style={S.meChip}>Bạn</span>}
                    </div>
                  </td>
                  <td style={S.td}>{u.email}</td>
                  <td style={S.td}>
                    <span style={{ ...S.roleBadge, ...ROLE_COLORS[u.role] }}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td style={S.td}>
                    <span style={{ color: u.is_active ? "#00ff88" : "#ff5c5c", fontWeight: 600, fontSize: "13px" }}>
                      {u.is_active ? "● Hoạt động" : "● Đã khóa"}
                    </span>
                  </td>
                  <td style={S.td}>
                    <div style={S.actionRow}>
                      {/* Đổi quyền */}
                      <button style={S.btnAction} onClick={() => { setModal({ type: "role", user: u }); setModalVal(u.role); }}
                        title="Đổi quyền">🔐</button>
                      {/* Reset mật khẩu */}
                      <button style={S.btnAction} onClick={() => { setModal({ type: "reset", user: u }); setModalVal(""); }}
                        title="Reset mật khẩu">🔄</button>
                      {/* Khóa/Mở */}
                      {u.id !== me?.id && (
                        <button style={{ ...S.btnAction, color: u.is_active ? "#ffd600" : "#00ff88" }}
                          onClick={() => setModal({ type: "toggle", user: u })}
                          title={u.is_active ? "Khóa tài khoản" : "Mở tài khoản"}>
                          {u.is_active ? "🔒" : "🔓"}
                        </button>
                      )}
                      {/* Xóa */}
                      {u.id !== me?.id && (
                        <button style={{ ...S.btnAction, color: "#ff5c5c" }}
                          onClick={() => setModal({ type: "delete", user: u })}
                          title="Xóa tài khoản">🗑</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Tab: Tạo tài khoản ── */}
      {tab === "create" && (
        <div style={S.formBox}>
          <div style={S.formTitle}>➕ Tạo tài khoản mới</div>
          <div style={S.formGrid}>
            <Field label="Tên đăng nhập *" value={newUser.username}
              onChange={v => setNewUser(p => ({ ...p, username: v }))}
              placeholder="vd: nhanvien01" />
            <Field label="Email *" type="email" value={newUser.email}
              onChange={v => setNewUser(p => ({ ...p, email: v }))}
              placeholder="vd: email@example.com" />
            <Field label="Mật khẩu *" type="password" value={newUser.password}
              onChange={v => setNewUser(p => ({ ...p, password: v }))}
              placeholder="Ít nhất 6 ký tự" />
            <div>
              <label style={S.label}>Quyền hạn</label>
              <div style={S.roleRow}>
                {ROLES.map(r => (
                  <button key={r} onClick={() => setNewUser(p => ({ ...p, role: r }))}
                    style={{ ...S.roleBtn, ...(newUser.role === r ? S.roleBtnActive : {}) }}>
                    {r === "admin" ? "🔐 Admin" : "👁 Viewer"}
                    <span style={{ fontSize: "11px", display: "block", opacity: 0.6 }}>
                      {r === "admin" ? "Toàn quyền" : "Chỉ xem"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button onClick={handleCreate} disabled={creating} style={S.btnSubmit}>
            {creating ? "⏳ Đang tạo..." : "✅ Tạo tài khoản"}
          </button>
        </div>
      )}

      {/* ── Tab: Đổi mật khẩu ── */}
      {tab === "password" && (
        <div style={S.formBox}>
          <div style={S.formTitle}>🔑 Đổi mật khẩu của bạn</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", maxWidth: "400px" }}>
            <Field label="Mật khẩu hiện tại *" type="password"
              value={pwForm.current_password}
              onChange={v => setPwForm(p => ({ ...p, current_password: v }))}
              placeholder="Nhập mật khẩu hiện tại" />
            <Field label="Mật khẩu mới *" type="password"
              value={pwForm.new_password}
              onChange={v => setPwForm(p => ({ ...p, new_password: v }))}
              placeholder="Ít nhất 6 ký tự" />
            <Field label="Xác nhận mật khẩu mới *" type="password"
              value={pwForm.confirm}
              onChange={v => setPwForm(p => ({ ...p, confirm: v }))}
              placeholder="Nhập lại mật khẩu mới" />
            {pwForm.confirm && pwForm.new_password !== pwForm.confirm && (
              <div style={{ color: "#ff5c5c", fontSize: "13px" }}>❌ Mật khẩu không khớp</div>
            )}
            {pwForm.confirm && pwForm.new_password === pwForm.confirm && pwForm.confirm.length >= 6 && (
              <div style={{ color: "#00ff88", fontSize: "13px" }}>✅ Mật khẩu khớp</div>
            )}
          </div>
          <button onClick={handleChangePw} disabled={changingPw} style={{ ...S.btnSubmit, marginTop: "20px" }}>
            {changingPw ? "⏳ Đang đổi..." : "🔑 Đổi mật khẩu"}
          </button>
        </div>
      )}

      {/* ── Modal ── */}
      {modal && (
        <div style={S.modalOverlay} onClick={() => setModal(null)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            {modal.type === "role" && (
              <>
                <div style={S.modalTitle}>🔐 Đổi quyền — {modal.user.username}</div>
                <div style={S.roleRow}>
                  {ROLES.map(r => (
                    <button key={r} onClick={() => setModalVal(r)}
                      style={{ ...S.roleBtn, ...(modalVal === r ? S.roleBtnActive : {}) }}>
                      {r === "admin" ? "🔐 Admin" : "👁 Viewer"}
                    </button>
                  ))}
                </div>
              </>
            )}
            {modal.type === "reset" && (
              <>
                <div style={S.modalTitle}>🔄 Reset mật khẩu — {modal.user.username}</div>
                <Field label="Mật khẩu mới" type="password" value={modalVal}
                  onChange={setModalVal} placeholder="Ít nhất 6 ký tự" />
              </>
            )}
            {modal.type === "toggle" && (
              <div style={S.modalTitle}>
                {modal.user.is_active
                  ? `🔒 Khóa tài khoản "${modal.user.username}"?`
                  : `🔓 Mở tài khoản "${modal.user.username}"?`}
              </div>
            )}
            {modal.type === "delete" && (
              <div style={S.modalTitle}>🗑 Xóa tài khoản "{modal.user.username}"?</div>
            )}
            <div style={S.modalBtns}>
              <button onClick={() => { setModal(null); setModalVal(""); }} style={S.btnCancel}>Hủy</button>
              <button onClick={handleModalConfirm}
                style={{ ...S.btnConfirm, background: modal.type === "delete" ? "rgba(255,92,92,0.2)" : undefined, borderColor: modal.type === "delete" ? "#ff5c5c" : undefined, color: modal.type === "delete" ? "#ff5c5c" : undefined }}>
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
        input:focus { outline:none; border-color:#00e5ff !important; }
        button:disabled { opacity:0.5; cursor:not-allowed; }
      `}</style>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <div>
      <label style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "6px" }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "10px 14px", color: "#fff", fontSize: "14px", fontFamily: "inherit", boxSizing: "border-box" }} />
    </div>
  );
}

const S = {
  page:    { padding: "32px", flex: 1, overflowY: "auto", fontFamily: "'Space Grotesk', sans-serif" },
  heading: { color: "#fff", fontSize: "26px", fontWeight: 700, margin: "0 0 16px" },
  toast:   { border: "1px solid", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px", fontSize: "14px", fontWeight: 600 },
  tabs:    { display: "flex", gap: "8px", marginBottom: "20px" },
  tab:     { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "9px 18px", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  tabActive: { background: "rgba(0,229,255,0.12)", color: "#00e5ff", borderColor: "rgba(0,229,255,0.4)" },
  // Table
  tableWrap: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", overflow: "auto" },
  table:   { width: "100%", borderCollapse: "collapse" },
  th:      { color: "rgba(255,255,255,0.4)", fontSize: "11px", textTransform: "uppercase", padding: "12px 16px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.07)" },
  tr:      { borderBottom: "1px solid rgba(255,255,255,0.04)" },
  td:      { color: "rgba(255,255,255,0.8)", fontSize: "13px", padding: "12px 16px" },
  tdCenter:{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: "24px" },
  avatar:  { width: "30px", height: "30px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px", color: "#0a0e1a", flexShrink: 0 },
  meChip:  { background: "rgba(0,255,136,0.15)", color: "#00ff88", borderRadius: "20px", padding: "1px 8px", fontSize: "11px", fontWeight: 600 },
  roleBadge: { borderRadius: "20px", padding: "3px 10px", fontSize: "12px", fontWeight: 600 },
  actionRow: { display: "flex", gap: "4px" },
  btnAction: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "5px 8px", cursor: "pointer", fontSize: "14px", color: "rgba(255,255,255,0.7)" },
  // Form
  formBox:   { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "28px", maxWidth: "600px" },
  formTitle: { color: "#fff", fontWeight: 700, fontSize: "16px", marginBottom: "20px" },
  formGrid:  { display: "flex", flexDirection: "column", gap: "14px" },
  label:     { color: "rgba(255,255,255,0.5)", fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "6px" },
  roleRow:   { display: "flex", gap: "10px", marginTop: "4px" },
  roleBtn:   { flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontFamily: "inherit", textAlign: "center", fontSize: "14px" },
  roleBtnActive: { background: "rgba(0,229,255,0.12)", borderColor: "rgba(0,229,255,0.4)", color: "#00e5ff" },
  btnSubmit: { marginTop: "20px", background: "linear-gradient(135deg,#00e5ff,#0066ff)", color: "#fff", border: "none", borderRadius: "10px", padding: "12px 28px", fontWeight: 700, cursor: "pointer", fontSize: "15px", fontFamily: "inherit" },
  // Modal
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modalBox:  { background: "#0d1622", border: "1px solid rgba(0,229,255,0.2)", borderRadius: "16px", padding: "28px", minWidth: "340px", display: "flex", flexDirection: "column", gap: "16px" },
  modalTitle:{ color: "#fff", fontWeight: 700, fontSize: "16px" },
  modalBtns: { display: "flex", gap: "10px", justifyContent: "flex-end" },
  btnCancel: { background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)", border: "none", borderRadius: "8px", padding: "9px 20px", cursor: "pointer", fontFamily: "inherit" },
  btnConfirm:{ background: "rgba(0,229,255,0.15)", color: "#00e5ff", border: "1px solid rgba(0,229,255,0.3)", borderRadius: "8px", padding: "9px 20px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 },
};
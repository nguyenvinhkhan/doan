import { useState, useEffect } from "react";
import api from "../api/axios";

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch]       = useState("");
  const [dept, setDept]           = useState("");
  const [depts, setDepts]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null); // null | "create" | employee object
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  const load = async () => {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (dept)   params.department = dept;
    const [empRes, deptRes] = await Promise.all([
      api.get("/employees/", { params }),
      api.get("/employees/meta/departments"),
    ]);
    setEmployees(empRes.data);
    setDepts(deptRes.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [search, dept]);

  const openCreate = () => { setForm({}); setError(""); setModal("create"); };
  const openEdit   = (emp) => { setForm({ ...emp }); setError(""); setModal(emp); };
  const closeModal = () => { setModal(null); setForm({}); };

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      if (modal === "create") {
        await api.post("/employees/", form);
      } else {
        await api.put(`/employees/${modal.id}`, form);
      }
      closeModal(); load();
    } catch (err) {
      setError(err.response?.data?.detail || "Lỗi lưu dữ liệu");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Xóa nhân viên này?")) return;
    await api.delete(`/employees/${id}`);
    load();
  };

  const handleToggle = async (emp) => {
    await api.put(`/employees/${emp.id}`, { is_active: !emp.is_active });
    load();
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.heading}>Quản Lý Nhân Viên</h2>
          {!loading && (
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>
              Hiển thị {employees.length} nhân viên
              {employees.length === 100 && (
                <span style={{ color: "#ffd600", marginLeft: "6px" }}>
                  (tối đa 100 — hãy dùng bộ lọc để tìm kiếm chính xác hơn)
                </span>
              )}
            </span>
          )}
        </div>
        <button onClick={openCreate} style={styles.btnAdd}>+ Thêm nhân viên</button>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <input
          style={styles.input} placeholder="🔍  Tìm tên, mã, email..."
          value={search} onChange={e => setSearch(e.target.value)}
        />
        <select style={styles.select} value={dept} onChange={e => setDept(e.target.value)}>
          <option value="">Tất cả phòng ban</option>
          {depts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {["Mã NV", "Họ tên", "Phòng ban", "Chức vụ", "Email", "Trạng thái", "Hành động"].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={styles.tdCenter}>Đang tải...</td></tr>}
            {!loading && employees.length === 0 && (
              <tr><td colSpan={7} style={styles.tdCenter}>Không có dữ liệu</td></tr>
            )}
            {employees.map(emp => (
              <tr key={emp.id} style={styles.tr}>
                <td style={styles.td}><code style={{ color: "#00e5ff" }}>{emp.employee_code}</code></td>
                <td style={styles.td}>
                  <div style={styles.nameCell}>
                    <div style={{ ...styles.avatar, background: emp.is_active ? "#00e5ff22" : "#ffffff10" }}>
                      {emp.full_name[0]}
                    </div>
                    {emp.full_name}
                  </div>
                </td>
                <td style={styles.td}>{emp.department || "—"}</td>
                <td style={styles.td}>{emp.position   || "—"}</td>
                <td style={styles.td}>{emp.email      || "—"}</td>
                <td style={styles.td}>
                  <span style={{ ...styles.badge, ...(emp.is_active ? styles.badgeOn : styles.badgeOff) }}>
                    {emp.is_active ? "Hoạt động" : "Vô hiệu"}
                  </span>
                </td>
                <td style={styles.td}>
                  <div style={styles.actions}>
                    <button onClick={() => openEdit(emp)} style={styles.btnEdit}>Sửa</button>
                    <button onClick={() => handleToggle(emp)} style={styles.btnToggle}>
                      {emp.is_active ? "Khóa" : "Mở"}
                    </button>
                    <button onClick={() => handleDelete(emp.id)} style={styles.btnDel}>Xóa</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal && (
        <div style={styles.overlay} onClick={closeModal}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>
              {modal === "create" ? "Thêm nhân viên mới" : "Chỉnh sửa nhân viên"}
            </h3>
            <div style={styles.modalForm}>
              {modal === "create" && (
                <Field label="Mã nhân viên *" value={form.employee_code || ""}
                  onChange={v => setForm(f => ({ ...f, employee_code: v }))} />
              )}
              <Field label="Họ và tên *" value={form.full_name || ""}
                onChange={v => setForm(f => ({ ...f, full_name: v }))} />
              <Field label="Email" value={form.email || ""}
                onChange={v => setForm(f => ({ ...f, email: v }))} type="email" />
              <Field label="Phòng ban" value={form.department || ""}
                onChange={v => setForm(f => ({ ...f, department: v }))} />
              <Field label="Chức vụ" value={form.position || ""}
                onChange={v => setForm(f => ({ ...f, position: v }))} />
              <Field label="Số điện thoại" value={form.phone || ""}
                onChange={v => setForm(f => ({ ...f, phone: v }))} />
            </div>
            {error && <div style={styles.error}>{error}</div>}
            <div style={styles.modalActions}>
              <button onClick={closeModal} style={styles.btnCancel}>Hủy</button>
              <button onClick={handleSave} disabled={saving} style={styles.btnSave}>
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
        input:focus, select:focus { outline:none; border-color:#00e5ff !important; }
      `}</style>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px", fontWeight: 600 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "10px 12px", color: "#fff", fontSize: "14px", fontFamily: "inherit" }} />
    </div>
  );
}

const styles = {
  page: { padding: "32px", flex: 1, overflowY: "auto", fontFamily: "'Space Grotesk', sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" },
  heading: { color: "#fff", fontSize: "26px", fontWeight: 700, margin: 0 },
  btnAdd: { background: "#00e5ff", color: "#0a0e1a", border: "none", borderRadius: "10px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: "14px", fontFamily: "inherit" },
  filters: { display: "flex", gap: "12px", marginBottom: "20px" },
  input: { flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 16px", color: "#fff", fontSize: "14px", fontFamily: "inherit" },
  select: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 16px", color: "#fff", fontSize: "14px", fontFamily: "inherit" },
  tableWrap: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { color: "rgba(255,255,255,0.4)", fontSize: "12px", textTransform: "uppercase", padding: "12px 16px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.07)" },
  tr: { borderBottom: "1px solid rgba(255,255,255,0.05)", transition: "background .15s" },
  td: { color: "rgba(255,255,255,0.8)", fontSize: "14px", padding: "12px 16px" },
  tdCenter: { color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "24px" },
  nameCell: { display: "flex", alignItems: "center", gap: "10px" },
  avatar: { width: "30px", height: "30px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#00e5ff", fontWeight: 700, fontSize: "13px", flexShrink: 0 },
  badge: { padding: "3px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: 600 },
  badgeOn: { background: "rgba(0,255,136,0.15)", color: "#00ff88" },
  badgeOff: { background: "rgba(255,255,255,0.08)", color: "#888" },
  actions: { display: "flex", gap: "6px" },
  btnEdit:   { background: "rgba(0,229,255,0.12)", color: "#00e5ff",  border: "none", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", fontSize: "12px", fontFamily: "inherit" },
  btnToggle: { background: "rgba(255,214,0,0.12)", color: "#ffd600",  border: "none", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", fontSize: "12px", fontFamily: "inherit" },
  btnDel:    { background: "rgba(255,92,92,0.12)",  color: "#ff5c5c", border: "none", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", fontSize: "12px", fontFamily: "inherit" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#0d1b2a", border: "1px solid rgba(0,229,255,0.2)", borderRadius: "16px", padding: "28px", width: "460px", maxWidth: "90vw" },
  modalTitle: { color: "#fff", fontWeight: 700, fontSize: "18px", margin: "0 0 20px" },
  modalForm: { display: "flex", flexDirection: "column", gap: "14px", marginBottom: "16px" },
  error: { background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", borderRadius: "8px", padding: "10px 14px", color: "#ff6b6b", fontSize: "13px", marginBottom: "12px" },
  modalActions: { display: "flex", gap: "10px", justifyContent: "flex-end" },
  btnCancel: { background: "rgba(255,255,255,0.08)", color: "#fff", border: "none", borderRadius: "8px", padding: "10px 20px", cursor: "pointer", fontFamily: "inherit" },
  btnSave:   { background: "#00e5ff", color: "#0a0e1a", border: "none", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
};

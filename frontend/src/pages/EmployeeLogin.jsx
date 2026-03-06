import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function EmployeeLogin() {
  const [form, setForm]   = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async () => {
    setError(""); setLoading(true);
    try {
      const res = await axios.post(`${API}/api/auth/login`,
        new URLSearchParams({ username: form.username, password: form.password }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      const { access_token, user } = res.data;

      if (user.role !== "employee") {
        setError("❌ Trang này chỉ dành cho nhân viên. Admin vui lòng dùng trang đăng nhập khác.");
        return;
      }

      // Lưu token nhân viên riêng
      localStorage.setItem("employee_token", access_token);
      localStorage.setItem("employee_user", JSON.stringify(user));
      navigate("/register-face");
    } catch (err) {
      setError(err.response?.data?.detail || "Đăng nhập thất bại. Kiểm tra lại tên đăng nhập và mật khẩu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        {/* Logo */}
        <div style={S.logo}>👤</div>
        <h2 style={S.title}>Cổng nhân viên</h2>
        <p style={S.sub}>Đăng nhập để đăng ký khuôn mặt</p>

        {/* Form */}
        <div style={S.field}>
          <label style={S.label}>Tên đăng nhập</label>
          <input
            style={S.input}
            placeholder="Nhập mã nhân viên (vd: NV001)"
            value={form.username}
            onChange={e => setForm(p => ({ ...p, username: e.target.value.toLowerCase() }))}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            autoFocus
          />
        </div>

        <div style={S.field}>
          <label style={S.label}>Mật khẩu</label>
          <input
            type="password"
            style={S.input}
            placeholder="Mật khẩu mặc định: 123456"
            value={form.password}
            onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
          />
        </div>

        {error && <div style={S.error}>{error}</div>}

        <button style={S.btn} onClick={handleLogin} disabled={loading}>
          {loading ? "⏳ Đang đăng nhập..." : "🚀 Đăng nhập"}
        </button>

        <div style={S.hint}>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "13px" }}>
            Tên đăng nhập = Mã nhân viên (chữ thường) &nbsp;•&nbsp; Mật khẩu mặc định: 123456
          </span>
        </div>

        <div style={S.divider} />
        <a href="/login" style={S.link}>← Trang đăng nhập quản trị</a>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        input:focus { outline: none; border-color: #00e5ff !important; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

const S = {
  page: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "linear-gradient(135deg, #0a0e1a 0%, #0d1628 50%, #0a1020 100%)",
    fontFamily: "'Space Grotesk', sans-serif", padding: "20px",
  },
  card: {
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,229,255,0.15)",
    borderRadius: "20px", padding: "40px", width: "100%", maxWidth: "420px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    display: "flex", flexDirection: "column", alignItems: "center", gap: "16px",
  },
  logo: { fontSize: "48px", marginBottom: "4px" },
  title: { color: "#fff", fontSize: "24px", fontWeight: 700, margin: 0 },
  sub: { color: "rgba(255,255,255,0.4)", fontSize: "14px", margin: 0, textAlign: "center" },
  field: { width: "100%", display: "flex", flexDirection: "column", gap: "6px" },
  label: { color: "rgba(255,255,255,0.5)", fontSize: "12px", fontWeight: 600 },
  input: {
    width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "10px", padding: "12px 14px", color: "#fff", fontSize: "14px",
    fontFamily: "inherit", transition: "border-color 0.2s",
  },
  error: {
    width: "100%", background: "rgba(255,92,92,0.1)", border: "1px solid rgba(255,92,92,0.3)",
    borderRadius: "10px", padding: "10px 14px", color: "#ff5c5c", fontSize: "13px",
  },
  btn: {
    width: "100%", background: "linear-gradient(135deg, #00e5ff, #0066ff)",
    color: "#fff", border: "none", borderRadius: "10px", padding: "13px",
    fontWeight: 700, fontSize: "15px", cursor: "pointer", fontFamily: "inherit",
    marginTop: "4px",
  },
  hint: { width: "100%", textAlign: "center" },
  divider: { width: "100%", borderTop: "1px solid rgba(255,255,255,0.07)", margin: "4px 0" },
  link: { color: "rgba(255,255,255,0.3)", fontSize: "13px", textDecoration: "none" },
};
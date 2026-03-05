import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login }    = useAuth();
  const navigate     = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await login(form.username, form.password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.bg}>
      <div style={styles.card}>
        {/* Logo / Brand */}
        <div style={styles.brand}>
          <div style={styles.logoIcon}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="10" r="5" fill="#00e5ff"/>
              <path d="M8 26c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="#00e5ff" strokeWidth="2.5" strokeLinecap="round"/>
              <circle cx="16" cy="16" r="14" stroke="#00e5ff" strokeWidth="1.5" opacity="0.3"/>
            </svg>
          </div>
          <h1 style={styles.title}>FaceAttend</h1>
          <p style={styles.subtitle}>Hệ thống điểm danh thông minh</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Tên đăng nhập</label>
            <input
              style={styles.input}
              placeholder="admin"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              required
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Mật khẩu</label>
            <input
              style={styles.input}
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
        input:focus { outline: none; border-color: #00e5ff !important; box-shadow: 0 0 0 3px rgba(0,229,255,0.15); }
        button:hover:not(:disabled) { background: #00c8e0 !important; transform: translateY(-1px); }
        button:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

const styles = {
  bg: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0a0e1a 0%, #0d1b2a 50%, #0a1628 100%)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "'Space Grotesk', sans-serif",
  },
  card: {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(0,229,255,0.15)",
    borderRadius: "20px",
    padding: "48px 40px",
    width: "100%", maxWidth: "420px",
    boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
  },
  brand: { textAlign: "center", marginBottom: "36px" },
  logoIcon: {
    width: "64px", height: "64px", borderRadius: "16px",
    background: "rgba(0,229,255,0.1)",
    border: "1px solid rgba(0,229,255,0.3)",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    marginBottom: "16px",
  },
  title: { color: "#fff", fontSize: "24px", fontWeight: 700, margin: "0 0 6px" },
  subtitle: { color: "rgba(255,255,255,0.4)", fontSize: "14px", margin: 0 },
  form: { display: "flex", flexDirection: "column", gap: "20px" },
  field: { display: "flex", flexDirection: "column", gap: "8px" },
  label: { color: "rgba(255,255,255,0.6)", fontSize: "13px", fontWeight: 600 },
  input: {
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "10px", padding: "12px 16px",
    color: "#fff", fontSize: "15px", transition: "all .2s",
  },
  error: {
    background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)",
    borderRadius: "8px", padding: "10px 14px",
    color: "#ff6b6b", fontSize: "13px",
  },
  btn: {
    background: "#00e5ff", color: "#0a0e1a", fontWeight: 700,
    fontSize: "15px", border: "none", borderRadius: "10px",
    padding: "14px", cursor: "pointer", transition: "all .2s", marginTop: "4px",
    fontFamily: "inherit",
  },
};

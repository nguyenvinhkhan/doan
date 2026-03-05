import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const links = [
  { to: "/dashboard",     label: "Dashboard",    icon: "📊" },
  { to: "/employees",     label: "Nhân Viên",    icon: "👥" },
  { to: "/register-face", label: "Đăng Ký Mặt", icon: "🪪" },
  { to: "/admin",         label: "Quản Trị",     icon: "⚙️" },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate("/login"); };

  return (
    <nav style={styles.nav}>
      <div style={styles.brand}>
        <span style={styles.dot} />
        <span style={styles.brandText}>FaceAttend</span>
      </div>

      {/* Link tới trang điểm danh công khai */}
      <a href="/checkin" target="_blank" rel="noreferrer" style={styles.publicLink}>
        📷 Mở trang điểm danh ↗
      </a>

      <div style={styles.links}>
        {links.map(l => (
          <NavLink key={l.to} to={l.to} style={({ isActive }) => ({
            ...styles.link,
            ...(isActive ? styles.linkActive : {}),
          })}>
            <span style={{ fontSize: "16px" }}>{l.icon}</span>
            <span>{l.label}</span>
          </NavLink>
        ))}
      </div>

      <div style={styles.userArea}>
        <div style={styles.avatar}>{user?.username?.[0]?.toUpperCase()}</div>
        <div>
          <div style={styles.username}>{user?.username}</div>
          <div style={styles.role}>{user?.role}</div>
        </div>
        <button onClick={handleLogout} style={styles.logoutBtn} title="Đăng xuất">⎋</button>
      </div>

      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');`}</style>
    </nav>
  );
}

const styles = {
  nav: { width: "220px", minHeight: "100vh", flexShrink: 0, background: "#0a0e1a", borderRight: "1px solid rgba(0,229,255,0.1)", display: "flex", flexDirection: "column", padding: "24px 16px", gap: "8px", fontFamily: "'Space Grotesk', sans-serif" },
  brand: { display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: "8px" },
  dot: { width: "10px", height: "10px", borderRadius: "50%", background: "#00e5ff", boxShadow: "0 0 8px #00e5ff" },
  brandText: { color: "#fff", fontWeight: 700, fontSize: "17px" },
  publicLink: { display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", borderRadius: "8px", background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.2)", color: "#00ff88", fontSize: "12px", fontWeight: 600, textDecoration: "none", marginBottom: "8px" },
  links: { display: "flex", flexDirection: "column", gap: "4px", flex: 1 },
  link: { display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", color: "rgba(255,255,255,0.5)", textDecoration: "none", fontSize: "14px", fontWeight: 500, transition: "all .15s" },
  linkActive: { background: "rgba(0,229,255,0.12)", color: "#00e5ff", fontWeight: 600 },
  userArea: { display: "flex", alignItems: "center", gap: "10px", padding: "12px", borderRadius: "12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" },
  avatar: { width: "34px", height: "34px", borderRadius: "50%", background: "#00e5ff", color: "#0a0e1a", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "14px", flexShrink: 0 },
  username: { color: "#fff", fontSize: "13px", fontWeight: 600 },
  role: { color: "rgba(255,255,255,0.4)", fontSize: "11px", textTransform: "uppercase" },
  logoutBtn: { marginLeft: "auto", background: "none", border: "none", color: "rgba(255,80,80,0.6)", cursor: "pointer", fontSize: "18px", padding: "2px 4px" },
};
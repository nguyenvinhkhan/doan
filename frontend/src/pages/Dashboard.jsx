import { useState, useEffect } from "react";
import api from "../api/axios";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

export default function Dashboard() {
  const [summary, setSummary]   = useState(null);
  const [daily, setDaily]       = useState([]);
  const [recent, setRecent]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportMonth, setExportMonth] = useState(new Date().getMonth() + 1);
  const [exportYear, setExportYear]   = useState(new Date().getFullYear());

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get(`/export/attendance?month=${exportMonth}&year=${exportYear}`, {
        responseType: "blob",
      });
      const url  = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href  = url;
      link.download = `diem_danh_${exportYear}_${String(exportMonth).padStart(2,"0")}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Xuất file thất bại!");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    Promise.all([
      api.get("/attendance/stats/summary"),
      api.get("/attendance/stats/daily?days=14"),
      api.get("/attendance/?limit=10"),
    ]).then(([s, d, r]) => {
      setSummary(s.data);
      setDaily(d.data);
      setRecent(r.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  const cards = [
    { label: "Tổng nhân viên",  value: summary?.total_employees, color: "#00e5ff", icon: "👥" },
    { label: "Có mặt hôm nay",  value: summary?.today_count,     color: "#00ff88", icon: "✅" },
    { label: "Đi trễ tháng này", value: summary?.late,           color: "#ffd600", icon: "⏰" },
    { label: "Vắng tháng này",   value: summary?.absent,         color: "#ff5c5c", icon: "❌" },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.topRow}>
        <div>
          <h2 style={styles.heading}>Dashboard</h2>
          <p style={styles.sub}>Tháng {summary?.month}/{summary?.year} • Giờ vào trễ sau {summary?.late_threshold || "08:30"}</p>
        </div>
        {/* Xuất Excel */}
        <div style={styles.exportBox}>
          <select style={styles.exportSelect}
            value={exportMonth} onChange={e => setExportMonth(Number(e.target.value))}>
            {Array.from({length:12},(_,i)=>i+1).map(m => (
              <option key={m} value={m}>Tháng {m}</option>
            ))}
          </select>
          <select style={styles.exportSelect}
            value={exportYear} onChange={e => setExportYear(Number(e.target.value))}>
            {[2024,2025,2026,2027].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button onClick={handleExport} disabled={exporting} style={styles.btnExport}>
            {exporting ? "⏳ Đang xuất..." : "📥 Xuất Excel"}
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={styles.cards}>
        {cards.map(c => (
          <div key={c.label} style={{ ...styles.card, borderColor: c.color + "33" }}>
            <div style={{ ...styles.cardIcon, background: c.color + "18" }}>{c.icon}</div>
            <div>
              <div style={{ ...styles.cardValue, color: c.color }}>{c.value ?? "—"}</div>
              <div style={styles.cardLabel}>{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={styles.charts}>
        <div style={styles.chartBox}>
          <h3 style={styles.chartTitle}>Điểm danh 14 ngày qua</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={daily}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00e5ff" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#00e5ff" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: "#888", fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fill: "#888", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="count" stroke="#00e5ff" fill="url(#grad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div style={styles.chartBox}>
          <h3 style={styles.chartTitle}>Trạng thái tháng này</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={[
              { name: "Có mặt", value: summary?.present, fill: "#00ff88" },
              { name: "Đi trễ", value: summary?.late,    fill: "#ffd600" },
              { name: "Vắng",   value: summary?.absent,  fill: "#ff5c5c" },
            ]}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fill: "#888", fontSize: 12 }} />
              <YAxis tick={{ fill: "#888", fontSize: 11 }} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[6,6,0,0]}>
                {[
                  { fill: "#00ff88" }, { fill: "#ffd600" }, { fill: "#ff5c5c" }
                ].map((entry, i) => (
                  <rect key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent attendance table */}
      <div style={styles.tableBox}>
        <h3 style={styles.chartTitle}>Điểm danh gần đây</h3>
        <table style={styles.table}>
          <thead>
            <tr>
              {["Nhân viên", "Ngày", "Vào", "Ra", "Trạng thái", "Độ chính xác"].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(r => (
              <tr key={r.id} style={styles.tr}>
                <td style={styles.td}>{r.employee?.full_name || r.employee_id}</td>
                <td style={styles.td}>{r.date}</td>
                <td style={styles.td}>{r.check_in ? new Date(r.check_in).toLocaleTimeString("vi-VN") : "—"}</td>
                <td style={styles.td}>{r.check_out ? new Date(r.check_out).toLocaleTimeString("vi-VN") : "—"}</td>
                <td style={styles.td}>
                  <span style={{ ...styles.badge, ...badgeColor(r.status) }}>{r.status}</span>
                </td>
                <td style={styles.td}>{r.confidence ? (r.confidence * 100).toFixed(1) + "%" : "—"}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr><td colSpan={6} style={{ ...styles.td, textAlign: "center", color: "#555" }}>Chưa có dữ liệu</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function badgeColor(status) {
  if (status === "present") return { background: "rgba(0,255,136,0.15)", color: "#00ff88" };
  if (status === "late")    return { background: "rgba(255,214,0,0.15)",  color: "#ffd600" };
  return { background: "rgba(255,92,92,0.15)", color: "#ff5c5c" };
}

function Loader() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", flex:1, color:"#00e5ff" }}>
      Đang tải...
    </div>
  );
}

const tooltipStyle = {
  background: "#0d1b2a", border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: "8px", color: "#fff", fontSize: "13px",
};

const styles = {
  page: { padding: "32px", flex: 1, overflowY: "auto", fontFamily: "'Space Grotesk', sans-serif" },
  topRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "28px", flexWrap: "wrap", gap: "16px" },
  heading: { color: "#fff", fontSize: "26px", fontWeight: 700, margin: "0 0 4px" },
  sub: { color: "rgba(255,255,255,0.35)", fontSize: "14px" },
  exportBox: { display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "10px 14px" },
  exportSelect: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "7px 10px", color: "#fff", fontSize: "13px", fontFamily: "inherit", cursor: "pointer" },
  btnExport: { background: "linear-gradient(135deg,#00e5ff,#0066ff)", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 18px", fontWeight: 700, cursor: "pointer", fontSize: "13px", fontFamily: "inherit", whiteSpace: "nowrap" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "28px" },
  card: {
    background: "rgba(255,255,255,0.04)", border: "1px solid",
    borderRadius: "14px", padding: "20px",
    display: "flex", alignItems: "center", gap: "16px",
  },
  cardIcon: { fontSize: "24px", width: "48px", height: "48px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" },
  cardValue: { fontSize: "30px", fontWeight: 700, lineHeight: 1 },
  cardLabel: { color: "rgba(255,255,255,0.45)", fontSize: "13px", marginTop: "4px" },
  charts: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "28px" },
  chartBox: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "20px" },
  chartTitle: { color: "#fff", fontWeight: 600, fontSize: "15px", margin: "0 0 16px" },
  tableBox: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "20px", overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { color: "rgba(255,255,255,0.4)", fontSize: "12px", textTransform: "uppercase", padding: "8px 12px", textAlign: "left", fontWeight: 600 },
  tr: { borderTop: "1px solid rgba(255,255,255,0.05)" },
  td: { color: "rgba(255,255,255,0.8)", fontSize: "14px", padding: "10px 12px" },
  badge: { padding: "3px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: 600 },
};
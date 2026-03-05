import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Navbar from "./components/Navbar";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Realtime from "./pages/Realtime";
import Employees from "./pages/Employees";
import RegisterFace from "./pages/RegisterFace";
import Admin from "./pages/Admin";

function Layout({ children }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0d1622" }}>
      <Navbar />
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {children}
      </main>
    </div>
  );
}

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          {/* Trang công khai - không cần đăng nhập */}
          <Route path="/checkin" element={<Realtime />} />
          <Route path="/login"   element={<Login />} />
          <Route path="/"        element={<Navigate to="/checkin" replace />} />

          {/* Trang quản trị - cần đăng nhập */}
          <Route path="/dashboard"     element={<PrivateRoute><Layout><Dashboard /></Layout></PrivateRoute>} />
          <Route path="/employees"     element={<PrivateRoute><Layout><Employees /></Layout></PrivateRoute>} />
          <Route path="/register-face" element={<PrivateRoute><Layout><RegisterFace /></Layout></PrivateRoute>} />
          <Route path="/admin"         element={<PrivateRoute><Layout><Admin /></Layout></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
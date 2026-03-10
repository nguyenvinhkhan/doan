import axios from "axios";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Instance dùng cho các route cần đăng nhập admin/viewer (/api/...)
const api = axios.create({
  baseURL: BASE + "/api",
  timeout: 60000, // 60s — đủ cho register-face xử lý nhiều ảnh
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("access_token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// Instance dùng cho nhân viên (/api/...) — lưu token riêng, redirect về /employee-login
export const employeeApi = axios.create({
  baseURL: BASE + "/api",
  timeout: 60000, // 60s — đủ cho register-face xử lý nhiều ảnh
});

employeeApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("employee_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

employeeApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("employee_token");
      localStorage.removeItem("employee_user");
      window.location.href = "/employee-login";
    }
    return Promise.reject(err);
  }
);

// Instance dùng cho các route công khai (/public/...)
export const publicApi = axios.create({
  baseURL: BASE,
  timeout: 20000, // 20s cho face-checkin
});

export default api;
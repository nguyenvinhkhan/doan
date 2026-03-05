import axios from "axios";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Instance dùng cho các route cần đăng nhập (/api/...)
const api = axios.create({
  baseURL: BASE + "/api",
  timeout: 15000,
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

// Instance dùng cho các route công khai (/public/...)
export const publicApi = axios.create({
  baseURL: BASE,
  timeout: 15000,
});

export default api;
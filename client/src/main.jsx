import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/theme.css";
import "./styles/arcade.css"; // ธีม Neo-Arcade (ชั้นทับ: สี ฟอนต์ มุมโค้ง) — ลบบรรทัดนี้ = กลับธีมพิกเซลเดิม
import "./styles/waitingroom.css"; // หน้าห้องรอแบบสองฝั่ง (ต้องอยู่หลัง theme/arcade เพื่อชนะ selector ระดับเดียวกัน)
import "./prefs"; // ตั้ง data-motion ที่ <html> ก่อน React วาดหน้าแรก

// BrowserRouter ผูกหน้าจอเข้ากับ URL (/ · /setup · /room/12345 · /leaderboard · /solo)
// ปุ่มย้อนกลับ/ไปข้างหน้าของเบราว์เซอร์จึงใช้ได้ และรีเฟรชแล้วยังอยู่หน้าเดิม
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

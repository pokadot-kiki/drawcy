import { useEffect, useState } from "react";
import { Icon } from "./Icons";
import { difficultyLabel } from "../roomOptions";

const REFRESH_MS = 5000; // ขอรายการใหม่ทุก 5 วิ (ห้องเกิด/หายไม่บ่อย ไม่ต้องสดระดับวินาที จึงใช้ HTTP ธรรมดา ไม่ใช่ socket)

// รายการห้อง Public ที่หน้าแรก — ดึงจาก GET /api/rooms กดแถวไหนเข้าห้องนั้นได้เลย
// ห้อง Private ไม่อยู่ในรายการนี้ (server ไม่ส่งมา) เข้าได้ด้วยรหัสห้องเท่านั้น
// การเข้าห้องจริงยังผ่าน join_room เหมือนเดิม server ตรวจห้องเต็ม/ชื่อซ้ำเองทั้งหมด
export default function OpenRooms({ disabled, onJoin }) {
  const [rooms, setRooms] = useState(null); // null = ยังโหลดไม่เสร็จ

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/rooms")
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((data) => alive && setRooms(Array.isArray(data?.rooms) ? data.rooms : []))
        .catch(() => alive && setRooms((old) => old ?? [])); // ต่อไม่ได้: คงรายการเดิมไว้ ไม่ทำให้หน้าแรกพัง
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="panel open-rooms" aria-labelledby="open-rooms-title">
      <h2 className="panel__title open-rooms__title" id="open-rooms-title">
        <Icon name="door" size={24} /> ห้อง Public ที่เปิดอยู่
      </h2>
      {rooms === null ? (
        <p className="open-rooms__empty">กำลังโหลด...</p>
      ) : rooms.length === 0 ? (
        <p className="open-rooms__empty">ยังไม่มีห้อง Public ตอนนี้ — สร้างห้องแล้วเลือกประเภท Public ได้เลย</p>
      ) : (
        <ul className="open-rooms__list">
          {rooms.map((r) => (
            <li key={r.code}>
              <button type="button" className="open-room" disabled={disabled} onClick={() => onJoin(r.code)}>
                {/* ชื่อหัวห้องเป็นข้อความธรรมดาผ่าน {} ของ React เสมอ (ไม่ตีความเป็น HTML) */}
                <span className="open-room__host">ห้องของ {r.host}</span>
                <span className="open-room__meta">
                  {r.mode === "team" ? "โหมดทีม" : "แข่งเดี่ยว"} · คำระดับ{difficultyLabel(r.difficulty)} ·{" "}
                  {r.status === "playing" ? "กำลังเล่น" : "รอผู้เล่น"}
                </span>
                <span className="open-room__count">
                  {r.players}/{r.maxPlayers}
                </span>
                <span className="open-room__go">เข้า</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

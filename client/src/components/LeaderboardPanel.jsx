import { useState } from "react";
import RankTable from "./RankTable";
import { thaiMonthName, useLeaderboard } from "../hooks/useLeaderboard";
import { Icon } from "./Icons";

// เนื้อในของ Leaderboard — ใช้ร่วมกันทั้งการ์ดในหน้าแรกและหน้า /leaderboard เต็ม (ไม่เขียนซ้ำ)
// ประกอบด้วย: หัว (ชื่อ + ชื่อเดือนนี้) · แท็บ เล่นกับเพื่อน/แข่งกับ AI · ตารางอันดับ
// แสดงเฉพาะเดือนนี้ (เวลาไทย) — ไม่มีตลอดกาล/ย้อนหลัง · ชื่อเดือนมาจาก server ขึ้นเดือนใหม่ตารางเริ่มว่างเอง
// หน้าแรกส่ง scroll เพื่อให้ตารางเลื่อนภายในการ์ด (ไม่ดันการ์ดสูงจนล้น)

// สองกระดานแยกกัน (server เก็บแยกด้วยช่อง board) — แท็บแค่เปลี่ยนว่าขอกระดานไหนจาก API
const BOARDS = [
  { id: "multi", label: "เล่นกับเพื่อน", icon: "star", note: "คะแนนรวมตอนจบเกมในห้อง" },
  { id: "solo", label: "แข่งกับ AI", icon: "robot", note: "คะแนนจากโหมด Solo แข่งกับ AI" },
];

export default function LeaderboardPanel({ limit = 20, scroll = false, meName = "" }) {
  const [tab, setTab] = useState("multi");
  // เปิดหน้าหรือเปลี่ยนแท็บ = ขอ API ใหม่ทุกครั้ง (ไม่เก็บคะแนนไว้ในเครื่อง)
  const board = useLeaderboard(tab);
  const info = BOARDS.find((b) => b.id === tab);
  const monthName = thaiMonthName(board.month);
  const periodText = monthName ? `เดือน${monthName}` : "เดือนนี้";

  const table = (
    <RankTable
      board={board}
      limit={limit}
      meName={meName}
      showLevel={tab === "solo"} // กระดานเล่นกับเพื่อนไม่มี "ด่าน"
      emptyIcon={info.icon}
      emptyHint={tab === "solo" ? undefined : "ชวนเพื่อนมาเล่นให้จบหนึ่งเกม แล้วคะแนนจะขึ้นกระดานนี้เอง!"}
      emptyText={`ยังไม่มีใครติดอันดับ${periodText}`}
    />
  );

  return (
    <>
      <div className="board-panel__head">
        <h2 className="panel__title board-panel__title">
          <Icon name="trophy" size={28} /> Leaderboard
        </h2>
        {/* ชื่อเดือนอย่างเดียว ไม่มีปี ไม่มีตัวเลือก (ยังไม่โหลดก็ไม่โชว์) */}
        {monthName && <span className="board-panel__month">{monthName}</span>}
      </div>

      <div className="board-tabs" role="tablist" aria-label="กระดานคะแนน">
        {BOARDS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={tab === b.id}
            className={tab === b.id ? "board-tab board-tab--active" : "board-tab"}
            onClick={() => setTab(b.id)}
          >
            <Icon name={b.icon} size={20} /> {b.label}
          </button>
        ))}
      </div>

      <p className="hint-text">
        {info.note} · {periodText} · {limit} อันดับแรก
      </p>

      {/* หน้าแรก: ตารางเลื่อนภายในกรอบ (scroll) · หน้าเต็ม: ให้หน้าเลื่อนตามปกติ */}
      {scroll ? <div className="board-panel__scroll">{table}</div> : table}
    </>
  );
}

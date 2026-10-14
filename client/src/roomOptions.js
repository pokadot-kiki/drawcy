// ตัวเลือกของห้องที่ใช้ร่วมกันหลายหน้า (SET UP · ห้องรอ · รายการห้อง Public · Solo)
// ค่าต้องตรงกับที่ server รับ (events.md §1) — server ตรวจซ้ำเสมอ ค่าที่ไม่อนุญาตถูกเมิน

// ความยาก = "ชุดคำ" ที่ server สุ่มให้ (ไม่เกี่ยวกับเวลา)
export const DIFFICULTY_CHOICES = [
  ["easy", "ง่าย"],
  ["medium", "กลาง"],
  ["hard", "ยาก"],
];

// Public = ขึ้นในรายการห้องหน้าแรก กดเข้าได้เลย · Private = เข้าได้ด้วยรหัสห้อง/ลิงก์เชิญเท่านั้น
export const VISIBILITY_CHOICES = [
  ["private", "Private"],
  ["public", "Public"],
];

// การ์ด Mini Challenge 4 ใบ ที่หัวห้องเปิด/ปิดทีละใบในห้องรอ (ตรงกับ CHALLENGE_TYPES ของ server)
// "none" = Standard Drawing (วาดอิสระ) · ต้องเปิดอย่างน้อย 1 ใบเสมอ · server สุ่มแต่ละตาจากใบที่เปิด
export const CHALLENGE_CARDS = [
  { id: "none", title: "Standard Drawing", desc: "วาดอิสระ ไม่มีกติกาพิเศษ" },
  { id: "colour_fix", title: "Colour Fix", desc: "วาดได้สีเดียวที่ถูกล็อกตลอดตา" },
  { id: "dont_lift_pen", title: "Don't Lift Pen", desc: "วาดได้เส้นเดียว ห้ามยกปากกา" },
  { id: "shapes_only", title: "Geometric Shapes Only", desc: "ใช้ได้แต่เครื่องมือรูปทรง (เส้น สี่เหลี่ยม วงกลม)" },
];

// ค่าเริ่มต้นเมื่อ server ยังไม่ได้ส่ง challenges มา (กันพังตอน render) · เปิดครบ 4/4 ตรงกับ DEFAULT_CHALLENGES ของ server
export const DEFAULT_CHALLENGES = CHALLENGE_CARDS.map((c) => c.id);

export const difficultyLabel = (d) => DIFFICULTY_CHOICES.find(([v]) => v === d)?.[1] ?? "ง่าย";

// จำนวนผู้เล่นสูงสุดของห้อง (settings.maxPlayers · server รับ 2–8) — เลือกได้เฉพาะโหมดแข่งเดี่ยว: 2/4/6/8 คน
// โหมดทีมไม่เลือกจำนวนคน (เล่นได้ทุกจำนวน ทีมต่างกันไม่เกิน 1 คน) แต่เลือก "จำนวนทีม" แทน
export const MAX_PLAYERS_LIMIT = 8;
export const maxPlayersChoices = () => [[2, "2"], [4, "4"], [6, "6"], [8, "8"]];

// โหมดทีม: เลือกจำนวนทีม 2 / 3 / 4 (settings.teams) · ทีมละกี่คนก็ได้แต่ทุกทีมต่างกันไม่เกิน 1 คน
// เช่น เพื่อน 5 คนเลือก 2 ทีม = 3+2 · ทีมละอย่างน้อย 2 คน → 2 ทีมต้อง ≥ 4 คน · 3 ทีม ≥ 6 · 4 ทีม ≥ 8
export const TEAM_IDS = ["A", "B", "C", "D"];
export const TEAM_COUNT_CHOICES = [[2, "2 ทีม"], [3, "3 ทีม"], [4, "4 ทีม"]];
export const TEAM_MIN_PLAYERS = 2;
export const teamIdsOf = (teams) => TEAM_IDS.slice(0, [2, 3, 4].includes(teams) ? teams : 2);
// โควตาต่อทีมของห้องนี้ (คนสูงสุด หารจำนวนทีม ปัดขึ้น)
export const teamCapOf = (maxPlayers, teams = 2) => Math.ceil((maxPlayers ?? MAX_PLAYERS_LIMIT) / teams);
// คำอธิบายสั้น ๆ ใต้ตัวเลือกจำนวนทีม (ขั้นต่ำกี่คนถึงเริ่มได้)
export const minPlayersForTeams = (teams) => teams * TEAM_MIN_PLAYERS;

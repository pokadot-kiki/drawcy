// ตัวช่วยทำความสะอาดข้อมูลจาก client ที่ใช้มากกว่าหนึ่งไฟล์
// (ระบบห้องใน index.js และ leaderboard.js ใช้ cleanName ตัวเดียวกัน ชื่อจึงถูกตัดด้วยกติกาเดียวกันทุกที่)

// ตัดช่องว่างหัวท้าย และยาวไม่เกิน 20 ตัวอักษร
function cleanName(name) {
  return String(name ?? "").trim().slice(0, 20);
}

// รายการรวมไว้จุดเดียว ปรับเพิ่มได้โดยไม่ต้องแก้ทุก handler
const NAME_RULES = require("../shared/name-rules.json");
const OFFENSIVE_NAMES = NAME_RULES.offensive;
// คำสุภาพบางคำมีตัวอักษรตรงกับรายการด้านบน ให้ผ่านได้เมื่อเป็นชื่อนั้นทั้งคำ
const SAFE_OVERLAPS = new Set(NAME_RULES.safeOverlaps);

function normalizeNameForCheck(name) {
  const mapped = String(name ?? "").toLocaleLowerCase("th")
    .replace(/[0134@5$!7]/g, (char) => ({ 0: "o", 1: "i", 3: "e", 4: "a", "@": "a", 5: "s", $: "s", "!": "i", 7: "t" })[char] || char)
    .replace(/([\u0e31-\u0e4e\p{M}])\1+/gu, "$1")
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
  // ยุบอักษรซ้ำติดกัน กันการแทรกสระ/วรรณยุกต์เดิมซ้ำเพื่อหลบการตรวจ
  return [...mapped].filter((char, i, chars) => char !== chars[i - 1]).join("");
}

function isNameAllowed(name) {
  const normalized = normalizeNameForCheck(name);
  if (!normalized) return true; // ชื่อว่างไปตอบ INVALID_NAME ตามเดิม
  if (SAFE_OVERLAPS.has(normalized)) return true;
  return !OFFENSIVE_NAMES.some((word) => normalized.includes(word));
}

// เลขอวตารต้องเป็นจำนวนเต็ม 0–11 (อวตาร 12 แบบ) ค่าอื่นใช้ 0 — ใช้ทั้งในห้อง (index.js) และตอนบันทึกคะแนน (leaderboard.js)
function cleanAvatar(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 11 ? n : 0;
}

module.exports = { cleanName, cleanAvatar, isNameAllowed, normalizeNameForCheck, OFFENSIVE_NAMES, SAFE_OVERLAPS };

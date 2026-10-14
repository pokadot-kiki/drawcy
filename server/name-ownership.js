const crypto = require("crypto");

// Salt คงที่ช่วยแยก hash ชื่อเจ้าของออกจาก hash ประเภทอื่น
const OWNER_SALT = process.env.NAME_OWNER_SALT || "drawcy-name-owner-v1";
const OWNER_KEY_RE = /^[a-f0-9]{32,128}$/i;

// อักขระที่ "มองไม่เห็น" แต่ทำให้ชื่อสองชื่อต่างกันในคอมพิวเตอร์
// \p{Cf} = อักขระจัดรูปแบบทั้งหมด (zero-width space/joiner, word joiner, BOM, soft hyphen ฯลฯ)
// ที่เหลือคือตัวที่ Unicode นับว่า "ไม่ต้องแสดง" แต่ไม่อยู่ในกลุ่ม Cf (combining grapheme joiner, ตัวเติมช่องฮันกึล, variation selector)
const INVISIBLE_RE = /[\p{Cf}\u034F\u115F\u1160\u3164\uFFA0\uFE00-\uFE0F]/gu;

// แปลงชื่อเป็น "รูปที่ใช้เทียบเจ้าของ" — ชื่อที่ตาเห็นเหมือนกันต้องได้ค่าเดียวกัน ไม่งั้นคนอื่นแอบใช้ชื่อเจ้าของได้
// (รอบก่อนเทียบแค่ตัดช่องว่างหัวท้าย + ตัวเล็ก จึงหลบได้ด้วยการแทรกอักขระล่องหน ฯลฯ — ดู CLAUDE.md หัวข้อ fix-name-owner)
//   1) NFKC: รวมรูปที่หน้าตาเหมือนกันให้เป็นแบบเดียว เช่น "ำ" กับ "ํ"+"า" · ตัวเต็มความกว้าง "Ｊｏｙ" → "Joy" · no-break space → ช่องว่าง
//   2) ลบอักขระล่องหน
//   3) ช่องว่างหลายตัวติดกันนับเป็นตัวเดียว (หน้าเว็บก็แสดงเป็นช่องเดียวอยู่แล้ว) แล้วตัดหัวท้าย
//   4) ตัวพิมพ์เล็ก
// ใช้เทียบอย่างเดียว ชื่อที่แสดงและบันทึกยังเป็นแบบที่ผู้เล่นพิมพ์ (ผ่าน cleanName) เหมือนเดิม
function normalizeOwnerName(name) {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE_RE, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("th");
}

function hashOwnerKey(key) {
  if (typeof key !== "string" || !OWNER_KEY_RE.test(key)) return null;
  return crypto.createHash("sha256").update(`${OWNER_SALT}:${key.toLowerCase()}`).digest("hex");
}

// เจ้าของ = แถวที่ "บันทึกก่อนสุด" (id น้อยสุด) ที่มี ownerHash ในบรรดาชื่อที่เทียบแล้วเท่ากัน
// ถ้ามีแถวเก่าที่หลุดเข้ามาก่อนแก้ (ชื่อหลบด้วยอักขระล่องหนแล้วคนอื่นเป็นเจ้าของ) เจ้าของเดิมที่มาก่อนยังชนะ
function ownerOfName(rows, name) {
  const normalized = normalizeOwnerName(name);
  let owner = null;
  for (const row of rows) {
    if (typeof row?.ownerHash !== "string" || normalizeOwnerName(row?.name) !== normalized) continue;
    if (!owner || (Number(row.id) || 0) < (Number(owner.id) || 0)) owner = row;
  }
  return owner?.ownerHash ?? null;
}

// ใช้ชื่อนี้ได้ไหม (server ตรวจที่ create_room · join_room · ai_start และตอนบันทึกคะแนน)
//   มีเจ้าของ        → ได้เฉพาะกุญแจที่ตรงกับเจ้าของ
//   มีในกระดานแต่ไม่มีเจ้าของ (ข้อมูลตัวอย่างจาก seed · แถวก่อนมีระบบนี้ · บันทึกโดยไม่มีกุญแจ)
//                     → ล็อกไว้ ไม่มีใครใช้ได้ (ผู้ใช้เลือกแบบนี้ 14 ต.ค. กันคนมาอ้างชื่อเก่าของคนอื่น)
//   ยังไม่มีในกระดาน  → ใช้ได้ คนแรกที่บันทึกคะแนนพร้อมกุญแจเป็นเจ้าของ
function canUseName(rows, name, key) {
  const ownerHash = ownerOfName(rows, name);
  if (ownerHash) return hashOwnerKey(key) !== null && hashOwnerKey(key) === ownerHash;
  const normalized = normalizeOwnerName(name);
  return !rows.some((row) => normalizeOwnerName(row?.name) === normalized);
}

module.exports = { OWNER_KEY_RE, normalizeOwnerName, hashOwnerKey, ownerOfName, canUseName };

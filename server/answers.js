// ---------- ตัวช่วยทาย: คำตอบที่ยอมรับ (aliases) + "ใกล้แล้ว" ----------
// ไฟล์นี้ไม่ผูกกับ socket (ฟังก์ชันล้วน + ที่เก็บคำ) — index.js กับ ai.js ใส่คำเข้ามา แล้วทุกโหมดถามที่นี่ที่เดียว
// ⚠️ คำตอบ/aliases อยู่ที่ server เท่านั้น ห้ามส่งออกใน event ใด
const { normalizeOwnerName } = require("./name-ownership");

// การันต์ คนพิมพ์ตกบ่อยและไม่ทำให้ความหมายเปลี่ยน — ตัดทิ้งเสมอ
const THANTHAKHAT_RE = /์/g;
// วรรณยุกต์ + ไม้ไต่คู้ — ⚠️ เปลี่ยนความหมายได้ (หม้อ/หมอ · เสื้อ/เสือ · กล้อง/กลอง) จึง "ไม่" ตัดทิ้งตอนเทียบปกติ
// ผ่อนให้เฉพาะคำยาวที่คนพิมพ์ผิดบ่อย เช่น "ทรัมเป๊ต" กับ "ทรัมเป็ต" (ดู isCorrect)
const TONE_RE = /[็-๋]/g;
const TONE_TOLERANT_MIN = 5; // ตัวอักษรหลัก (ไม่นับสระบนล่าง/วรรณยุกต์) อย่างน้อยเท่านี้ถึงจะผ่อนวรรณยุกต์
// ช่องว่าง ขีด จุด ขีดล่าง เครื่องหมายคำพูด — "t-shirt" = "tshirt" · "ice cream" = "icecream"
const SEPARATORS_RE = /[\s\-_.'’"]/g;

// แปลงคำตอบเป็น "รูปที่ใช้เทียบ": ใช้ตัวเทียบชื่อเจ้าของเดิม (NFKC · ลบอักขระล่องหน · ตัวเล็ก) + ตัดช่องว่าง/ขีด/การันต์
function normalizeAnswer(text) {
  return normalizeOwnerName(text).replace(THANTHAKHAT_RE, "").replace(SEPARATORS_RE, "");
}

// รูปไม่มีวรรณยุกต์ (ใช้ผ่อนกับคำยาวเท่านั้น)
const toneFree = (n) => n.replace(TONE_RE, "");
// จำนวน "ตัวอักษรหลัก" = ไม่นับเครื่องหมายบน/ล่าง — "ทรัมเป็ต" = ท ร ม เ ป ต = 6
const baseLength = (n) => [...n.replace(/\p{M}/gu, "")].length;

// คำหลัก → ชุดรูปที่ยอมรับ (normalize แล้ว) · คำเดียวกันจากสองไฟล์ (words.json + ai-words.json) รวมกัน
const accepted = new Map();
// รูปไม่มีวรรณยุกต์ → คำหลักที่ใช้รูปนี้ (กันผ่อนวรรณยุกต์แล้วไปชนคำอื่นในคลัง เช่น หม้อ/หมอ)
const toneIndex = new Map();

// ใส่คำ + คำที่นับว่าถูก (ภาษาอังกฤษ สะกดคล้าย คำย่อ) · ค่าที่ไม่ใช่ข้อความถูกข้าม
function register(word, extras = []) {
  if (typeof word !== "string" || !word.trim()) return;
  const key = word.trim();
  const set = accepted.get(key) || new Set([normalizeAnswer(key)]);
  for (const x of Array.isArray(extras) ? extras : []) {
    if (typeof x !== "string") continue;
    const n = normalizeAnswer(x);
    if (n) set.add(n);
  }
  accepted.set(key, set);
  for (const n of set) {
    const t = toneFree(n);
    if (!toneIndex.has(t)) toneIndex.set(t, new Set());
    toneIndex.get(t).add(key);
  }
}

// รูปที่ยอมรับของคำนี้ (ไม่เคยใส่ = มีแค่คำหลักเอง)
function acceptedFor(word) {
  return accepted.get(String(word ?? "").trim()) || new Set([normalizeAnswer(word)]);
}

// ทายถูกไหม — เทียบกับคำหลักและ aliases ทั้งหมด
// วรรณยุกต์ผิดนับว่าถูกได้เฉพาะคำยาว (≥ 5 ตัวหลัก) และรูปไม่มีวรรณยุกต์ต้องไม่ใช่ของคำอื่นในคลัง
function isCorrect(guess, word) {
  const g = normalizeAnswer(guess);
  if (!g) return false;
  const keys = acceptedFor(word);
  if (keys.has(g)) return true;
  if (baseLength(g) < TONE_TOLERANT_MIN) return false;
  const tg = toneFree(g);
  const owners = toneIndex.get(tg);
  const self = String(word ?? "").trim();
  if (owners && [...owners].some((w) => w !== self)) return false; // ชนคำอื่นในคลัง ไม่ผ่อน
  for (const k of keys) if (toneFree(k) === tg) return true;
  return false;
}

// ระยะแก้ไข (Levenshtein) นับทีละอักขระ (code point) — ไว้ดูว่าพิมพ์ผิดนิดเดียวไหม
function editDistance(a, b) {
  const s = [...a], t = [...b];
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length];
}

// "ใกล้แล้ว" = ทายผิด แต่ห่างจากคำที่ยอมรับตัวใดตัวหนึ่งแค่ 1 ตัว (คำยาว 3–5) หรือ 2 ตัว (คำยาว ≥ 6)
// คำสั้นกว่า 3 ตัวไม่บอก (บอกแล้วไล่เดาทีละตัวได้ง่ายเกินไป) · ทายถูกแล้วไม่นับว่าใกล้
function isClose(guess, word) {
  if (isCorrect(guess, word)) return false;
  const g = normalizeAnswer(guess);
  const gl = [...g].length;
  if (gl < 3) return false;
  for (const key of acceptedFor(word)) {
    const kl = [...key].length;
    if (kl < 3) continue;
    const limit = kl <= 5 ? 1 : 2;
    if (Math.abs(kl - gl) > limit) continue; // ยาวต่างกันเกินเพดาน ไม่ต้องคิดต่อ
    if (editDistance(g, key) <= limit) return true;
  }
  return false;
}

module.exports = { normalizeAnswer, register, acceptedFor, isCorrect, isClose, editDistance };

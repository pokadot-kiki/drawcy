// ชื่อผู้เล่นอัตโนมัติ: สัตว์ + คำน่ารัก ภาษาไทย (เช่น แมวขี้เซา เพนกวินซ่า หมีพุงกลม)
// ใส่ให้ตั้งแต่เปิดเว็บ ไม่ต้องพิมพ์ก็กดเล่นได้เลย · จำชื่อล่าสุดไว้ในเบราว์เซอร์ (เปิดครั้งหน้าใช้ชื่อเดิม)
// คลัง 20 × 20 = 400 ชื่อ ล้วนเป็นคำน่ารักเป็นกลาง ไม่มีคำหยาบหรือคำล้อเลียนใคร
// ความยาวทุกชื่อ ≤ 20 ตัวอักษร (เท่าเพดานของ server — cleanName) มีสคริปต์เทสตอนพัฒนายืนยันแล้ว
import { isNameAllowed } from "./nameRules";

const ANIMALS = [
  "แมว", "เพนกวิน", "หมี", "กระต่าย", "แพนด้า", "เป็ด", "หมูน้อย", "ช้างน้อย", "กบ", "ปลาหมึก",
  "นกฮูก", "จิ้งจอก", "ลูกหมา", "ฮิปโป", "แกะ", "ยีราฟ", "โลมา", "เต่า", "ลิงน้อย", "แฮมสเตอร์",
];

const CUTE_WORDS = [
  "ขี้เซา", "ซ่า", "พุงกลม", "ใจดี", "ขี้เล่น", "ตัวจิ๋ว", "ร่าเริง", "สดใส", "ขยันวาด", "ใจกล้า",
  "อารมณ์ดี", "ยิ้มแป้น", "ฟูฟ่อง", "ช่างฝัน", "ว่องไว", "ขี้อาย", "ใจฟู", "หัวใส", "ตาโต", "ซนน่ารัก",
];

const KEY = "jdi.name";
const MAX_LEN = 20; // = cleanName ฝั่ง server
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const SAFE_NAME_PAIRS = ANIMALS.flatMap((animal) => CUTE_WORDS.map((word) => animal + word)).filter(isNameAllowed);

export function randomName() {
  return pick(SAFE_NAME_PAIRS);
}

// ชื่อที่จำไว้ครั้งล่าสุด (ไม่มี/อ่านไม่ได้ = null)
export function loadName() {
  try {
    const saved = (localStorage.getItem(KEY) ?? "").trim().slice(0, MAX_LEN);
    return saved || null;
  } catch {
    return null;
  }
}

export function saveName(name) {
  const clean = String(name ?? "").trim().slice(0, MAX_LEN);
  if (!clean) return;
  try {
    localStorage.setItem(KEY, clean);
  } catch {
    /* จำไม่ได้ก็ใช้ได้ในรอบนี้ */
  }
}

// ชื่อตั้งต้นตอนเปิดเว็บ: ชื่อที่จำไว้ ไม่งั้นสุ่มใหม่
export function initialName() {
  return loadName() ?? randomName();
}

// ชื่อซ้ำในห้อง (NAME_TAKEN): ต่อเลขสุ่ม 2 หลักท้ายชื่อ ตัดชื่อเดิมให้เหลือที่ว่าง แล้วยาวไม่เกิน 20
export function withSuffix(name) {
  const base = [...String(name ?? "").trim()].slice(0, MAX_LEN - 2).join("");
  return `${base}${10 + Math.floor(Math.random() * 90)}`;
}

export const NAME_MAX_LEN = MAX_LEN;
export const __lists = { ANIMALS, CUTE_WORDS }; // ไว้ให้สคริปต์เทสตรวจความยาว

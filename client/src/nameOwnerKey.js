// กุญแจชื่อนี้แยกจากกุญแจผู้เล่น เพราะใช้ยืนยันชื่อใน Leaderboard ข้ามห้อง
const STORAGE_KEY = "jdi.nameOwnerKey";
let fallbackKey;

function createKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); // สุ่ม 128 บิต
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function nameOwnerKey() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (/^[a-f0-9]{32}$/i.test(saved || "")) return saved;
    const key = createKey();
    localStorage.setItem(STORAGE_KEY, key);
    return key;
  } catch {
    // ถ้าเบราว์เซอร์ปิด storage จะใช้ได้แค่จนกว่าจะปิดแท็บนี้
    return (fallbackKey ||= createKey());
  }
}

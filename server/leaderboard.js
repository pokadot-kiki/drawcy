// ---------- Leaderboard (ข้อ 6) ----------
// เก็บคะแนนโหมด Solo ไว้ในไฟล์ JSON ไฟล์เดียว (ไม่ใช้ database เพื่อให้ทันเวลา)
// ไฟล์นี้ไม่ผูกกับ socket หรือ express เลย จึง require ไปใช้ได้ทั้งจาก index.js สคริปต์ seed และเทส
//
// สองโหมดที่เก็บ (API ภายนอกเหมือนกันทุกตัวอักษร — saveScore/getLeaderboard/rankOf ยังเป็นฟังก์ชันปกติไม่ใช่ async):
//   1) ไฟล์ server/data/scores.json  — ค่าเริ่มต้น ใช้ตอนเล่นในเครื่อง
//   2) Upstash Redis (HTTP) — เปิดเมื่อตั้ง UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN ใช้ตอน deploy บน Render
//      เพราะดิสก์ของ Render แพ็กเกจฟรีหายทุกครั้งที่รีสตาร์ท/หลับ/deploy ใหม่
//      วิธีทำงาน: ตอนสตาร์ท (init) โหลดคะแนนทั้งหมดจาก Upstash มาไว้ในหน่วยความจำ → อ่านจากหน่วยความจำ (เร็ว ไม่ async)
//      → ตอนบันทึกคะแนนใหม่ อัปเดตหน่วยความจำทันที แล้วเขียนทั้งก้อนกลับ Upstash เบื้องหลัง (คิวเดียว ล้มแล้วลองใหม่)
//      ใช้ fetch ของ Node ล้วน ไม่เพิ่ม library · token อยู่ใน env เท่านั้น ไม่เคยอยู่ใน event/log
const fs = require("fs");
const path = require("path");
const { cleanName } = require("./clean");
const { hashOwnerKey, normalizeOwnerName, ownerOfName, canUseName } = require("./name-ownership");

// เทสตั้ง SCORES_FILE ชี้ไปไฟล์ชั่วคราว จะได้ไม่ไปทับคะแนนจริง
const SCORES_FILE = process.env.SCORES_FILE || path.join(__dirname, "data", "scores.json");
const REMOTE_KEY = "jdi:scores:v1";
const REMOTE_TIMEOUT_MS = 5000;
const REMOTE_RETRY_MS = 5000;
const TOP_LIMIT = 20;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // YYYY-MM เดือน 01-12 เท่านั้น
// สองกระดานแยกกัน: "solo" = แข่งกับ AI · "multi" = เล่นกับเพื่อนในห้อง
// เก็บในที่เดียวกัน (ไฟล์/Upstash ก้อนเดิม) แยกด้วยช่อง board ของแต่ละแถว · แถวเก่าที่ไม่มีช่องนี้ = solo
const BOARDS = ["solo", "multi"];
const isValidBoard = (board) => BOARDS.includes(board);
const boardOf = (row) => (row.board === "multi" ? "multi" : "solo");

// ---------- โหมด Upstash Redis ----------
let cache = null; // null = โหมดไฟล์ · array = โหมด Upstash (คะแนนทั้งหมดในหน่วยความจำ)
let remote = null; // { url, token } เมื่อเปิดโหมด Upstash
let dirty = false; // มีของใหม่ที่ยังไม่ได้เขียนกลับ
let flushing = null; // Promise ของรอบเขียนที่กำลังทำ
let retryTimer = null;

// ส่งคำสั่ง Redis หนึ่งคำสั่งผ่าน REST เช่น ["GET","key"] → คืน result · ผิดพลาดทุกกรณี throw
async function redis(command) {
  const res = await fetch(remote.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${remote.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return body.result;
}

// เรียกครั้งเดียวตอนสตาร์ท (index.js รอให้เสร็จก่อนเปิดรับคน) · ไม่ได้ตั้ง env = ใช้ไฟล์ตามเดิม
// ต่อ Upstash ไม่ได้/ข้อมูลเสีย = เตือนแล้วถอยไปใช้ไฟล์ ห้ามล่ม (คะแนนที่ยังอยู่ใน Upstash ไม่ถูกแตะ)
async function init() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token) return;
  remote = { url, token };
  try {
    const text = await redis(["GET", REMOTE_KEY]);
    let rows = [];
    if (text != null) {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("ข้อมูลใน Upstash ไม่ใช่ array");
      rows = data.filter(isValidRow);
    }
    cache = rows;
    console.log(`Leaderboard: เก็บใน Upstash Redis (โหลดมา ${rows.length} แถว)`);
  } catch (err) {
    remote = null;
    cache = null;
    console.warn(`ต่อ Upstash ไม่สำเร็จ (${err.message}) — Leaderboard ใช้ไฟล์แทน (คะแนนจะหายเมื่อรีสตาร์ทบน Render)`);
  }
}

// เขียนทั้งก้อนกลับ Upstash เบื้องหลัง · ถ้ามีรอบกำลังเขียนอยู่ ไม่เริ่มซ้อน แต่ทำเครื่องหมายว่ามีของใหม่ให้เขียนซ้ำอีกรอบ
function persistSoon() {
  dirty = true;
  if (flushing) return;
  flushing = (async () => {
    while (dirty && remote) {
      dirty = false;
      try {
        await redis(["SET", REMOTE_KEY, JSON.stringify(cache)]);
      } catch (err) {
        dirty = true;
        console.warn(`เขียนคะแนนลง Upstash ไม่สำเร็จ (${err.message}) — จะลองใหม่`);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          flushing = null;
          if (dirty) persistSoon();
        }, REMOTE_RETRY_MS);
        retryTimer.unref?.();
        return; // flushing ยังไม่ว่างจนกว่าตัวจับเวลาจะปล่อย กันเขียนถี่ตอนล่ม
      }
    }
    flushing = null;
  })();
}

// รอให้เขียนค้างเสร็จ (ใช้ตอน server โดนสั่งปิด เช่น deploy ใหม่บน Render เพื่อไม่ให้คะแนนล่าสุดหาย · และใช้ในเทส)
async function flush(timeoutMs = 4000) {
  const until = Date.now() + timeoutMs;
  while (remote && (dirty || flushing) && Date.now() < until) {
    if (dirty && (retryTimer || !flushing)) {
      // กำลังรอลองใหม่หรือยังไม่มีรอบเขียน → เขียนเดี๋ยวนี้เลย ไม่รอตัวจับเวลา (ใกล้ปิด server แล้ว)
      clearTimeout(retryTimer);
      retryTimer = null;
      flushing = null;
      persistSoon();
    }
    await (flushing || Promise.resolve());
    await new Promise((r) => setTimeout(r, 25));
  }
}

// แถวที่หน้าตาไม่ถูก (มีคนไปแก้ไฟล์มือ) ทิ้งไป ไม่ให้ทำให้หน้า Leaderboard พัง
function isValidRow(row) {
  return (
    typeof row?.name === "string" &&
    Number.isFinite(row.score) &&
    Number.isFinite(row.levelReached) &&
    typeof row.playedAt === "string"
  );
}

// อ่านไฟล์ทุกครั้งที่ต้องใช้ (ไฟล์เล็ก อ่านเร็ว) จะได้เห็นของล่าสุดเสมอ
// ไฟล์ยังไม่มี / JSON เสีย / ไม่ใช่ array → ถือว่ายังไม่มีคะแนน ห้ามล่ม
function loadScores() {
  if (cache) return [...cache]; // โหมด Upstash: อ่านจากหน่วยความจำ
  let data;
  try {
    data = JSON.parse(fs.readFileSync(SCORES_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`อ่าน scores.json ไม่ได้ (${err.message}) — ถือว่ายังไม่มีคะแนน`);
    return [];
  }
  return Array.isArray(data) ? data.filter(isValidRow) : [];
}

// เขียนแบบปลอดภัย: เขียนลงไฟล์ชั่วคราวก่อน แล้วค่อยเปลี่ยนชื่อทับของเดิม
// การเปลี่ยนชื่อเกิดในจังหวะเดียว ถ้าไฟดับกลางทาง ไฟล์จริงยังเป็นของเดิมครบ ไม่ใช่ครึ่งๆ กลางๆ
function writeScores(rows) {
  if (cache) {
    cache = rows;
    persistSoon();
    return;
  }
  fs.mkdirSync(path.dirname(SCORES_FILE), { recursive: true });
  const tmp = `${SCORES_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, SCORES_FILE);
}

// ไฟล์เสียแต่ยังมีของอยู่ → เก็บสำรองไว้ก่อนเขียนทับ เผื่อต้องกู้คะแนนด้วยมือ
function backupIfBroken() {
  if (cache) return; // โหมด Upstash ไม่มีไฟล์ให้สำรอง
  let text;
  try {
    text = fs.readFileSync(SCORES_FILE, "utf8");
  } catch {
    return; // ไม่มีไฟล์ ไม่มีอะไรให้สำรอง
  }
  try {
    if (Array.isArray(JSON.parse(text))) return; // ไฟล์ดี
  } catch {}
  const backup = `${SCORES_FILE}.broken-${Date.now()}`;
  fs.copyFileSync(SCORES_FILE, backup);
  console.warn(`scores.json เสีย — เก็บสำรองไว้ที่ ${path.basename(backup)} แล้วเริ่มรายการใหม่`);
}

// เวลาท้องถิ่นของ server แบบ "2026-10-05 20:14" ตาม events.md
function formatPlayedAt(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

// ตัวเลขจากภายนอก → จำนวนเต็มไม่ติดลบ (ค่าเพี้ยนเป็น 0)
function cleanCount(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// บันทึกคะแนนหนึ่งเกม — ข้อ 7 (Solo) เรียกตอนจบเกม **server เป็นคนเรียกเท่านั้น** client ส่งคะแนนเองไม่ได้
// เวลาเล่น (playedAt) server ใส่เอง ไม่รับจากข้างนอก
// คืนแถวที่บันทึก หรือ null ถ้าชื่อว่าง/บันทึกไม่สำเร็จ (ไม่ throw ให้เกมล่ม)
// board: "multi" = คะแนนจากเกมห้อง (index.js เรียกตอน endGame) · ไม่ใส่ = solo
function saveScore({ name, score, levelReached, board, nameOwnerKey } = {}, playedAt = new Date()) {
  const cleanedName = cleanName(name);
  if (!cleanedName) return null;
  try {
    backupIfBroken();
    const rows = loadScores();
    const existingOwner = ownerOfName(rows, cleanedName);
    const suppliedOwner = hashOwnerKey(nameOwnerKey);
    // ตรวจซ้ำตอนบันทึก ป้องกันการเรียก saveScore ข้ามด่านตรวจชื่อ (กติกาเดียวกับตอนเข้าเกม รวมชื่อเก่าที่ถูกล็อก)
    if (!canUseName(rows, cleanedName, nameOwnerKey)) return null;
    const row = {
      id: rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1,
      name: cleanedName,
      score: cleanCount(score),
      levelReached: cleanCount(levelReached),
      playedAt: formatPlayedAt(playedAt),
    };
    if (existingOwner || suppliedOwner) row.ownerHash = existingOwner || suppliedOwner;
    if (board === "multi") row.board = "multi"; // solo ไม่ใส่ช่องนี้ แถวจึงหน้าตาเหมือนเดิมทุกตัวอักษร
    rows.push(row);
    writeScores(rows);
    return row;
  } catch (err) {
    console.warn(`บันทึกคะแนนไม่สำเร็จ (${err.message})`);
    return null;
  }
}

function isValidMonth(month) {
  return typeof month === "string" && MONTH_RE.test(month);
}

// เทียบแถวสองแถว: คะแนนมากก่อน → ด่านไกลกว่าก่อน → เล่นก่อนได้เปรียบ → id น้อยกว่า
function compareRows(a, b) {
  return (
    b.score - a.score ||
    b.levelReached - a.levelReached ||
    a.playedAt.localeCompare(b.playedAt) ||
    (Number(a.id) || 0) - (Number(b.id) || 0)
  );
}

// หนึ่งชื่อหนึ่งแถว: เอาเกมที่ดีที่สุดของแต่ละชื่อ (ชื่อตรงกันทุกตัวอักษรนับเป็นคนเดียวกัน)
// เรียงตามกติกาเดียวกับ compareRows · month = "YYYY-MM" หรือ null (ตลอดกาล)
// ถ้าใส่ month จะเลือก "เกมที่ดีที่สุดในเดือนนั้น" ไม่ใช่ของตลอดกาล
function bestPerName(month = null, board = "solo") {
  const best = new Map();
  for (const r of loadScores()) {
    if (boardOf(r) !== board) continue; // คนละกระดาน ไม่เอามาปนกัน
    if (month && !r.playedAt.startsWith(month + "-")) continue;
    const cur = best.get(r.name);
    if (!cur || compareRows(r, cur) < 0) best.set(r.name, r);
  }
  return [...best.values()].sort(compareRows);
}

// 20 อันดับแรก · อันดับไม่ซ้ำกัน นับ 1, 2, 3...
function getLeaderboard(month = null, board = "solo") {
  return {
    month,
    board,
    // ส่งเฉพาะ 4 ช่องที่หน้าจอใช้ ไม่ส่ง id กับเวลาเล่น
    top: bestPerName(month, board)
      .slice(0, TOP_LIMIT)
      .map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, levelReached: r.levelReached })),
  };
}

// อันดับตลอดกาลของเกมหนึ่งเกม = 1 + จำนวน "คนอื่น" ที่เกมดีที่สุดของเขาดีกว่าหรือเท่าเกมนี้
// (เท่ากันทุกอย่าง คนที่ทำได้ก่อนอยู่เหนือ) ใช้ตอนจบเกม Solo หลัง saveScore แล้ว
function rankOf({ name, score, levelReached }) {
  const me = { name: cleanName(name), score: cleanCount(score), levelReached: cleanCount(levelReached) };
  const ahead = bestPerName(null).filter(
    (r) => r.name !== me.name && (r.score > me.score || (r.score === me.score && r.levelReached >= me.levelReached))
  );
  return ahead.length + 1;
}

module.exports = { init, flush, SCORES_FILE, saveScore, getLeaderboard, rankOf, isValidMonth, isValidBoard, loadScores, writeScores, formatPlayedAt, canUseName, normalizeOwnerName };

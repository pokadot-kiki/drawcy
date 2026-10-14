// โหลด server/.env (API key) เข้า process.env ก่อนอย่างอื่น · ไม่มีไฟล์ก็ไม่เป็นไร (Solo จะใช้โหมดจำลอง)
require("dotenv").config({ path: __dirname + "/.env", quiet: true });
const express = require("express");
const http = require("http");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const path = require("path");
const { Server } = require("socket.io");
const { cleanName, cleanAvatar, isNameAllowed } = require("./clean");
const { hashOwnerKey, normalizeOwnerName } = require("./name-ownership");
const answers = require("./answers");
const { TEAM_IDS, computeBalancedTeams } = require("./teams"); // จัดทีมให้สมดุล (ฟังก์ชันล้วน แยกไฟล์ให้ทดสอบตรง ๆ)
const leaderboard = require("./leaderboard");
const ai = require("./ai");
const aiDrawings = require("./ai-drawings");

const app = express();
const server = http.createServer(app);
// ── CORS: อนุญาตเฉพาะที่จำเป็น (แทน origin "*") ──
// เกมปกติเสิร์ฟหน้าเว็บกับ socket จาก server ตัวเดียวกัน (origin เดียวกัน) จึงไม่ต้องใช้ CORS เลย
// ที่ต้องอนุญาตคือตอนที่หน้าเว็บมาจาก "ที่อยู่อื่น" ของ server เรา:
//   - localhost / 127.x / ::1                  (เปิดเองในเครื่อง · vite dev พอร์ต 5173)
//   - IP วงส่วนตัว 10.x · 172.16–31.x · 192.168.x · 169.254.x  (เพื่อนในวง Wi-Fi/hotspot เดียวกัน)
//   - ชื่อ *.local                              (mDNS เช่น macbook.local)
//   - *.trycloudflare.com                       (ลิงก์ Cloudflare quick tunnel จาก npm run share)
//   - ที่เพิ่มเองใน env ALLOWED_ORIGINS (คั่นด้วยจุลภาค เช่น https://game.example.com)
// เว็บอื่นบนอินเทอร์เน็ตจะไม่ได้ header CORS · ไม่มี Origin เลย (แอปที่ไม่ใช่เบราว์เซอร์ / เทส) ผ่านตามปกติ
// บน Render: RENDER_EXTERNAL_URL (เช่น https://justdrawit.onrender.com) ถูกตั้งให้เองและเพิ่มเข้ารายการอัตโนมัติ
const EXTRA_ORIGINS = [String(process.env.ALLOWED_ORIGINS || ""), String(process.env.RENDER_EXTERNAL_URL || "")]
  .join(",")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (EXTRA_ORIGINS.includes(String(origin).replace(/\/$/, ""))) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (host.endsWith(".trycloudflare.com") && url.protocol === "https:") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
// same-origin (Origin ตรงกับ Host ที่เรียกมา เช่นผ่านโดเมนอื่นที่ชี้มาที่ server เรา) ผ่านเสมอ · cross-site ที่ไม่อยู่ในรายการข้างบนถูกปฏิเสธตั้งแต่ตอนจับมือ
// (กัน "เว็บแปลกหน้าให้เบราว์เซอร์ของเพื่อนแอบต่อ socket เข้า server เรา" ซึ่ง CORS อย่างเดียวไม่กัน websocket)
function originOk(req) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
const io = new Server(server, {
  cors: { origin: (origin, cb) => cb(null, isAllowedOrigin(origin)) },
  allowRequest: (req, cb) => cb(null, originOk(req)),
});

// ── ตัวตนผู้เล่นแบบถาวร (playerId) ──
// socket.id เปลี่ยนทุกครั้งที่รีเฟรชหน้า จึงใช้เป็น "ตัวตน" ไม่ได้ ถ้าใช้ รีเฟรชทีเดียวก็กลายเป็นคนใหม่
// client เก็บ "กุญแจลับ" (playerKey) ไว้ในเบราว์เซอร์ แล้วส่งมาตอนต่อ socket ทุกครั้ง (handshake.auth)
// server แปลงกุญแจเป็น playerId ด้วย SHA-256 → กุญแจเดิม = playerId เดิมเสมอ
// ทำไมไม่ใช้กุญแจเป็น playerId ตรงๆ: playerId ถูกส่งให้ทุกคนในห้อง (อยู่ใน room_update)
// ถ้ามันคือกุญแจด้วย ใครก็เอา id ของเพื่อนไป rejoin สวมรอยได้ · แปลงทางเดียวแล้วย้อนกลับไปหากุญแจไม่ได้
// ไม่ส่งกุญแจมา (test.html / สคริปต์เทส) = ใช้ socket.id เหมือนเดิม และไม่มีสิทธิ์ rejoin
const PLAYER_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
io.use((socket, next) => {
  const key = socket.handshake.auth?.playerKey;
  socket.data.persistent = typeof key === "string" && PLAYER_KEY_RE.test(key);
  socket.data.pid = socket.data.persistent
    ? crypto.createHash("sha256").update(key).digest("hex").slice(0, 20)
    : socket.id;
  next();
});

// ตอน deploy หลังพร็อกซีของ Render: ใครเข้าด้วย http ให้เด้งไป https (ตั้ง FORCE_HTTPS=1) · /healthz ยกเว้น (Render เช็คตรงเข้าเครื่อง)
if (process.env.FORCE_HTTPS === "1") {
  app.use((req, res, next) => {
    if (req.path !== "/healthz" && req.headers["x-forwarded-proto"] === "http") {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

// เช็คสุขภาพ: ตอบเร็วที่สุด ไม่แตะข้อมูลใดๆ (Render ใช้ดูว่า server พร้อมรับคนหรือยัง)
app.get("/healthz", (req, res) => res.type("text").send("ok"));

app.use(express.static(__dirname + "/public"));

// ---------- Leaderboard (HTTP ธรรมดา ไม่ใช่ Socket.IO เพราะขอดูครั้งเดียว ไม่ต้องสด) ----------
// แสดงเฉพาะเดือนนี้ตามเวลาไทยเสมอ (server เป็นคนเลือกเดือน) · ไม่รับ month แล้ว ส่งมาก็ไม่มีผล ดูย้อนหลังไม่ได้
app.get("/api/leaderboard", (req, res) => {
  // board = "solo" (แข่งกับ AI · ค่าเริ่มต้น) | "multi" (เล่นกับเพื่อน) — สองกระดานแยกกัน ไม่ปนคะแนนกัน
  const board = req.query.board ?? "solo";
  if (!leaderboard.isValidBoard(board)) return res.status(400).json({ error: "INVALID_BOARD" });
  try {
    res.json(leaderboard.getLeaderboard(board));
  } catch (err) {
    console.warn("ดึง leaderboard ไม่สำเร็จ:", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// ---------- รายการห้อง Public (HTTP เหมือน leaderboard: หน้าแรกขอดูเป็นระยะ ไม่ต้องสดระดับวินาที) ----------
// ส่งเฉพาะห้องที่หัวห้องตั้งเป็น public และยังไม่เต็ม · ห้อง private ไม่อยู่ในรายการ เข้าได้ด้วยรหัสเท่านั้น
// ส่งแค่ข้อมูลที่หน้าแรกต้องโชว์ — ไม่มีคำ ไม่มีคะแนน ไม่มี playerId
// (ประกาศ rooms / MAX_PLAYERS อยู่ข้างล่าง ใช้ได้เพราะฟังก์ชันนี้ถูกเรียกหลังไฟล์โหลดเสร็จแล้ว)
app.get("/api/rooms", (req, res) => {
  const list = [];
  for (const room of rooms.values()) {
    if (room.settings.visibility !== "public" || room.players.length >= roomMax(room)) continue;
    list.push({
      code: room.code,
      host: room.players.find((p) => p.id === room.hostId)?.name ?? "",
      players: room.players.length,
      maxPlayers: roomMax(room),
      status: room.status,
      mode: room.settings.mode,
      difficulty: room.settings.difficulty,
    });
  }
  res.json({ rooms: list.slice(0, 30) });
});

// ---------- เสิร์ฟหน้าเว็บของเกม (client ที่ build แล้ว) ----------
// เปิด http://localhost:3000 แล้วเล่นได้เลย ไม่ต้องรัน vite · สร้างไฟล์ด้วย npm run setup (หรือ cd client && npm run build)
// ลำดับสำคัญ: /api, /socket.io, /test.html ถูกจัดการไปแล้วข้างบน/ที่ socket.io จึงไม่โดนทับ
// ที่เหลือที่ไม่ใช่ /api และ /socket.io ตอบ index.html (เผื่อลิงก์เชิญ ?room=... และรีเฟรชหน้า)
const CLIENT_DIST = process.env.CLIENT_DIST || path.join(__dirname, "..", "client", "dist");
const HAS_CLIENT = fs.existsSync(path.join(CLIENT_DIST, "index.html"));
if (HAS_CLIENT) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api(\/|$)|socket\.io(\/|$)).*/, (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
} else {
  app.get("/", (req, res) =>
    res
      .status(503)
      .type("html")
      .send(
        "<meta charset=utf-8><title>DRAW.CY</title><body style='font-family:sans-serif;padding:2em'>" +
          "<h2>ยังไม่ได้ build หน้าเว็บของเกม</h2><p>รัน <code>npm run setup</code> (หรือ <code>cd client &amp;&amp; npm run build</code>) แล้วเปิด server ใหม่</p></body>",
      ),
  );
}

// ที่อยู่ IPv4 ของเครื่องนี้ในวงแลน (ไว้พิมพ์ให้เพื่อนพิมพ์ตาม)
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  }
  return out;
}

// ---------- ที่เก็บข้อมูลห้อง ----------
const rooms = new Map(); // key = รหัสห้อง, value = ข้อมูลห้อง
const MAX_PLAYERS = 8;       // เพดานสูงสุดของทุกห้อง (หัวห้องตั้ง settings.maxPlayers ให้น้อยกว่านี้ได้)
const MIN_ROOM_PLAYERS = 2;  // เล็กสุดที่ settings.maxPlayers ตั้งได้
// จำนวนคนสูงสุดของห้องนี้ (หัวห้องเลือก) — ห้องที่ไม่มีค่านี้ใช้เพดาน 8
const roomMax = (room) => room.settings.maxPlayers ?? MAX_PLAYERS;

// ---------- ฟังก์ชันช่วย ----------
function makeRoomCode() {
  let code;
  do {
    code = String(Math.floor(10000 + Math.random() * 90000));
  } while (rooms.has(code));
  return code;
}

// เลขอวตารต้องเป็นจำนวนเต็ม 0-11 ตาม events.md ค่าอื่นที่ไม่ถูกต้องใช้ 0 แทน (ไม่ต้องแจ้ง error)
function roomState(room) {
  const state = {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    players: room.players,
    settings: room.settings,
  };
  // โหมดทีมเท่านั้นที่มีช่องนี้ (classic ต้องหน้าตาเดิมเป๊ะ) · คะแนนทีม = ผลรวมของสมาชิก
  if (room.settings.mode === "team") state.teamScores = teamScores(room);
  return state;
}

// ══════════════════════════════════════════════════════════════════════
// โหมดทีม (ข้อ 8) — ทีม A กับ B วาดคำเดียวกันพร้อมกัน แต่ละทีมมี "เลน" (lane) ของตัวเอง
//
// เลน = ก้อนข้อมูลหน้าตาเดียวกับ "ห้อง" ในโหมด classic (กระดาน ประวัติ ย้อนกลับ คำใบ้ คนทายถูก ปากกา)
// และมี code เป็น "48213:A" / "48213:B" (Socket.IO room ย่อย) ฟังก์ชันวาดเดิมทุกตัว
// (storeAction undoCanvas revealHint canvasPayload ...) จึงใช้กับเลนได้ตรง ๆ โดยไม่ต้องแก้
// และทุกอย่างที่ส่งผ่าน lane.code จะถึงแค่สมาชิกทีมนั้น — นี่คือกำแพงกั้นระหว่างทีม
// ══════════════════════════════════════════════════════════════════════
const TEAM_COUNTS = [2, 3, 4];   // หัวห้องเลือกจำนวนทีมได้ 2 / 3 / 4 (settings.teams) · ทีมละกี่คนไม่ล็อก แค่ต่างกันไม่เกิน 1
const DEFAULT_TEAMS = 2;
const TEAM_MIN_PLAYERS = 2;      // ทุกทีมต้องมีอย่างน้อยเท่านี้ถึงเริ่มเกมได้
const FIRST_TEAM_BONUS = 100;    // ทีมที่ทายถูกก่อน ได้โบนัสต่อสมาชิกที่ทายถูก

const isTeamMode = (room) => room.settings.mode === "team";
// ชื่อทีมที่ใช้อยู่ในห้องนี้ เช่น 3 ทีม = ["A","B","C"]
const activeTeams = (room) => TEAM_IDS.slice(0, room.settings.teams ?? DEFAULT_TEAMS);
const teamCount = (room, t) => room.players.filter((p) => p.team === t).length;
const teamSum = (room, t) => room.players.filter((p) => p.team === t).reduce((n, p) => n + (p.score || 0), 0);
// คนเข้าใหม่/คนที่ยังไม่มีทีม: เข้าทีมที่คนน้อยที่สุด · คนเท่ากัน → ทีมที่คะแนนรวมต่ำกว่า (ช่วยให้สู้กันสูสี) · ยังเท่ากัน → ทีมหน้าสุด (A ก่อน)
// (เข้าทีมที่คนน้อยสุดเสมอ → จำนวนคนต่างกันไม่เกิน 1 ตลอด)
const autoTeam = (room) => {
  const ids = activeTeams(room);
  const minN = Math.min(...ids.map((t) => teamCount(room, t)));
  const pool = ids.filter((t) => teamCount(room, t) === minN);
  return pool.reduce((best, t) => (teamSum(room, t) < teamSum(room, best) ? t : best), pool[0]);
};
// ทีมละกี่คนได้สูงสุด (ห้องรับกี่คน แบ่งตามจำนวนทีม ปัดขึ้น)
const teamCap = (room) => Math.ceil(roomMax(room) / activeTeams(room).length);

// จัดทีมทั้งห้องใหม่ให้สมดุล (ใช้ computeBalancedTeams) แล้วย้ายผู้เล่นเข้า room ย่อยของทีมใหม่
function balanceRoomTeams(room, shuffle = true) {
  const map = computeBalancedTeams(room.players, { teams: activeTeams(room).length, shuffle });
  for (const p of room.players) {
    p.team = map.get(p.id);
    syncTeamRoom(room, p);
  }
}
// ทีมสมดุลพอเริ่มได้ไหม (ทุกคู่ทีมจำนวนคนต่างกันไม่เกิน 1 = มากสุด − น้อยสุด ≤ 1 · 2 vs 3 ได้ 2 vs 4 ไม่ได้)
const teamsBalanced = (room) => {
  const n = activeTeams(room).map((t) => teamCount(room, t));
  return Math.max(...n) - Math.min(...n) <= 1;
};
const teamRoom = (room, t) => `${room.code}:${t}`;

function teamScores(room) {
  const out = Object.fromEntries(activeTeams(room).map((t) => [t, 0]));
  for (const p of room.players) if (p.team in out) out[p.team] += p.score;
  return out;
}

function newLane(room, team) {
  const lane = { code: teamRoom(room, team), team, settings: room.settings, nextIdx: 0, drawerId: null };
  resetLane(lane, null, null);
  return lane;
}

// เริ่มตาใหม่ให้เลน: คำเดียวกัน Mini Challenge เดียวกัน แต่คำใบ้/ภาพ/คนทายถูกแยกกัน
function resetLane(lane, word, challenge) {
  lane.word = word;
  lane.challenge = challenge;
  lane.hintOpen = false;
  lane.penUsed = false;
  lane.guessedIds = new Set();
  lane.solved = false;   // ทีมนี้มีคนทายถูกแล้วหรือยัง
  lane.rank = 0;         // 1 = ทายถูกก่อนทีมอื่น
  lane.skipped = false;  // ไม่มีคนวาด → ข้ามตานี้ของทีมนี้
  lane.done = false;
  resetCanvas(lane);
}

// ให้ socket ของผู้เล่นอยู่ใน room ย่อยของทีมตัวเองเท่านั้น (team = null → ออกจากทั้งสอง)
function syncTeamRoom(room, player) {
  // io.in(playerId) = ทุก socket ของผู้เล่นคนนี้ (ปกติมีตัวเดียว · ตอนหลุดอยู่ไม่มีเลยก็ไม่เป็นไร)
  for (const t of TEAM_IDS) {
    if (t === player.team) io.in(player.id).socketsJoin(teamRoom(room, t));
    else io.in(player.id).socketsLeave(teamRoom(room, t));
  }
}

// ใช้ตอนหัวห้องสลับโหมด: team → จัดคนที่ยังไม่มีทีมให้สมดุล · classic → เคลียร์ทีมทุกคน
function applyMode(room) {
  // เพิ่งเปิดโหมดทีม และยังไม่มีใครมีทีมเลย (ปกติคือสลับมาจาก classic) → จัดทั้งห้องให้สมดุลทีเดียว
  if (isTeamMode(room) && room.players.every((p) => !activeTeams(room).includes(p.team))) return balanceRoomTeams(room, false); // คงลำดับเดิม หัวห้องได้ทีม A
  for (const p of room.players) {
    if (isTeamMode(room)) {
      if (!activeTeams(room).includes(p.team)) p.team = autoTeam(room);
    } else {
      p.team = null;
    }
    syncTeamRoom(room, p);
  }
}

const laneList = (room) => (isTeamMode(room) && room.teams ? activeTeams(room).map((t) => room.teams[t]) : []);
const laneOfDrawer = (room, id) => laneList(room).find((l) => l.drawerId === id) || null;
const laneGuessers = (room, lane) =>
  room.players.filter((p) => p.team === lane.team && p.id !== lane.drawerId && p.connected !== false); // คนที่หลุดอยู่ไม่ต้องรอ
const laneIsDone = (room, lane) =>
  lane.skipped || laneGuessers(room, lane).every((p) => lane.guessedIds.has(p.id));

// คนวาดคนถัดไปของทีม (หมุนเวียนในทีม) · ทีมไม่มีใครเหลือ = null
function pickTeamDrawer(room, team) {
  const members = room.players.filter((p) => p.team === team);
  if (members.length === 0) return null;
  const lane = room.teams[team];
  // ข้ามคนที่หลุดอยู่ (ถ้าหลุดกันทั้งทีมก็ใช้คนตามคิวเดิม)
  for (let i = 0; i < members.length; i++) {
    const m = members[lane.nextIdx++ % members.length];
    if (m.connected !== false) return m.id;
  }
  return members[lane.nextIdx++ % members.length].id;
}

// ตาจบเมื่อทุกเลนที่ยังเล่นอยู่ "ทายถูกครบทุกคน" (หรือถูกข้าม)
function checkTeamRoundEnd(room) {
  if (room.phase !== "drawing") return;
  for (const lane of laneList(room)) if (!lane.done && laneIsDone(room, lane)) lane.done = true;
  if (laneList(room).every((l) => l.done)) endRound(room);
}

// round_start ของทีมหนึ่ง — คำใบ้/ภาพ/คนทายถูกเป็นของทีมนั้น ส่งผ่าน lane.code เท่านั้น
function teamRoundInfo(room, lane) {
  let next = null;
  if (room.teamTurn < room.teamTotalTurns) {
    const members = room.players.filter((p) => p.team === lane.team);
    if (members.length) next = members[lane.nextIdx % members.length].id;
  }
  return {
    round: room.round,
    totalRounds: room.settings.rounds,
    team: lane.team,
    drawerId: lane.drawerId,
    drawerIds: Object.fromEntries(activeTeams(room).map((t) => [t, room.teams[t].drawerId])),
    nextDrawerId: next,
    hint: lane.hintOpen && lane.word ? makeHint(lane.word) : null,
    hintAt: hintAt(room),
    time: room.timeLeft,
    challenge: room.challenge ?? { type: "none" },
    intro: Boolean(room.intro),
    guessedIds: [...lane.guessedIds],
    solvedTeams: activeTeams(room).filter((t) => room.teams[t].solved), // ชื่อทีมเท่านั้น ไม่มีชื่อคน/คำ
  };
}

function nextTeamTurn(room) {
  if (!rooms.has(room.code) || room.status !== "playing") return;
  if (room.teamTurn >= room.teamTotalTurns) return endGame(room);
  for (const t of activeTeams(room)) {
    const lane = room.teams[t];
    lane.drawerId = pickTeamDrawer(room, t);
    lane.skipped = lane.drawerId === null;
  }
  if (laneList(room).every((l) => l.skipped)) return endGame(room);
  room.round = Math.floor(room.teamTurn / room.teamPerRound) + 1;
  room.teamTurn++;
  room.phase = "choosing";
  room.wordOptions = pickWords(3, room.settings.difficulty); // สองทีมได้ตัวเลือกชุดเดียวกัน คนวาดคนไหนเลือกก่อน คำนั้นใช้กับทั้งสองทีม
  const challenge = rollChallenge(room); // Mini Challenge เดียวกันทั้งสองทีม
  for (const lane of laneList(room)) {
    if (lane.drawerId) io.to(lane.drawerId).emit("choose_word", { options: room.wordOptions, time: 10, challenge });
  }
  room.chooseEndsAt = Date.now() + CHOOSE_MS;
  room.chooseTimeout = setTimeout(() => startTeamDrawing(room, room.wordOptions[0]), CHOOSE_MS);
}

function startTeamDrawing(room, word) {
  clearTimeout(room.chooseTimeout);
  room.phase = "drawing";
  room.word = word;
  room.roundGains = {};
  room.solveCount = 0;
  room.challenge = room.nextChallenge ?? { type: "none" }; // สุ่มไว้ตั้งแต่ขึ้นตา (rollChallenge) เดียวกันทั้งสองทีม
  const introMs = introMsFor(room.challenge);
  room.intro = introMs > 0; // ตั้งก่อน emit เพราะ teamRoundInfo อ่านค่านี้
  room.timeLeft = room.settings.drawTime;
  for (const t of activeTeams(room)) {
    const lane = room.teams[t];
    const skipped = lane.skipped;
    resetLane(lane, word, room.challenge);
    lane.skipped = skipped;
    lane.done = skipped;
  }
  for (const lane of laneList(room)) {
    io.to(lane.code).emit("round_start", teamRoundInfo(room, lane));
    if (lane.drawerId) io.to(lane.drawerId).emit("your_word", { word });
  }
  beginDrawing(room, introMs, () => endRound(room));
}

// ทายในโหมดทีม — ทุกอย่างผ่านเลนของทีมผู้ทาย (แชทผิด/ถูก คำใบ้ ✅) ไม่รั่วไปทีมอื่น
function handleTeamGuess(socket, room, player, text) {
  const lane = room.teams?.[player.team];
  if (!lane) return;
  const msg = { playerId: socket.data.pid, name: player.name, text };
  // ไม่ได้อยู่ช่วงวาด หรือทีมนี้ถูกข้าม: คุยได้แต่ในทีมตัวเอง
  if (room.phase !== "drawing" || room.intro || lane.skipped) return void io.to(lane.code).emit("chat_message", msg);
  if (socket.data.pid === lane.drawerId) return; // คนวาดพิมพ์ไม่ได้
  if (lane.guessedIds.has(socket.data.pid)) {
    for (const id of [lane.drawerId, ...lane.guessedIds]) io.to(id).emit("chat_message", msg);
    return;
  }
  if (!answers.isCorrect(text, room.word)) {
    io.to(lane.code).emit("chat_message", msg); // ทายผิด เห็นแค่ในทีม
    return void sendCloseHint(socket, text, room.word);
  }

  lane.guessedIds.add(socket.data.pid);
  if (!lane.solved) {
    lane.solved = true;
    lane.rank = ++room.solveCount; // 1 = ทีมแรกที่ทายถูก
    // ทีมอื่นรู้แค่ "ทีมไหนทายถูกแล้ว" ไม่มีชื่อคน ไม่มีคำ
    for (const other of laneList(room)) if (other !== lane) io.to(other.code).emit("correct_guess", { team: lane.team });
  }
  const gained = 50 + room.timeLeft * 5 + (lane.rank === 1 ? FIRST_TEAM_BONUS : 0);
  player.score += gained;
  room.roundGains[socket.data.pid] = gained;
  const drawer = room.players.find((p) => p.id === lane.drawerId);
  if (drawer) {
    drawer.score += 50;
    room.roundGains[drawer.id] = (room.roundGains[drawer.id] || 0) + 50;
  }
  socket.emit("chat_message", { ...msg, correct: true });
  socket.to(lane.code).emit("chat_message", { ...msg, text: "******", correct: true });
  io.to(lane.code).emit("correct_guess", { playerId: socket.data.pid, name: player.name, team: lane.team });
  io.to(room.code).emit("room_update", roomState(room));
  checkTeamRoundEnd(room);
}

// ---------- คลังคำ ----------
// อ่านจาก server/data/words.json ตอนสตาร์ท แยกเป็น 3 ระดับ
// ถ้าไฟล์หายหรือ JSON เสีย ให้ใช้คำสำรอง 10 คำเดิม — server ต้องเปิดได้เสมอ ห้ามล่ม
const WORDS_FILE = __dirname + "/data/words.json";
const LEVELS = ["easy", "medium", "hard"];
const MAX_WORD_LENGTH = 12; // ยาวเกินนี้จะเตือนใน log แต่ยังใช้คำนั้นตามปกติ ไม่ตัดทิ้ง
const FALLBACK_WORDS = ["แมว", "หมา", "บ้าน", "รถไฟ", "ร่ม", "ดอกไม้", "ปลา", "ต้นไม้", "จักรยาน", "ไอศกรีม"];

// แยกเก็บตามระดับ พร้อมหมวดหมู่ เผื่อไว้ให้ข้อ 7 (Solo) ไล่ความยากทีละขั้น
const WORD_BANK = { easy: [], medium: [], hard: [] };
// ชื่อคำล้วนๆ ทุกระดับรวมกัน โหมดปกติสุ่มจากก้อนนี้
let ALL_WORDS = [];

function loadWords() {
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(WORDS_FILE, "utf8"));
  } catch (err) {
    console.warn(`อ่าน words.json ไม่ได้ (${err.message}) — จะใช้คำสำรองแทน`);
  }

  // เก็บเฉพาะรายการที่หน้าตาถูก และตัดคำซ้ำทิ้ง กันไฟล์มีปัญหาทำให้เกมเพี้ยน
  const seen = new Set();
  for (const level of LEVELS) {
    const list = Array.isArray(data?.[level]) ? data[level] : [];
    for (const item of list) {
      const word = typeof item?.word === "string" ? item.word.trim() : "";
      if (!word || seen.has(word)) continue;
      seen.add(word);
      WORD_BANK[level].push({ word, category: typeof item?.category === "string" ? item.category : "" });
      answers.register(word, item?.aliases); // คำที่นับว่าถูก (เก็บที่ server เท่านั้น ไม่ส่งออก)
    }
  }

  ALL_WORDS = LEVELS.flatMap((level) => WORD_BANK[level].map((item) => item.word));

  if (ALL_WORDS.length === 0) {
    WORD_BANK.easy = FALLBACK_WORDS.map((word) => ({ word, category: "สำรอง" }));
    ALL_WORDS = [...FALLBACK_WORDS];
    console.log(`คลังคำ: ใช้คำสำรอง ${ALL_WORDS.length} คำ (อ่าน words.json ไม่ได้)`);
    return;
  }

  // นับเป็น "จำนวนอักขระ" ซึ่งมากกว่าจำนวนตัวที่ตาเห็น เพราะสระบนล่างและวรรณยุกต์
  // เป็นอักขระแยกต่างหาก เช่น "ต้นไม้" นับได้ 6 ทั้งที่ตาเห็น 4
  // (ข้อความไทย [...word].length กับ word.length ให้ค่าเท่ากัน ใช้ [...word] ไว้เผื่อ
  //  อนาคตมีอักขระนอกระนาบหลักอย่างอีโมจิ ซึ่ง word.length จะนับเป็น 2)
  const tooLong = ALL_WORDS.filter((word) => [...word].length > MAX_WORD_LENGTH);
  if (tooLong.length > 0) {
    console.warn(`⚠️  คำยาวเกิน ${MAX_WORD_LENGTH} ตัวอักษร ${tooLong.length} คำ: ${tooLong.join(", ")}`);
  }

  console.log(
    `คลังคำ: ${LEVELS.map((l) => `${l} ${WORD_BANK[l].length}`).join(" / ")} (รวม ${ALL_WORDS.length} คำ) จาก words.json`
  );
}

loadWords();

// สุ่มคำจากระดับความยากที่ห้องเลือก (settings.difficulty: easy | medium | hard)
// ระดับนั้นมีคำไม่พอ (เช่นตอนใช้คำสำรองที่มีแต่ easy) → ใช้ทุกระดับปนกัน เกมต้องเดินต่อได้เสมอ
function pickWords(n, difficulty) {
  const level = (WORD_BANK[difficulty] || []).map((item) => item.word);
  const pool = level.length >= n ? level : ALL_WORDS;
  return [...pool].sort(() => Math.random() - 0.5).slice(0, n);
}


// ---------- คำใบ้ ----------
// คำใบ้ไม่โผล่ตั้งแต่ต้นตาอีกแล้ว มันจะเปิดเมื่อ "เวลาเหลือหนึ่งในสามของเวลาเต็ม" (ปัดลง)
//   30 วิ → เหลือ 10 · 45 วิ → เหลือ 15 · 60 วิ → เหลือ 20 · 90 วิ → เหลือ 30
// คนวาดกดขอเปิดก่อนเวลาได้หนึ่งครั้งต่อตา (request_hint)
//
// กติกาที่ห้ามละเมิด: **ห้ามส่งช่องคำใบ้ออกไปก่อนถึงเวลาทางใดทางหนึ่งเด็ดขาด**
// ไม่ว่าจะใน round_start ของคนเข้าห้องกลางตา หรือที่ไหน — คนทายเปิด DevTools ดูได้
// เพราะฉะนั้น roundInfo() จึงส่ง hint: null จนกว่าจะเปิดจริงเท่านั้น
const HINT_AT_DIVISOR = 3;
const CHOOSE_MS = 10000; // เวลาเลือกคำ (หมดแล้ว server เลือกตัวแรกให้)

function makeHint(word) {
  const slots = [];
  for (const ch of word) {
    if (/[\u0E48-\u0E4B]/.test(ch)) {
      if (slots.length > 0) slots[slots.length - 1].tone = true;
    } else if (/[\u0E31\u0E34-\u0E3A\u0E47\u0E4C-\u0E4E]/.test(ch)) {
      // สระบนล่าง ไม้ไต่คู้ การันต์ ไม่นับเป็นช่อง ข้ามไป
    } else if (ch === " ") {
      slots.push({ space: true });
    } else {
      slots.push({ tone: false });
    }
  }
  return slots;
}

// วินาทีที่เหลือตอนคำใบ้จะเปิดเอง — คิดจากเวลาต่อตาที่ตั้งไว้ในห้องนั้น
// อ่านค่าจาก settings ทุกครั้ง (ไม่แช่ไว้ตั้งแต่เริ่มตา) จึงไม่มีทางไม่ตรงกัน
function hintAt(room) {
  return Math.floor(room.settings.drawTime / HINT_AT_DIVISOR);
}

// เปิดคำใบ้ให้ทั้งห้อง — **ประตูเดียว** ของการเปิดคำใบ้ในตาหนึ่ง
// ทั้งทางที่คนวาดกดขอ (request_hint) และทางที่เวลาหมด (tick ของ startTimer) ต้องผ่านฟังก์ชันนี้
// จึงรับประกันได้ว่า hint_reveal ออกไป "ครั้งเดียวต่อตา" จริง ไม่ใช่แค่พยายามให้เป็น
// คืน true ถ้าเปิดจริง · false ถ้าเปิดไปแล้วหรือยังไม่มีคำ (ไม่ส่งอะไรออกไปเลย)
function revealHint(room, by) {
  if (room.hintOpen || !room.word) return false;
  room.hintOpen = true;
  io.to(room.code).emit("hint_reveal", { hint: makeHint(room.word), by });
  return true;
}


// ---------- Mini Challenge (ข้อ 5) ----------
// สุ่มใหม่ทุกครั้งที่ขึ้นตาใหม่ แล้วติดไปกับ round_start ของตานั้น (events.md หัวข้อ 5)
//
// หัวห้องเปิด/ปิดกติกาได้ "ทีละใบ" ในห้องรอ (settings.challenges = ลิสต์ชนิดที่เปิด)
//   "none" = Standard Drawing (วาดอิสระ) · "colour_fix" · "dont_lift_pen" · "shapes_only"
// แต่ละตาสุ่มจากใบที่เปิดอยู่เท่านั้น (ดู rollChallenge) · ต้องเปิดอย่างน้อย 1 ใบเสมอ
//
// ทุกกติกาตัดสินที่ server เท่านั้น client แค่ปิดปุ่มให้ใช้ง่าย ไม่ใช่ตัวกันโกง
// และเหมือนการวาดทุกอย่าง: ไม่ผ่านกติกา = ทิ้งเงียบ ๆ ไม่ตอบ error กลับไป
// (ถ้าตอบ error กลับ เท่ากับบอกคนที่กำลังลองโกงว่าเราดักตรงไหนอยู่)
// จังหวะของ Mini Challenge (รอบ 3C):
//   - ตาแรกของเกมไม่มีเสมอ ให้ทุกคนเล่นแบบปกติก่อน
//   - ตาถัดไปสุ่ม โอกาส 1 ใน 3 และ "ไม่ติดกันสองตา" (ตาที่แล้วมีกติกา ตานี้ปกติเสมอ)
//   - สุ่มตอนขึ้นตา (ก่อนเลือกคำ) เพื่อบอกคนวาดในกล่องเลือกคำ ไม่ใช่ตอนเริ่มวาด
//   - ตาที่มีกติกา: ขึ้นป้ายใหญ่ CHALLENGE_INTRO_MS ก่อน ช่วงนั้นห้ามวาดและยังไม่เริ่มนับเวลา (เวลาวาดเท่าเดิม)
// env 3 ตัวนี้ไว้ให้เทสเท่านั้น (ไม่ตั้ง = กติกาจริง): ODDS ปรับโอกาส · NO_PACING=1 ปิดกฎตาแรก/ไม่ติดกัน · INTRO_MS=0 ข้ามป้าย
const CHALLENGE_CHANCE = process.env.CHALLENGE_ODDS !== undefined ? Number(process.env.CHALLENGE_ODDS) : 1 / 3;
const CHALLENGE_NO_PACING = process.env.CHALLENGE_NO_PACING === "1";
const CHALLENGE_INTRO_MS = process.env.CHALLENGE_INTRO_MS !== undefined ? Number(process.env.CHALLENGE_INTRO_MS) : 2000;

// 8 สีหลักของพาเลต — ต้องตรงกับ PAINT_COLORS ใน client/src/canvas/palette.js
// คนละโปรเซส import กันไม่ได้จึงประกาศซ้ำ เหมือน SIZE_MIN/SIZE_MAX ข้างบน
const CHALLENGE_COLORS = ["#000000", "#ffffff", "#e8553f", "#ef8a2b", "#ffc81e", "#22a559", "#1e6fe8", "#7b5ce0"];

// สีของกระดาน (Canvas.jsx ล้างจอด้วยสีนี้) — ใช้เป็นเงื่อนไขตัดสีออกจากกองสุ่ม
const BOARD_COLOR = "#ffffff";

// กองที่ colour_fix ใช้จริง = 8 สีหลัก "ตัดสีขาวออก"
// เพราะล็อกให้วาดสีขาวบนกระดานสีขาว = วาดอะไรก็มองไม่เห็นทั้งตา ผู้เล่นทำภารกิจไม่ได้เลย
// (เจอของจริงตอนเทสเบราว์เซอร์: ออกตาสีขาวแล้วกระดานว่างเปล่า แม้ผู้เล่นลากเส้นไปแล้วจริง ๆ)
// เหลือ 7 สี ทุกสียัง "เป็นสีที่ตาเห็นได้" ทั้งหมด
const COLOUR_FIX_COLORS = CHALLENGE_COLORS.filter((c) => c !== BOARD_COLOR);

// ชนิดกติกาทั้งหมดที่เลือกเปิด/ปิดได้ · "none" = Standard Drawing (วาดอิสระ)
const CHALLENGE_TYPES = ["none", "colour_fix", "dont_lift_pen", "shapes_only"];
const SPECIAL_CHALLENGES = ["colour_fix", "dont_lift_pen", "shapes_only"]; // ทุกใบยกเว้น Standard
// ค่าเริ่มต้นตอนสร้างห้อง: เปิดครบ 4/4 (หัวห้องปิดทีละใบเองได้ในห้องรอ) · ⚠️ ต้องตรงกับ client/src/roomOptions.js
// ใช้ตอนสร้างห้องใหม่เท่านั้น — ห้องที่มีอยู่แล้วเก็บชุดของตัวเองใน settings.challenges ไม่ถูกเปลี่ยน
const DEFAULT_CHALLENGES = [...CHALLENGE_TYPES];

// กรองลิสต์ให้เหลือชนิดที่รู้จัก ไม่ซ้ำ และต้องมีอย่างน้อย 1 ใบ (ไม่งั้นคืน null = ไม่รับค่านี้)
function sanitizeChallenges(list) {
  if (!Array.isArray(list)) return null;
  const set = CHALLENGE_TYPES.filter((t) => list.includes(t)); // คงลำดับมาตรฐาน ตัดซ้ำ/ค่าแปลกปลอม
  return set.length > 0 ? set : null;
}

// สร้างก้อน Challenge จากชนิด — colour_fix แนบสีสุ่ม (ตัดสีขาวออก) · ที่เหลือมีแค่ type
function makeChallenge(type) {
  if (type === "colour_fix") {
    return { type, color: COLOUR_FIX_COLORS[Math.floor(Math.random() * COLOUR_FIX_COLORS.length)] };
  }
  return { type };
}

const pickFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];

// สุ่ม Mini Challenge ของตาที่กำลังจะเริ่ม → room.nextChallenge (ใช้ทั้งบอกคนวาดตอนเลือกคำ และตอนเริ่มวาดจริง)
// สุ่ม "จากใบที่หัวห้องเปิดไว้เท่านั้น" (settings.challenges) · challengeHistory = ชนิดของทุกตา (ล้างตอน start_game) ไว้ดูตาแรก/ตาที่แล้ว
//   - เปิดแค่ Standard → ทุกตา none
//   - ปิด Standard → ทุกตาต้องเป็นกติกาพิเศษ (ไม่มีจังหวะตาแรก/ไม่ติดกัน เพราะไม่มีตาปกติให้คั่น)
//   - เปิดทั้ง Standard และกติกาพิเศษ → ใช้จังหวะเดิม: ตาแรกไม่มี · ~1/3 · ไม่ติดกันสองตา
function rollChallenge(room) {
  const history = room.challengeHistory ?? (room.challengeHistory = []);
  const enabled = room.settings.challenges ?? DEFAULT_CHALLENGES;
  const specials = SPECIAL_CHALLENGES.filter((t) => enabled.includes(t));
  const hasNone = enabled.includes("none");

  let type;
  if (specials.length === 0) {
    type = "none";
  } else if (!hasNone) {
    type = pickFrom(specials);
  } else {
    const allowed = CHALLENGE_NO_PACING || (history.length > 0 && history[history.length - 1] === "none");
    type = allowed && Math.random() < CHALLENGE_CHANCE ? pickFrom(specials) : "none";
  }
  const ch = makeChallenge(type);
  history.push(ch.type);
  room.nextChallenge = ch;
  return ch;
}

// ช่วงป้ายใหญ่ของตาที่มีกติกา (ms) · ตาปกติ = 0
const introMsFor = (challenge) => (challenge && challenge.type !== "none" ? CHALLENGE_INTRO_MS : 0);

// เริ่มนับเวลาวาดจริง: ตาปกติเริ่มทันที · ตามี intro รอป้ายหายก่อน แล้วบอกทุกคนด้วย intro_end (คนวาดเริ่มวาดได้ตอนนี้)
// ช่วง intro: room.intro = true → drawRoom() ทิ้งการวาดทุกชนิด และการทายถูกนับเป็นแชทธรรมดา
function beginDrawing(room, introMs, onEnd) {
  room.intro = introMs > 0;
  if (!room.intro) return startTimer(room, room.settings.drawTime, onEnd);
  room.timeLeft = room.settings.drawTime;
  room.introTimer = setTimeout(() => {
    room.intro = false;
    io.to(room.code).emit("intro_end", {});
    startTimer(room, room.settings.drawTime, onEnd);
  }, introMs);
}

// เทียบสีแบบไม่สนตัวพิมพ์เล็กใหญ่ เพราะ COLOR_RE ยอมรับทั้ง #E8553F และ #e8553f
// ถ้าเทียบตรง ๆ สีเดียวกันแท้ ๆ จะกลายเป็นคนละสีไปได้
const sameColor = (a, b) => a.toLowerCase() === b.toLowerCase();

// ยางลบไม่ได้ส่งมาเป็น event แยก มันมาเป็นเส้นปกติที่มี tool: "eraser"
// (ดู Canvas.jsx ตอนประกอบ beginStroke) จึงต้องดักที่ช่อง tool ตรงนี้
// **ยางลบต้องผ่านทุกกติกาเสมอ** ไม่งั้นผู้เล่นจะลบรอยตัวเองไม่ได้เลยทั้งตา
const isEraser = (tool) => tool === "eraser";

// กติกาของเส้น (stroke_start) ของตานี้ — คืน true ถ้าผ่าน
//
// ที่ยกเว้นยางลบ **เฉพาะ colour_fix** เพราะที่นั่นกติกาเป็นเรื่อง "สี" ล้วน ๆ
// ส่วน dont_lift_pen กติกาเป็นเรื่อง "จังหวะเวลา" — ยางลบก็คือการวาดทับลงบนผืนเดิม
// หลังยกปากกาแล้วจึงต้องถูกทิ้งเหมือนเส้นปากกาทุกประการ
function challengeAllowsStroke(room, color, tool) {
  const ch = room.challenge;
  if (!ch || ch.type === "none") return true;
  if (ch.type === "shapes_only") return false; // โหมดรูปทรง: ห้ามวาดเส้นมือเปล่า (รวมยางลบ) รับแค่ draw_shape
  if (ch.type === "colour_fix") return isEraser(tool) || sameColor(color, ch.color);
  if (ch.type === "dont_lift_pen") return !room.penUsed; // ยกปากกาไปแล้ว = วาดต่อไม่ได้
  return true;
}

// กติกาของถังสี — dont_lift_pen "ทิ้ง fill ทุกครั้ง" (events.md หัวข้อ 5)
// เข้มตั้งแต่ก่อนยกปากกาด้วย ไม่ใช่แค่หลังยก: การเทสีท่วมพื้นที่ในคลิกเดียวขัดกับ
// "เส้นเดียวต่อเนื่อง" ตั้งแต่ต้นอยู่แล้ว และ client ก็ซ่อนปุ่มถังสีให้ตั้งแต่แรก
function challengeAllowsFill(room, color) {
  const ch = room.challenge;
  if (!ch || ch.type === "none") return true;
  if (ch.type === "colour_fix") return sameColor(color, ch.color);
  if (ch.type === "dont_lift_pen") return false;
  // shapes_only ตกมาถึงตรงนี้ → อนุญาตถังสี (ไว้ระบายสีในรูปทรง — ที่ห้ามคือเส้นมือเปล่าเท่านั้น)
  return true;
}

// กติกาของรูปทรง (draw_shape):
//   colour_fix → ต้องสีตรง · dont_lift_pen → ทิ้งทุกครั้ง (ขัดกับ "เส้นเดียวต่อเนื่อง")
//   shapes_only → อนุญาต (เป็นเครื่องมือเดียวที่ใช้ได้ในโหมดนี้) · ตกผ่าน challengeAllowsFill เป็น true
function challengeAllowsShape(room, color) {
  return challengeAllowsFill(room, color);
}

// "ใกล้แล้ว!" — ทายผิดแต่ห่างจากคำตอบแค่ 1–2 ตัวอักษร บอก "เฉพาะคนที่ทาย" ผ่าน socket ของเขาเอง
// ⚠️ ไม่มีคำตอบ/ส่วนของคำตอบใน event · ไม่ส่งถึงห้อง/คนวาด · จำกัด 3 ครั้งต่อ 15 วิ (rateOk) กันไล่เดาทีละตัว
const CLOSE_HINT_MAX = 3;
const CLOSE_HINT_WINDOW_MS = 15000;
function sendCloseHint(socket, text, word) {
  if (!answers.isClose(text, word)) return;
  if (!rateOk(socket, "close", CLOSE_HINT_MAX, CLOSE_HINT_WINDOW_MS)) return;
  socket.emit("close_guess", {});
}

// ══════════════════════════════════════════════════════════════════════
// จำกัดความถี่ (rate limit) — กันสคริปต์ยิง event รัว ๆ (ดู server/demo-attacks)
//
// วิธี: "sliding window" ต่อ socket · เก็บเวลาที่ event ถูกเรียกไว้ในลิสต์
// ถ้าในช่วงเวลา windowMs ที่ผ่านมามีเกิน max ครั้ง = เกินโควตา (คืน false)
// ตั้งเพดานให้ "สูงกว่าที่คนเล่นจริงทำได้" แต่ "ต่ำกว่าที่สคริปต์ยิงรัว ๆ ทำ" มาก
// - guess: คนเล่นจริงพิมพ์ทายเร็วสุดก็ไม่กี่คำต่อวินาที แต่สคริปต์ยิงทั้งคลัง 130 คำรวด
// - การเดารหัสห้อง (join_room/rejoin): คนพิมพ์รหัสผิดไม่กี่ครั้ง แต่สคริปต์สแกนหลายพันรหัส/วินาที
// ══════════════════════════════════════════════════════════════════════
const GUESS_MAX = 10;        // ทายได้ไม่เกิน 10 ครั้ง
const GUESS_WINDOW_MS = 5000; // ต่อ 5 วินาที (= เฉลี่ย 2 ครั้ง/วินาที · เผื่อ burst 10 ครั้งรวด)
const LOOKUP_MAX = 15;        // ค้นหา/เข้าห้อง (join_room + rejoin) ได้ไม่เกิน 15 ครั้ง
const LOOKUP_WINDOW_MS = 10000; // ต่อ 10 วินาที (คนพิมพ์รหัสผิดไม่ถึง · สแกนรหัสชนทันที)
const NAME_CHECK_MAX = 15;
const NAME_CHECK_WINDOW_MS = 10000;

function rateOk(socket, key, max, windowMs) {
  const now = Date.now();
  const store = (socket.data.rate ??= {});
  const times = (store[key] ??= []);
  while (times.length && now - times[0] > windowMs) times.shift(); // ทิ้งเวลาที่พ้นหน้าต่างไปแล้ว
  if (times.length >= max) return false;
  times.push(now);
  return true;
}

// ตรวจชื่อเจ้าของก่อนเริ่มเล่น และจำกัดการไล่เดาชื่อ
function nameOwnerOk(socket, name, key) {
  if (!rateOk(socket, "name-check", NAME_CHECK_MAX, NAME_CHECK_WINDOW_MS)) return "TOO_MANY_ATTEMPTS";
  return leaderboard.canUseName(leaderboard.loadScores(), name, key) ? null : "NAME_OWNED";
}

// ══════════════════════════════════════════════════════════════════════
// การวาด (ข้อ 4) — รับจากคนวาด ส่งต่อให้คนอื่น เก็บไว้ให้คนเข้าห้องกลางตา และย้อนกลับได้
//
// หลักการเดียวกับทั้งไฟล์: server เป็นคนตัดสิน
//   - รับเฉพาะจาก "คนวาด" ของห้องนั้น และเฉพาะ "ช่วงวาด" เท่านั้น
//   - ข้อมูลผิดรูปแบบทิ้งเงียบ ๆ ไม่ตอบ error กลับ (คนโกงไม่ควรรู้ว่าเรากำลังเช็คอะไรอยู่)
//   - ส่งต่อด้วย socket.to(code) = ทุกคนในห้องยกเว้นคนวาด (เขาเห็นภาพของตัวเองอยู่แล้ว)
//
// ประวัติถูกเก็บเป็น "การกระทำ" (op) ไม่ใช่ event รายอัน
//   หนึ่งเส้น = stroke_start + stroke_points หลายอัน + stroke_end = 1 การกระทำ
//   หนึ่งครั้งเทสี = 1 การกระทำ · ล้างจอ 1 ครั้ง = 1 การกระทำ
// การแบ่งแบบนี้ทำให้ "ย้อนกลับหนึ่งครั้ง" = ถอยหนึ่งเส้น ไม่ใช่ถอยทีละจุด
// (ผู้ใช้กดย้อนครั้งเดียวต้องได้ผลอย่างที่ตาเห็น ไม่ใช่ต้องกด 40 ครั้ง)
//
// สองช่องที่ดูคล้ายกันแต่คนละเรื่อง อย่าสับสน
//   room.strokeOpen    = "ตอนนี้มีเส้นค้างอยู่ไหม"     → เรื่องของสัญญา ใช้ตัดสินว่าข้อความนี้ถูกต้องไหม
//   room.currentStroke = "เส้นนั้นถูกเก็บลงประวัติหรือยัง" → เรื่องของที่เก็บ (เป็น null ได้ทั้งที่ strokeOpen เป็น true)
// แยกกันเพราะตอนชนเพดาน เราหยุด "เก็บ" แต่ยัง "ส่งต่อ" ให้ทุกคนตามปกติ
// ถ้าใช้ช่องเดียว ชนเพดานเมื่อไหร่จุดที่เหลือของเส้นนั้นจะถูกทิ้งไปด้วย ทั้งที่ควรส่งถึงเพื่อนร่วมห้อง
// ══════════════════════════════════════════════════════════════════════

// เพดานค่าต่าง ๆ ของการวาด
// SIZE_MIN/SIZE_MAX ต้องตรงกับ client/src/canvas/palette.js แต่คนละโปรเซสกัน
// จึง import หากันไม่ได้ ต้องประกาศซ้ำ — ถ้าวันหนึ่งแก้ ต้องแก้ทั้งสองที่
const SIZE_MIN = 2;
const SIZE_MAX = 40;
const VALID_TOOLS = ["pen", "eraser"];
const VALID_SHAPES = ["line", "rect", "circle"]; // รูปทรงที่ draw_shape รับ (ดู events.md หัวข้อ 4)
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const MAX_POINTS_PER_MSG = 500; // จุดสูงสุดในหนึ่งข้อความ stroke_points
const MAX_CANVAS_EVENTS = 4000; // action สูงสุดที่เก็บไว้ต่อตา
const MAX_CANVAS_POINTS = 30000; // จุดรวมสูงสุดที่เก็บไว้ต่อตา
// เพดานสองตัวนี้ตั้งเผื่อไว้ราว 5-7 เท่าของที่ใช้จริงในตาหนึ่ง
// (ตาละ 60 วิ ส่งทุก 40ms = ไม่เกิน 1500 ข้อความ และกรองจุดซ้ำแล้วเหลือราว 3000-6000 จุด)
// มีไว้กันหน่วยความจำบวมเท่านั้น ไม่ได้ตั้งใจให้ชนในการเล่นปกติ

const isUnit = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const isColor = (v) => typeof v === "string" && COLOR_RE.test(v);
const isSize = (v) => typeof v === "number" && Number.isFinite(v) && v >= SIZE_MIN && v <= SIZE_MAX;

// คืนห้อง ถ้าคนนี้เป็น "คนวาด" ของห้องที่กำลังวาดอยู่ตอนนี้ ไม่งั้นคืน null
// รวมการเช็คสิทธิ์และช่วงเวลาไว้ที่เดียว ทุก handler ของการวาดเรียกฟังก์ชันนี้
function drawRoom(socket) {
  const room = rooms.get(socket.data.roomCode);
  if (!room || room.phase !== "drawing" || room.intro) return null; // ช่วงป้ายใหญ่ห้ามวาด
  // โหมดทีม: คืน "เลน" ของทีมที่คนนี้เป็นคนวาด — ทุก handler จึงเขียน/ส่งต่อเฉพาะในทีมนั้น (lane.code = 48213:A)
  if (isTeamMode(room)) {
    const lane = laneOfDrawer(room, socket.data.pid);
    return lane && !lane.skipped ? lane : null;
  }
  if (room.drawerId !== socket.data.pid) return null;
  return room;
}

// ตรวจก้อนจุดของ stroke_points — คืนลิสต์ที่สะอาดแล้ว หรือ null ถ้าข้อมูลผิด
function cleanPoints(data) {
  if (!data || typeof data !== "object") return null;
  const list = data.points;
  if (!Array.isArray(list) || list.length === 0) return null;
  if (list.length > MAX_POINTS_PER_MSG) return null;

  const out = [];
  for (const p of list) {
    if (!p || typeof p !== "object") return null;
    if (!isUnit(p.x) || !isUnit(p.y)) return null;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

// กรอง "จุดซ้ำตำแหน่งเดิม" ทิ้ง
//
// ทำไมต้องมีทั้งที่ฝั่ง client กรองไปแล้ว: client กรองที่เกณฑ์ 1 พิกเซล ซึ่งต้องรู้ขนาดจอบนเครื่องนั้น
// server ไม่มีจอ จึงเทียบแบบนั้นไม่ได้ แต่จุดที่ "ซ้ำเป๊ะ" กรองได้ทุกจอ และเป็นตัวที่ทำให้เส้นเหลี่ยมจริง
// (ดูคำอธิบายเต็มใน client/src/components/Canvas.jsx) — ฝั่งรับจึงได้เส้นเรียบเหมือนฝั่งวาดแน่นอน
function dedupePoints(room, points) {
  const out = [];
  let last = room.lastPoint;
  for (const p of points) {
    if (last && p.x === last.x && p.y === last.y) continue;
    out.push(p);
    last = p;
  }
  room.lastPoint = last;
  return out;
}

// นับจำนวนจุดในหนึ่งการกระทำ — จุดคือสิ่งที่กินหน่วยความจำมากที่สุดในประวัติ
function countPoints(op) {
  let n = 0;
  for (const ev of op.events) if (ev.type === "stroke_points") n += ev.points.length;
  return n;
}

// ชนเพดานแล้ว — หยุดเก็บประวัติต่อในตานี้ (เตือนครั้งเดียวต่อห้อง)
// ยัง "ส่งต่อ" ให้ทุกคนตามปกติ เกมจึงไม่สะดุด สิ่งที่เสียไปคือคนที่เข้าห้องกลางตาหลังจุดนี้จะเห็นภาพไม่ครบ
function freezeCanvas(room) {
  if (room.canvasFrozen) return;
  room.canvasFrozen = true;

  // ปิดเส้นที่ค้างอยู่ให้เรียบร้อยก่อนทิ้ง ไม่งั้นประวัติจะจบด้วยเส้นที่ไม่มี stroke_end
  // ตอนวาดซ้ำจากประวัติ ปลายเส้นจะไม่ถูกปิดให้ (ดู endStroke ใน painter.js)
  // เส้นนี้ยังถูก "ส่งต่อ" ให้ทุกคนตามปกติ — ที่หยุดคือการเก็บลงประวัติเท่านั้น
  const last = room.currentStroke?.events[room.currentStroke.events.length - 1];
  if (room.currentStroke && last.type !== "stroke_end") {
    room.currentStroke.events.push({ type: "stroke_end" });
    room.canvasEvents++;
  }
  room.currentStroke = null; // ไม่มีเส้นไหนถูกเก็บอีกแล้วในตานี้

  console.warn(
    `⚠️  ห้อง ${room.code}: ประวัติการวาดตานี้ชนเพดาน (${MAX_CANVAS_EVENTS} action / ${MAX_CANVAS_POINTS} จุด) — หยุดเก็บเพิ่ม`
  );
}

// เก็บ action ลงประวัติเป็นส่วนหนึ่งของการกระทำ (คืน true ถ้าเก็บได้จริง)
function storeAction(room, type, payload) {
  if (room.canvasFrozen) return false;

  // จุดที่ตามมา ต่อเข้ากับเส้นที่ค้างอยู่ ไม่นับเป็นการกระทำใหม่
  if (type === "stroke_points") {
    if (!room.currentStroke) return false;
    const cost = payload.points.length;
    if (room.canvasEvents + 1 > MAX_CANVAS_EVENTS || room.canvasPoints + cost > MAX_CANVAS_POINTS) {
      freezeCanvas(room);
      return false;
    }
    room.currentStroke.events.push({ type, points: payload.points });
    room.canvasEvents++;
    room.canvasPoints += cost;
    return true;
  }

  if (type === "stroke_end") {
    if (!room.currentStroke) return false;
    room.currentStroke.events.push({ type });
    room.canvasEvents++;
    room.currentStroke = null;
    return true;
  }

  // stroke_start / fill / draw_shape / clear_canvas — ขึ้นต้นการกระทำใหม่หนึ่งอัน
  const op = { events: [{ type, ...payload }] };
  if (room.canvasEvents + op.events.length > MAX_CANVAS_EVENTS) {
    freezeCanvas(room);
    return false;
  }
  room.canvasOps.push(op);
  room.canvasEvents += op.events.length;
  room.canvasPoints += countPoints(op);
  room.redoOps = []; // วาดใหม่หลังย้อน = กองทำซ้ำหายทั้งกอง เหมือนโปรแกรมวาดรูปทั่วไป
  if (type === "stroke_start") room.currentStroke = op;
  return true;
}

// ย้อนหนึ่งการกระทำ — คืน true ถ้าย้อนจริง
function undoCanvas(room) {
  // ยังลากเส้นค้างอยู่ ย้อนไม่ได้ เพราะลำดับจะเพี้ยน (ให้ปล่อยมือก่อนแล้วกดใหม่)
  if (room.strokeOpen || room.canvasOps.length === 0) return false;
  const op = room.canvasOps.pop();
  room.canvasEvents -= op.events.length;
  room.canvasPoints -= countPoints(op);
  room.redoOps.push(op);
  return true;
}

function redoCanvas(room) {
  if (room.strokeOpen || room.redoOps.length === 0) return false;
  const op = room.redoOps.pop();
  room.canvasOps.push(op);
  room.canvasEvents += op.events.length;
  room.canvasPoints += countPoints(op);
  return true;
}

// "ภาพปัจจุบันทั้งชุด" + สถานะปุ่มย้อน/ทำซ้ำ
//
// ทำไมส่งทั้งชุดไม่ส่งแค่ส่วนต่าง: ย้อน/ทำซ้ำเป็นเรื่องที่เกิดไม่บ่อย (คนกดปุ่ม)
// แต่ต้อง "ถูกเป๊ะ" ทุกจอ การส่งภาพทั้งชุดทำให้ทุกคนได้ผลเหมือนกันโดยไม่มีทางเพี้ยน
// และคนที่เข้าห้องกลางตาทีหลังก็ได้ภาพหลังย้อนแล้วทันทีโดยไม่ต้องมีโค้ดพิเศษอะไรเลย
function canvasPayload(room) {
  const items = [];
  for (const op of room.canvasOps) items.push(...op.events);
  return { items, canUndo: room.canvasOps.length > 0, canRedo: room.redoOps.length > 0 };
}

// ล้างประวัติทั้งก้อน — เรียกตอนขึ้นตาใหม่ (events.md หัวข้อ 4)
function resetCanvas(room) {
  room.canvasOps = [];
  room.redoOps = [];
  room.currentStroke = null;
  room.strokeOpen = false;
  room.lastPoint = null;
  room.canvasEvents = 0;
  room.canvasPoints = 0;
  room.canvasFrozen = false;
}

// ---------- ตัวจับเวลา ----------
function stopTimer(room) {
  clearInterval(room.timer);
  room.timer = null;
  clearTimeout(room.introTimer); // ตาจบ/ห้องว่างระหว่างป้ายใหญ่ → เลิกรอ ไม่ให้ไปเริ่มเวลาตาที่จบแล้ว
  room.introTimer = null;
  room.intro = false;
}

function startTimer(room, seconds, onEnd) {
  stopTimer(room);
  room.timeLeft = seconds;
  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit("timer", { timeLeft: room.timeLeft });
    // ถึงเวลาที่คำใบ้ควรเปิดเองแล้ว (เหลือหนึ่งในสามของเวลาเต็ม) — เปิดให้ทั้งห้อง
    // ถ้าคนวาดกดขอไปก่อนหน้านี้แล้ว revealHint จะไม่ทำอะไร (มี hintOpen กันอยู่)
    if (room.timeLeft <= hintAt(room)) {
      // โหมดทีม: เปิดคำใบ้แยกเลน (ส่งถึงแค่ทีมนั้น) · classic เปิดทั้งห้องเหมือนเดิม
      for (const target of isTeamMode(room) ? laneList(room).filter((l) => !l.skipped) : [room]) revealHint(target, "timer");
    }
    if (room.timeLeft <= 0) {
      stopTimer(room);
      onEnd();
    }
  }, 1000);
}

// ---------- ขั้นตอนของเกม ----------
function nextTurn(room) {
  if (!rooms.has(room.code) || room.status !== "playing") return;
  if (isTeamMode(room)) return nextTeamTurn(room);
  if (room.turnIndex >= room.turnOrder.length) {
    room.round++;
    room.turnIndex = 0;
    room.turnOrder = room.players.map((p) => p.id);
  }
  if (room.round > room.settings.rounds) return endGame(room);

  room.drawerId = room.turnOrder[room.turnIndex];
  room.turnIndex++;
  // ข้ามคนที่ออกไปแล้ว และคนที่หลุดอยู่ (ยังอยู่ในช่วงรอกลับมา) — ไม่งั้นทั้งห้องต้องนั่งดูกระดานเปล่าทั้งตา
  const nextDrawer = room.players.find((p) => p.id === room.drawerId);
  if (!nextDrawer || nextDrawer.connected === false) return nextTurn(room);

  room.phase = "choosing";
  room.wordOptions = pickWords(3, room.settings.difficulty);
  // บอกคนวาดก่อนเลือกคำว่าตานี้มี Mini Challenge อะไร (ส่งถึงคนวาดคนเดียว)
  io.to(room.drawerId).emit("choose_word", { options: room.wordOptions, time: 10, challenge: rollChallenge(room) });
  room.chooseEndsAt = Date.now() + CHOOSE_MS;
  room.chooseTimeout = setTimeout(() => startDrawing(room, room.wordOptions[0]), CHOOSE_MS);
}

function startDrawing(room, word) {
  clearTimeout(room.chooseTimeout);
  room.phase = "drawing";
  room.word = word;
  room.guessedIds = new Set();
  room.roundGains = {};
  // ตาใหม่ = คำใบ้ยังไม่เปิด (ต้องรีเซ็ตก่อนส่ง round_start เสมอ ไม่งั้นตาถัดไปจะได้คำใบ้ฟรี)
  room.hintOpen = false;
  // ตาใหม่ = สุ่ม Mini Challenge ใหม่ และปลดล็อกปากกากลับเป็นปกติ
  // (ต้องตั้งก่อน emit round_start เสมอ เพราะค่านี้ติดไปกับ round_start ของตานี้เลย)
  room.challenge = room.nextChallenge ?? { type: "none" }; // สุ่มไว้ตั้งแต่ขึ้นตา (rollChallenge) คนวาดรู้แล้วตอนเลือกคำ
  const introMs = introMsFor(room.challenge);
  room.intro = introMs > 0; // ตั้งก่อน emit เพราะ roundInfo อ่านค่านี้
  room.penUsed = false;
  resetCanvas(room); // ขึ้นตาใหม่ = กระดานว่าง ประวัติตาที่แล้วทิ้งทั้งหมด

  room.timeLeft = room.settings.drawTime;
  io.to(room.code).emit("round_start", roundInfo(room));
  io.to(room.drawerId).emit("your_word", { word });

  beginDrawing(room, introMs, () => endRound(room));
}

// คนที่จะวาดต่อจากตานี้ — ให้ client โชว์ป้าย "วาดคนถัดไป" (client เดาเองไม่ได้ เพราะ turnOrder อยู่ที่ server)
// หาคนถัดไปในรอบนี้ที่ยังอยู่ในห้อง ถ้าหมดแล้วและยังมีรอบต่อไป = คนแรกของรอบหน้า ไม่มีแล้ว = null (ตานี้คือตาสุดท้าย)
// เป็นค่า "คาดการณ์" ณ ต้นตา: ถ้ามีคนเข้า/ออกระหว่างตา ตัวจริงอาจเปลี่ยน client จึงเช็คว่ายังอยู่ในห้องก่อนโชว์
function nextDrawerId(room) {
  const alive = new Set(room.players.map((p) => p.id));
  const inRound = room.turnOrder.slice(room.turnIndex).find((id) => alive.has(id));
  if (inRound) return inRound;
  if (room.round + 1 > room.settings.rounds) return null;
  return room.players[0]?.id ?? null;
}

function roundInfo(room) {
  return {
    round: room.round,
    totalRounds: room.settings.rounds,
    drawerId: room.drawerId,
    nextDrawerId: nextDrawerId(room),
    // คำใบ้เป็น null จนกว่าจะเปิด (คนวาดกดขอ หรือเวลาเหลือหนึ่งในสาม)
    // คนที่เข้าห้องกลางตาหลังเปิดแล้วจะได้ชุดช่องจริงไปเลย ไม่ใช่ null
    hint: room.hintOpen && room.word ? makeHint(room.word) : null,
    hintAt: hintAt(room), // เปิดเองเมื่อเวลาเหลือเท่านี้ — client ใช้โชว์ "คำใบ้จะขึ้นเมื่อเหลือ X วิ"
    time: room.timeLeft,
    // Mini Challenge ของตานี้ (ข้อ 5) — ติดไปกับ round_start ด้วย
    // คนที่เข้าห้องกลางตาจึงเห็นป้ายเหมือนคนที่อยู่ในห้องตั้งแต่แรก โดยไม่ต้องมีโค้ดพิเศษ
    challenge: room.challenge ?? { type: "none" },
    // true = ตอนนี้อยู่ช่วงป้ายใหญ่ (ยังห้ามวาด เวลายังไม่เดิน) จนกว่าจะได้ intro_end
    intro: Boolean(room.intro),
    // ส่งแค่ "id" ของคนที่ทายถูกแล้ว ไม่มีคำตอบหรืออะไรที่บอกคำปนมาด้วย
    // มีไว้ให้คนที่เข้าห้องกลางตาเห็นติ๊กถูกของคนที่ทายไปก่อนหน้า (งานค้างจากข้อ 2)
    guessedIds: [...room.guessedIds],
  };
}

function endRound(room) {
  stopTimer(room);
  room.phase = "between";
  // ตัดจบเส้นที่ค้างอยู่ (คนวาดอาจปล่อยมือไม่ทันตอนหมดเวลา)
  // ปิดแบบไม่เก็บ stroke_end เพิ่ม เพราะประวัติจะถูกล้างทั้งก้อนตอนขึ้นตาใหม่อยู่แล้ว
  room.strokeOpen = false;
  room.currentStroke = null;
  for (const lane of laneList(room)) {
    lane.strokeOpen = false;
    lane.currentStroke = null;
  }
  const results = Object.entries(room.roundGains).map(([playerId, gained]) => ({ playerId, gained }));
  const ended = { word: room.word, results };
  if (isTeamMode(room)) {
    // เฉลยตอนจบตาได้แล้ว · firstTeam = ทีมที่ทายถูกก่อน (null = ไม่มีใครทายถูก)
    ended.teamGained = Object.fromEntries(activeTeams(room).map((t) => [t, 0]));
    for (const p of room.players) if (p.team in ended.teamGained) ended.teamGained[p.team] += room.roundGains[p.id] || 0;
    ended.firstTeam = activeTeams(room).find((t) => room.teams[t].rank === 1) ?? null;
  }
  io.to(room.code).emit("round_end", ended);
  room.word = null;
  io.to(room.code).emit("room_update", roomState(room));
  setTimeout(() => nextTurn(room), 3000);
}

function endGame(room) {
  stopTimer(room);
  clearTimeout(room.chooseTimeout);
  room.status = "ended";
  room.phase = null;
  const ranking = [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => ({ playerId: p.id, name: p.name, score: p.score }));
  const ended = { ranking };
  if (isTeamMode(room)) {
    const scores = teamScores(room);
    ended.teamRanking = activeTeams(room).map((team) => ({ team, score: scores[team] })).sort((a, b) => b.score - a.score);
    // ผู้ชนะ = ทีมคะแนนสูงสุด · ถ้าอันดับ 1 คะแนนเท่ากันตั้งแต่สองทีมขึ้นไป = เสมอ (null)
    ended.winner = ended.teamRanking.length > 1 && ended.teamRanking[0].score === ended.teamRanking[1].score ? null : ended.teamRanking[0].team;
  }
  room.lastEnded = ended; // คนที่รีเฟรชหลังจบเกมจะได้ผลนี้อีกครั้งตอน rejoin
  // บันทึกคะแนนของทุกคนลงกระดาน "เล่นกับเพื่อน" — server บันทึกเอง client ส่งคะแนนมาไม่ได้
  // คนที่ได้ 0 ไม่บันทึก (ไม่ได้เล่นจริง) · saveScore ไม่ throw จึงไม่ทำให้จบเกมพัง
  for (const p of room.players) {
    if (p.score > 0) leaderboard.saveScore({ name: p.name, score: p.score, levelReached: 0, board: "multi", avatar: p.avatar, nameOwnerKey: room.nameOwnerKeys?.get(p.id) });
  }
  io.to(room.code).emit("game_end", ended);
  io.to(room.code).emit("room_update", roomState(room));
}

// ตรวจและใส่ค่าตั้งค่าห้อง (rounds drawTime mode) — ใช้ร่วมกันระหว่าง create_room กับ update_settings
// ค่าที่ไม่อยู่ในรายการที่อนุญาตถูกเมินเงียบๆ (คงค่าเดิม)
function applySettings(room, data) {
  const rounds = Number(data?.rounds);
  const drawTime = Number(data?.drawTime);
  if ([1, 2, 3, 4, 5].includes(rounds)) room.settings.rounds = rounds;
  if ([30, 45, 60, 90].includes(drawTime)) room.settings.drawTime = drawTime;
  if (LEVELS.includes(data?.difficulty)) room.settings.difficulty = data.difficulty; // ระดับของ "ชุดคำ" เท่านั้น ไม่เกี่ยวกับเวลา
  if (data?.visibility === "public" || data?.visibility === "private") room.settings.visibility = data.visibility;
  // ชุดกติกาที่เปิด (ใบไหนบ้าง) · รองรับค่าเดิม challenge: boolean ไว้ด้วย (true = ชุดเริ่มต้น · false = เปิดแค่ Standard)
  const sc = sanitizeChallenges(data?.challenges);
  if (sc) room.settings.challenges = sc;
  else if (data?.challenge === false) room.settings.challenges = ["none"];
  else if (data?.challenge === true) room.settings.challenges = [...DEFAULT_CHALLENGES];
  // จำนวนผู้เล่นสูงสุดของห้อง (2–8) · ตั้งต่ำกว่าคนที่อยู่ในห้องตอนนี้ไม่ได้ (ไม่เตะใคร) → เมินเงียบ ๆ
  const maxPlayers = Number(data?.maxPlayers);
  if (Number.isInteger(maxPlayers) && maxPlayers >= MIN_ROOM_PLAYERS && maxPlayers <= MAX_PLAYERS && maxPlayers >= room.players.length) {
    room.settings.maxPlayers = maxPlayers;
  }
  // จำนวนทีมในโหมดทีม (2 / 3 / 4) · ค่าอื่นเมินเงียบ ๆ · เปลี่ยนแล้วต้องจัดคนใหม่ให้พอดีจำนวนทีม
  const teams = Number(data?.teams);
  const teamsChanged = TEAM_COUNTS.includes(teams) && teams !== (room.settings.teams ?? DEFAULT_TEAMS);
  if (TEAM_COUNTS.includes(teams)) room.settings.teams = teams;
  if ((data?.mode === "classic" || data?.mode === "team") && room.settings.mode !== data.mode) {
    room.settings.mode = data.mode;
    applyMode(room);
  } else if (isTeamMode(room) && teamsChanged) {
    balanceRoomTeams(room, false); // คงลำดับเดิม ไม่สุ่ม (กดจัดทีมให้สมดุลเองถ้าอยากสุ่ม)
  }
}

// ---------- ออกจากห้อง · หลุด · กลับเข้าห้องเดิม (rejoin) ----------
// ออกเอง (leave_room) = ลบออกจากห้องทันที
// หลุด (ปิดแท็บ รีเฟรช เน็ตหลุด) = ยังไม่ลบ รอ REJOIN_GRACE_MS ก่อน เผื่อเขากลับมา (รีเฟรชใช้เวลาแค่ 1–2 วิ)
//   ระหว่างรอ ผู้เล่นยังอยู่ในห้องครบ (คะแนน ทีม คิววาด) แค่ถูกทำเครื่องหมาย connected: false ให้เพื่อนเห็น
//   กลับมาทัน (event rejoin) = ยกเลิกตัวจับเวลา เล่นต่อได้เลย · ไม่ทัน = ลบออกเหมือนออกเอง
// REJOIN_GRACE_MS เป็น env ไว้ให้เทสย่อเวลาเท่านั้น
const REJOIN_GRACE_MS = process.env.REJOIN_GRACE_MS !== undefined ? Number(process.env.REJOIN_GRACE_MS) : 30000;

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  socket.data.roomCode = null;
  const room = rooms.get(code);
  if (room) removePlayer(room, socket.data.pid);
}

// ผู้เล่นคนนี้ยังมี socket ต่ออยู่ไหม (ห้องส่วนตัวชื่อ playerId ยังมีสมาชิก = ยังต่ออยู่)
const isOnline = (pid) => (io.sockets.adapter.rooms.get(pid)?.size ?? 0) > 0;

function cancelDrop(room, pid) {
  clearTimeout(room.dropTimers?.get(pid));
  room.dropTimers?.delete(pid);
}

// socket หลุด: มีตัวตนถาวร → รอให้กลับมา · ไม่มี (ไม่ได้ส่ง playerKey) → กลับมาไม่ได้อยู่แล้ว ลบทันทีเหมือนเดิม
function handleDisconnect(socket) {
  const code = socket.data.roomCode;
  const pid = socket.data.pid;
  if (!code) return;
  socket.data.roomCode = null;
  const room = rooms.get(code);
  const player = room?.players.find((p) => p.id === pid);
  if (!player) return;
  if (isOnline(pid)) return; // socket ตัวใหม่ของคนเดียวกันต่อเข้ามาแล้ว (รีเฟรชเร็ว) ไม่ถือว่าหลุด
  if (!socket.data.persistent || REJOIN_GRACE_MS <= 0) return removePlayer(room, pid);

  player.connected = false;
  io.to(code).emit("room_update", roomState(room));
  room.dropTimers ??= new Map();
  cancelDrop(room, pid);
  room.dropTimers.set(
    pid,
    setTimeout(() => {
      room.dropTimers.delete(pid);
      if (rooms.get(code) === room && !isOnline(pid)) removePlayer(room, pid);
    }, REJOIN_GRACE_MS)
  );
}

// ส่งสถานะเกมปัจจุบันทั้งหมดให้ socket ที่เพิ่งเข้ามากลางเกม (คนเข้าใหม่ และคนที่ rejoin ใช้ชุดเดียวกัน)
// ลำดับสำคัญ: game_started → round_start → canvas_history (จอต้องล้างกระดานก่อนรับภาพ ไม่งั้นภาพที่เพิ่งได้จะถูกล้างทิ้ง)
function sendGameState(socket, room, player) {
  if (room.status === "ended") {
    if (room.lastEnded) socket.emit("game_end", room.lastEnded);
    return;
  }
  if (room.status !== "playing") return;
  socket.emit("game_started", { mode: room.settings.mode, totalRounds: room.settings.rounds });
  const lane = isTeamMode(room) ? room.teams?.[player.team] : null;
  const board = isTeamMode(room) ? lane : room; // โหมดทีม: เห็นเฉพาะภาพของทีมตัวเอง
  const drawerId = isTeamMode(room) ? lane?.drawerId : room.drawerId;
  if (room.phase === "drawing" && board) {
    socket.emit("round_start", isTeamMode(room) ? teamRoundInfo(room, lane) : roundInfo(room));
    socket.emit("canvas_history", canvasPayload(board));
    // คนวาดที่กลับมา ต้องได้คำของตัวเองอีกครั้ง (ส่งถึงเขาคนเดียว) และรู้ถ้าปากกาถูกล็อกไปแล้ว
    if (drawerId === player.id && room.word) socket.emit("your_word", { word: room.word });
    if (board.penUsed) socket.emit("pen_locked", {});
  } else if (room.phase === "choosing" && drawerId === player.id) {
    // คนวาดรีเฟรชตอนกำลังเลือกคำ: ส่งตัวเลือกชุดเดิมพร้อมเวลาที่เหลือ
    const left = Math.max(1, Math.ceil((room.chooseEndsAt - Date.now()) / 1000));
    socket.emit("choose_word", { options: room.wordOptions, time: left, challenge: room.nextChallenge ?? { type: "none" } });
  }
}

// ลบผู้เล่นออกจากห้องจริงๆ (ออกเอง หรือหลุดเกินเวลารอ) แล้วจัดการผลที่ตามมา: ห้องว่าง ย้ายหัวห้อง คนวาดหาย
function removePlayer(room, pid) {
  const code = room.code;
  if (!room.players.some((p) => p.id === pid)) return;
  cancelDrop(room, pid);
  io.in(pid).socketsLeave([code, ...TEAM_IDS.map((t) => `${code}:${t}`)]);
  room.nameOwnerKeys?.delete(pid);
  room.players = room.players.filter((p) => p.id !== pid);

  if (room.players.length === 0) {
    for (const t of room.dropTimers?.values() ?? []) clearTimeout(t);
    stopTimer(room);
    clearTimeout(room.chooseTimeout);
    rooms.delete(code);
    return;
  }

  if (room.hostId === pid) {
    room.hostId = room.players[0].id;
    room.players[0].isHost = true;
  }

  if (room.status === "playing" && isTeamMode(room)) {
    // ทีมใดเหลือน้อยกว่า 2 คน เล่นต่อไม่ได้ (ไม่มีใครทาย) → จบเกม
    if (activeTeams(room).some((t) => teamCount(room, t) < TEAM_MIN_PLAYERS)) return endGame(room);
    const lane = laneOfDrawer(room, pid);
    if (lane && room.phase === "choosing") {
      // คนวาดของทีมหลุดตอนเลือกคำ: ทีมนั้นถูกข้ามตานี้ ถ้าไม่เหลือคนวาดเลยก็ข้ามทั้งตา
      lane.drawerId = null;
      lane.skipped = true;
      if (laneList(room).every((l) => l.skipped)) {
        clearTimeout(room.chooseTimeout);
        nextTurn(room);
      }
    } else if (lane && room.phase === "drawing") {
      // คนวาดของทีมหลุดกลางตา: ทีมนั้นเสียตานี้ (ไม่มีใครวาดให้ทาย) อีกทีมเล่นต่อได้
      lane.drawerId = null;
      lane.skipped = true;
      lane.done = true;
      // บอกทีมนั้นให้รู้ว่าตานี้ทีมเราไม่มีคนวาด (ส่งถึงแค่ทีมตัวเอง ไม่มีชื่อ ไม่มีคำ)
      io.to(lane.code).emit("team_skipped", { team: lane.team });
    }
    checkTeamRoundEnd(room); // คนทายหลุดก็ทำให้ทีมทายครบได้ จึงต้องเช็คเสมอ
  } else if (room.status === "playing") {
    if (room.players.length < 2) return endGame(room);
    if (room.drawerId === pid) {
      if (room.phase === "choosing") {
        clearTimeout(room.chooseTimeout);
        nextTurn(room);
      } else if (room.phase === "drawing") {
        endRound(room);
      }
    }
  }

  io.to(code).emit("room_update", roomState(room));
}

// ---------- Solo แข่งกับ AI (ข้อ 7) ----------
// สถานะเกมผูกกับ playerId (ไม่ใช่ socket) เก็บใน soloSessions → รีเฟรชหน้าแล้ว socket ตัวใหม่ขอกลับเข้าเกมเดิมได้ (ai_resume)
// ส่ง event ผ่าน io.to(playerId) (ห้องส่วนตัวที่ทุก socket ของคนนั้นเข้าอยู่แล้ว) ตัวจับเวลาที่ตั้งไว้จึงส่งถึง socket ตัวใหม่ได้เอง
// หลุดแล้ว: ตัวจับเวลาด่านเดินต่อ (หมดเวลายังนับ) · รอ REJOIN_GRACE_MS ไม่กลับมา = เลิกเกม ไม่บันทึกคะแนน
// ไม่มี playerKey (test.html / สคริปต์) กลับเข้าไม่ได้อยู่แล้ว จึงเลิกเกมทันทีที่หลุดเหมือนเดิม
// กติกาทั้งหมด (เวลา ชีวิต คะแนน) server คุมเอง client ส่งได้แค่ภาพ
const SOLO_LIVES = 3;
const SOLO_NEXT_DELAY_MS = Number(process.env.AI_NEXT_DELAY_MS) || 4000; // พักให้ดูผลก่อนขึ้นด่านถัดไป
const SOLO_TIME_OVERRIDE = Number(process.env.AI_TIME_OVERRIDE) || 0;     // ไว้ให้เทสย่อเวลาเท่านั้น
const SNAPSHOT_MIN_GAP_MS = 4000;     // ภาพถี่กว่านี้ทิ้งเงียบ ๆ (client ส่งทุก 5 วิ) กันเปลืองค่า API
const MAX_SNAPSHOT_CHARS = 600000;    // เพดานขนาดภาพ (ตัวอักษรของ data URL) · Socket.IO เองก็ตัดที่ ~1MB
// ช่วงสอง "ดูภาพแล้วทาย": เล่นซ้ำภาพที่คนจริงเคยวาด (Quick, Draw!) ให้จบภายในหนึ่งในหกของเวลา
// ★ ปรับความเร็วที่ AI วาดตรงนี้: เลขยิ่งน้อย = วาดจบเร็วขึ้น (เดิม 1/3 · ตอนนี้ 1/6 = เร็วขึ้น 2 เท่า)
const DRAW_BUDGET_RATIO = 1 / 6;
const DRAW_COLOR = "#000000";
const DRAW_SIZE = 4;
const GUESS_MIN_GAP_MS = 300;  // พิมพ์ทายถี่กว่านี้ทิ้งเงียบ ๆ
const MAX_GUESS_CHARS = 40;
const IMAGE_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const soloSessions = new Map(); // playerId → เกม Solo ที่ยังเล่นอยู่ (หรือเพิ่งจบ รอให้หน้าเว็บมารับผล)

// เวลาสั้นลงตามด่านเหมือนเดิม · ชุดคำ: ถ้าผู้เล่นเลือกระดับความยากไว้ใช้ระดับนั้นทั้งเกม ไม่เลือก = ไล่ตามด่านแบบเดิม
function soloConfig(solo) {
  const cfg = ai.levelConfig(solo.level);
  return solo.difficulty ? { ...cfg, difficulty: solo.difficulty } : cfg;
}

// ส่ง event ของ Solo ถึงผู้เล่นคนนี้ ไม่ว่าตอนนี้เขาต่ออยู่ด้วย socket ตัวไหน (หลุดอยู่ = ไม่มีใครรับ ก็หายไปเฉยๆ)
function emitSolo(solo, event, data) {
  io.to(solo.pid).emit(event, data);
}

// เลิกเกม (ไม่บันทึกคะแนน) แล้วลบออกจากที่เก็บ — ใช้ตอนกดออก · เริ่มเกมใหม่ทับ · รอเกินเวลา
function dropSolo(solo) {
  if (!solo) return;
  clearTimeout(solo.roundTimer);
  clearTimeout(solo.nextTimer);
  clearTimeout(solo.dropTimer);
  clearStrokeTimers(solo);
  solo.over = true;
  if (soloSessions.get(solo.pid) === solo) soloSessions.delete(solo.pid);
}

// socket นี้เลิก Solo ที่เล่นอยู่ (ทั้งที่ผูกกับ socket นี้ และที่ค้างอยู่ใต้ playerId เดียวกัน)
function stopSolo(socket) {
  dropSolo(socket.data.solo);
  dropSolo(soloSessions.get(socket.data.pid));
  socket.data.solo = null;
}

// socket หลุดระหว่างเล่น Solo: มี playerKey → พักเกมไว้รอกลับมา · ไม่มี → เลิกทันที (กลับมาไม่ได้อยู่แล้ว)
function suspendSolo(socket) {
  const solo = socket.data.solo;
  socket.data.solo = null;
  if (!solo || solo.over) return;
  if (!socket.data.persistent) return dropSolo(solo);
  if ((io.sockets.adapter.rooms.get(solo.pid)?.size ?? 0) > 0) return; // ยังมี socket อื่นของคนนี้ต่ออยู่
  clearTimeout(solo.dropTimer);
  solo.dropTimer = setTimeout(() => dropSolo(solo), REJOIN_GRACE_MS);
}

function clearStrokeTimers(solo) {
  for (const t of solo.strokeTimers || []) clearTimeout(t);
  solo.strokeTimers = [];
}

function startSoloRound(solo) {
  const cfg = soloConfig(solo);
  const time = SOLO_TIME_OVERRIDE || cfg.time;
  const word = ai.pickWord(ai.soloWords(WORD_BANK), cfg.difficulty, solo.usedWords);
  solo.usedWords.add(word);
  solo.word = word;
  solo.time = time;
  solo.startedAt = Date.now();
  solo.lastSnapshotAt = 0;
  solo.busy = false;
  solo.wrong = [];
  solo.guessLog = []; // คำที่ AI เดาในด่านนี้ (ส่งคืนตอน ai_resume)
  solo.drawing = true;
  solo.resting = false;
  solo.drawNext = aiDrawings.available(ai.soloWords(WORD_BANK), cfg.difficulty); // ด่านนี้จะมีช่องสองต่อท้ายไหม
  solo.roundId++;
  clearTimeout(solo.roundTimer);
  solo.roundTimer = setTimeout(() => endSoloRound(solo, false), time * 1000);
  // ส่งคำจริงให้ผู้เล่นได้เพราะเขาเป็นคนวาด · aiMode บอกว่าตอนนี้ AI จริงหรือจำลอง
  solo.roundInfo = { level: solo.level, word, time, lives: solo.lives, aiMode: ai.aiMode(), drawNext: solo.drawNext, difficulty: cfg.difficulty };
  emitSolo(solo, "ai_round_start", solo.roundInfo);
}

// ช่วงพักหลังจบช่วง: จำผลไว้ให้คนที่รีเฟรชระหว่างพักเห็นหน้าต่างสรุปเดิม
function startRest(solo, result, next) {
  solo.resting = true;
  solo.lastResult = result;
  solo.restUntil = Date.now() + SOLO_NEXT_DELAY_MS;
  solo.nextTimer = setTimeout(() => {
    if (solo.over) return;
    solo.resting = false;
    next();
  }, SOLO_NEXT_DELAY_MS);
}

function endSoloRound(solo, correct) {
  if (solo.over || !solo.drawing) return; // จบไปแล้ว (เช่น ทายถูกพร้อมเวลาหมด) ไม่นับซ้ำ
  solo.drawing = false;
  clearTimeout(solo.roundTimer);
  let gained = 0;
  if (correct) {
    const timeLeft = solo.time - (Date.now() - solo.startedAt) / 1000;
    gained = ai.scoreFor(timeLeft, solo.time);
    solo.totalScore += gained;
  } else {
    solo.lives--;
  }
  emitSolo(solo, "ai_round_end", { correct, gained, totalScore: solo.totalScore, lives: solo.lives });

  if (solo.lives <= 0) return endSoloGame(solo);
  solo.passed = correct; // ผ่านช่องแรกหรือไม่ — เอาไปตัดสินขึ้นด่านเมื่อจบช่องสอง (advanceSolo)
  // word ของช่วง 1 ผู้เล่นรู้อยู่แล้ว (เป็นคนวาดเอง) จึงเก็บไว้ในผลได้
  startRest(solo, { kind: "draw", correct, gained, word: solo.word }, () => {
    if (solo.drawNext) startDrawRound(solo);
    else advanceSolo(solo);
  });
}

// ผ่านช่องแรกถึงขึ้นด่าน · ทายไม่ออกเสียชีวิตแต่ยังอยู่ด่านเดิม (ได้คำใหม่) · แล้วเริ่มช่องแรกของด่านถัดไป
function advanceSolo(solo) {
  if (solo.over) return;
  if (solo.passed) solo.level++;
  startSoloRound(solo);
}

// ช่องสอง: server เล่นซ้ำภาพคนจริงทีละเส้น ผู้เล่นพิมพ์ทาย · server ตัดสินเอง
// ⚠️ ห้ามให้คำตอบ (ทั้งไทย/อังกฤษ) อยู่ใน event ใดก่อน ai_draw_end — ส่งได้แค่หมวดหมู่เป็นคำใบ้
function startDrawRound(solo) {
  const cfg = soloConfig(solo);
  const picked = aiDrawings.pick(ai.soloWords(WORD_BANK), cfg.difficulty, solo.usedWords);
  if (!picked) return advanceSolo(solo); // ไม่มีภาพ → ข้ามช่องสอง ไม่ล่ม
  const time = SOLO_TIME_OVERRIDE || cfg.time;
  solo.usedWords.add(picked.word);
  solo.guessWord = picked.word;
  solo.guessTime = time;
  solo.guessStartedAt = Date.now();
  solo.lastGuessAt = 0;
  solo.guessing = true;
  solo.sentStrokes = []; // เส้นที่ส่งไปแล้ว (ส่งคืนตอน ai_resume ภาพจะได้กลับมาครบ)
  solo.replies = [];     // คำที่ผู้เล่นทายผิดในช่วงนี้
  solo.roundId++;
  clearStrokeTimers(solo);
  clearTimeout(solo.roundTimer);
  solo.roundTimer = setTimeout(() => endDrawRound(solo, false), time * 1000);
  solo.watchInfo = { level: solo.level, time, lives: solo.lives, category: picked.category }; // ไม่มีคำตอบ
  emitSolo(solo, "ai_draw_start", solo.watchInfo);
  for (const s of aiDrawings.schedule(picked.strokes, time * 1000 * DRAW_BUDGET_RATIO)) {
    solo.strokeTimers.push(
      setTimeout(() => {
        if (!solo.over && solo.guessing) {
          const stroke = { points: s.points, color: DRAW_COLOR, size: DRAW_SIZE, ms: s.ms };
          solo.sentStrokes.push(stroke);
          emitSolo(solo, "ai_draw_stroke", stroke);
        }
      }, s.at)
    );
  }
}

function endDrawRound(solo, correct) {
  if (solo.over || !solo.guessing) return;
  solo.guessing = false;
  clearTimeout(solo.roundTimer);
  clearStrokeTimers(solo);
  let gained = 0;
  if (correct) {
    gained = ai.scoreFor(solo.guessTime - (Date.now() - solo.guessStartedAt) / 1000, solo.guessTime);
    solo.totalScore += gained;
  } else {
    solo.lives--;
  }
  // เฉลยคำตอบได้แล้ว เพราะช่องนี้จบแล้ว
  emitSolo(solo, "ai_draw_end", { correct, gained, totalScore: solo.totalScore, lives: solo.lives, word: solo.guessWord });
  if (solo.lives <= 0) return endSoloGame(solo);
  startRest(solo, { kind: "guess", correct, gained, word: solo.guessWord }, () => advanceSolo(solo));
}

function handleSoloGuess(socket, data) {
  const solo = socket.data.solo;
  if (!solo || !solo.guessing) return;
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text || text.length > MAX_GUESS_CHARS) return;
  const now = Date.now();
  if (now - solo.lastGuessAt < GUESS_MIN_GAP_MS) return;
  solo.lastGuessAt = now;
  if (answers.isCorrect(text, solo.guessWord)) return endDrawRound(solo, true);
  solo.replies.push(text);
  emitSolo(solo, "ai_draw_reply", { text, correct: false });
  sendCloseHint(socket, text, solo.guessWord);
}

// จบเกม: server บันทึกคะแนนเอง (client ส่งคะแนนมาไม่ได้) แล้วบอกอันดับ
// จบตามกติกา (ชีวิตหมด) ระหว่างที่หลุดอยู่ก็บันทึก เพราะเกมจบจริง · เก็บผลไว้ให้หน้าเว็บที่รีเฟรชมารับ (ai_resume) ภายในเวลารอ
function endSoloGame(solo) {
  const result = { name: solo.name, score: solo.totalScore, levelReached: solo.level };
  solo.over = true;
  solo.drawing = false;
  solo.guessing = false;
  solo.resting = false;
  clearTimeout(solo.roundTimer);
  clearTimeout(solo.nextTimer);
  clearStrokeTimers(solo);
  leaderboard.saveScore({ ...result, avatar: solo.avatar, nameOwnerKey: solo.nameOwnerKey });
  solo.final = { totalScore: result.score, levelReached: result.levelReached, rank: leaderboard.rankOf(result) };
  emitSolo(solo, "ai_game_end", solo.final);
  clearTimeout(solo.dropTimer);
  solo.dropTimer = setTimeout(() => { if (soloSessions.get(solo.pid) === solo) soloSessions.delete(solo.pid); }, REJOIN_GRACE_MS);
}

// สถานะปัจจุบันของเกม Solo สำหรับ ai_resume — ส่งเฉพาะสิ่งที่ผู้เล่นเคยได้รับอยู่แล้ว
// ⚠️ ช่วง 2 ที่ยังไม่จบ: ห้ามมี guessWord (มีแค่ category กับเส้นที่ส่งไปแล้ว) · มีเทสตรวจ
function soloSnapshot(solo) {
  const base = { level: solo.level, lives: solo.lives, totalScore: solo.totalScore };
  const left = (startedAt, time) => Math.max(0, Math.ceil(time - (Date.now() - startedAt) / 1000));
  if (solo.over) return { ...base, phase: "over", final: solo.final };
  if (solo.drawing) {
    return { ...base, phase: "draw", round: { ...solo.roundInfo, lives: solo.lives }, timeLeft: left(solo.startedAt, solo.time), guesses: solo.guessLog };
  }
  if (solo.guessing) {
    // round = ข้อมูลช่วง 1 ของด่านนี้ (คำของช่วง 1 ผู้เล่นวาดเองรู้อยู่แล้ว) ไว้โชว์เลขด่าน · ไม่มีคำตอบของภาพช่วง 2
    return { ...base, phase: "watch", round: solo.roundInfo, watch: { ...solo.watchInfo, lives: solo.lives }, timeLeft: left(solo.guessStartedAt, solo.guessTime), strokes: solo.sentStrokes, replies: solo.replies };
  }
  // ช่วงพัก: ผลของช่วงที่เพิ่งจบ (คำเฉลยถูกเปิดไปแล้วทั้งสองแบบ) · หลังช่วง 2 แนบเส้นของภาพนั้นไปด้วย
  const rest = { ...base, phase: "rest", round: solo.roundInfo, result: solo.lastResult, restLeft: Math.max(0, Math.ceil((solo.restUntil - Date.now()) / 1000)) };
  if (solo.lastResult?.kind === "guess") Object.assign(rest, { strokes: solo.sentStrokes, replies: solo.replies });
  else rest.guesses = solo.guessLog;
  return rest;
}

async function handleSoloSnapshot(socket, data) {
  const solo = socket.data.solo;
  if (!solo || !solo.drawing || solo.busy) return;
  const image = data?.image;
  if (typeof image !== "string" || image.length > MAX_SNAPSHOT_CHARS || !IMAGE_RE.test(image)) return;
  const now = Date.now();
  if (now - solo.lastSnapshotAt < SNAPSHOT_MIN_GAP_MS) return;
  solo.lastSnapshotAt = now;
  solo.busy = true; // ทีละภาพ ไม่ให้เรียก AI ซ้อนกัน
  const roundId = solo.roundId;
  try {
    const { guess, correct } = await ai.guessImage({
      image,
      word: solo.word,
      allWords: Object.values(ai.soloWords(WORD_BANK)).flat().map((w) => w.word),
      elapsed: (now - solo.startedAt) / 1000,
      time: solo.time,
      wrong: solo.wrong,
    });
    // รอ AI อยู่ระหว่างนั้นด่านอาจจบหรือผู้เล่นออกไปแล้ว ผลที่มาช้าต้องทิ้ง
    if (solo.over || !solo.drawing || solo.roundId !== roundId) return;
    if (!correct) solo.wrong.push(guess);
    solo.guessLog.push({ guess, correct });
    emitSolo(solo, "ai_guess", { guess, correct });
    if (correct) endSoloRound(solo, true);
  } catch (err) {
    // log แค่ข้อความ ไม่ log key หรือคำขอ
    console.warn("เรียก AI ไม่สำเร็จ:", err.message);
    if (!solo.over && solo.roundId === roundId) {
      emitSolo(solo, "game_error", { code: "AI_UNAVAILABLE", message: "AI ตอบไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง" });
    }
  } finally {
    if (solo.roundId === roundId) solo.busy = false;
  }
}

// พา socket ตัวใหม่ของผู้เล่นเดิมกลับเข้าห้อง — คืนคำตอบของ callback
// ผู้เล่นยังเป็นคนเดิมทุกอย่าง (id คะแนน ทีม หัวห้อง คิววาด) จึงไม่ต้องแก้ข้อมูลเกมเลย แค่ต่อ socket กลับเข้า room
function rejoinRoom(socket, room) {
  const player = room.players.find((p) => p.id === socket.data.pid);
  if (socket.data.roomCode && socket.data.roomCode !== room.code) leaveRoom(socket); // อยู่ห้องอื่นค้างไว้ ออกก่อน
  stopSolo(socket);
  cancelDrop(room, player.id);
  player.connected = true;
  socket.join(room.code);
  socket.data.roomCode = room.code;
  syncTeamRoom(room, player);
  io.to(room.code).emit("room_update", roomState(room));
  sendGameState(socket, room, player);
  return { ok: true, code: room.code, playerId: player.id, name: player.name, avatar: player.avatar };
}

// ---------- เมื่อมีผู้เล่นต่อเข้ามา ----------
io.on("connection", (socket) => {
  console.log("มีคนเชื่อมต่อเข้ามา:", socket.id);
  // ห้องส่วนตัวชื่อเดียวกับ playerId — io.to(playerId) จึงส่งถึงคนนั้นได้ไม่ว่า socket จะเปลี่ยนไปกี่ครั้ง
  socket.join(socket.data.pid);

  // ── ตัวดักข้อผิดพลาด (กัน server ล่มทั้งตัวเพราะ handler เดียวโยน error) ──
  // ครอบ "ทุก handler ของ socket นี้" ไว้ใน try/catch ที่เดียว โดยห่อ socket.on
  // ถ้า handler ใดโยน error (เช่นได้ข้อมูลผิดรูปแบบที่ไม่ได้เช็ค) จะ log ให้เห็นชัดแทนที่จะทำให้โปรเซสดับ
  // async handler (เช่น ai_snapshot) คืน Promise ด้วย จึงดัก .catch() เพิ่ม
  // ไม่พิมพ์เนื้อข้อมูลลง log (อาจมีคำตอบ/กุญแจ) พิมพ์แค่ชื่อ event · ห้อง · ผู้เล่น · ข้อความ error
  const rawOn = socket.on.bind(socket);
  socket.on = (event, handler) =>
    rawOn(event, function (...args) {
      const onErr = (err) => {
        console.error(
          `❌ handler "${event}" โยน error (ห้อง ${socket.data.roomCode ?? "-"} ผู้เล่น ${socket.data.pid}): ${err?.message || err}`
        );
        // ถ้ามี callback (อาร์กิวเมนต์สุดท้ายเป็นฟังก์ชัน) ตอบว่าเกิดข้อผิดพลาด ไม่ให้ client ค้างรอ
        const cb = args[args.length - 1];
        if (typeof cb === "function") {
          try { cb({ ok: false, error: "SERVER_ERROR" }); } catch {}
        }
      };
      try {
        const ret = handler.apply(this, args);
        if (ret && typeof ret.catch === "function") ret.catch(onErr);
        return ret;
      } catch (err) {
        onErr(err);
      }
    });

  socket.on("create_room", (data, callback) => {
    if (typeof callback !== "function") return;
    const name = cleanName(data?.name);
    if (!name) return callback({ ok: false, error: "INVALID_NAME" });
    if (!isNameAllowed(name)) return callback({ ok: false, error: "NAME_NOT_ALLOWED" });
    const nameError = nameOwnerOk(socket, name, data?.nameOwnerKey);
    if (nameError) return callback({ ok: false, error: nameError });

    leaveRoom(socket);

    const code = makeRoomCode();
    const room = {
      code,
      nameOwnerKeys: new Map(),
      hostId: socket.data.pid,
      status: "lobby",
      players: [{ id: socket.data.pid, name, avatar: cleanAvatar(data.avatar), score: 0, isHost: true, team: null, connected: true, ready: false }],
      settings: { mode: "classic", rounds: 3, drawTime: 60, difficulty: "easy", visibility: "private", maxPlayers: MAX_PLAYERS, teams: DEFAULT_TEAMS, challenges: [...DEFAULT_CHALLENGES] },
    };
    const ownerHash = hashOwnerKey(data?.nameOwnerKey);
    if (ownerHash) room.nameOwnerKeys.set(socket.data.pid, ownerHash);
    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;
    applySettings(room, data); // ค่าที่เลือกตั้งแต่หน้าแรก (โหมดทีม → หัวห้องเข้าทีม A และเข้า room ย่อยแล้ว)

    callback({ ok: true, code, playerId: socket.data.pid });
    io.to(code).emit("room_update", roomState(room));
  });

  socket.on("join_room", (data, callback) => {
    if (typeof callback !== "function") return;
    // จำกัดความถี่: กันสคริปต์ไล่เดารหัสห้อง (join_room กับ rejoin ใช้โควตาเดียวกัน)
    if (!rateOk(socket, "lookup", LOOKUP_MAX, LOOKUP_WINDOW_MS)) return callback({ ok: false, error: "TOO_MANY_ATTEMPTS" });
    const name = cleanName(data?.name);
    const code = String(data?.code ?? "");
    const room = rooms.get(code);

    if (!room) return callback({ ok: false, error: "ROOM_NOT_FOUND" });
    if (!name) return callback({ ok: false, error: "INVALID_NAME" });
    if (!isNameAllowed(name)) return callback({ ok: false, error: "NAME_NOT_ALLOWED" });
    const nameError = nameOwnerOk(socket, name, data?.nameOwnerKey);
    if (nameError) return callback({ ok: false, error: nameError });
    // เป็นสมาชิกห้องนี้อยู่แล้ว (เช่นรีเฟรชแล้วกดเข้าห้องเดิมภายในเวลารอ) = กลับเข้าที่เดิม ไม่สร้างผู้เล่นซ้ำ
    if (room.players.some((p) => p.id === socket.data.pid)) return callback(rejoinRoom(socket, room));
    if (room.players.length >= roomMax(room)) return callback({ ok: false, error: "ROOM_FULL" });
    // ชื่อซ้ำในห้อง เทียบแบบเดียวกับเจ้าของชื่อ (ไม่สนตัวพิมพ์ · อักขระล่องหน · ช่องว่างซ้อน) — "Tar" กับ "tar" นับเป็นชื่อเดียวกัน
    const key = normalizeOwnerName(name);
    if (room.players.some((p) => normalizeOwnerName(p.name) === key)) return callback({ ok: false, error: "NAME_TAKEN" });

    leaveRoom(socket);
    const joiner = { id: socket.data.pid, name, avatar: cleanAvatar(data.avatar), score: 0, isHost: false, team: null, connected: true, ready: false };
    const ownerHash = hashOwnerKey(data?.nameOwnerKey);
    if (ownerHash) (room.nameOwnerKeys ??= new Map()).set(socket.data.pid, ownerHash);
    if (isTeamMode(room)) joiner.team = autoTeam(room); // โหมดทีม: เข้าทีมที่คนน้อยกว่าอัตโนมัติ (รวมคนเข้ากลางเกม)
    room.players.push(joiner);
    socket.join(code);
    socket.data.roomCode = code;
    syncTeamRoom(room, joiner);
    callback({ ok: true, playerId: socket.data.pid });
    io.to(code).emit("room_update", roomState(room));
    if (room.status === "playing") {
      if (!isTeamMode(room)) room.turnOrder.push(socket.data.pid); // ต่อคิววาดท้ายรอบนี้
      sendGameState(socket, room, joiner);
    }
  });

  // rejoin: หน้าเว็บถูกรีเฟรช / เน็ตหลุดแล้วต่อใหม่ → ขอกลับเข้าห้องเดิมด้วยตัวตนเดิม (playerId จากกุญแจใน handshake)
  // server ส่งสถานะทั้งหมดกลับไป: ห้อง คะแนน รอบ เวลาที่เหลือ ภาพบนกระดาน คำของคนวาด
  socket.on("rejoin", (data, callback) => {
    if (typeof callback !== "function") return;
    // จำกัดความถี่: กันสคริปต์ไล่เดารหัสห้อง (ใช้โควตาเดียวกับ join_room)
    if (!rateOk(socket, "lookup", LOOKUP_MAX, LOOKUP_WINDOW_MS)) return callback({ ok: false, error: "TOO_MANY_ATTEMPTS" });
    const room = rooms.get(String(data?.code ?? ""));
    if (!room) return callback({ ok: false, error: "ROOM_NOT_FOUND" });
    if (!room.players.some((p) => p.id === socket.data.pid)) return callback({ ok: false, error: "NOT_IN_ROOM" });
    callback(rejoinRoom(socket, room));
  });


    socket.on("update_settings", (data) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status === "playing") return;
    if (room.hostId !== socket.data.pid) {
      return socket.emit("game_error", { code: "NOT_HOST", message: "เฉพาะหัวห้องเท่านั้น" });
    }
    applySettings(room, data);
    io.to(room.code).emit("room_update", roomState(room));
  });

  // เปิด/ปิด Mini Challenge ทีละใบ (ในห้องรอ) — หัวห้องเท่านั้น · ต้องเปิดอย่างน้อย 1 ใบ
  // ข้อมูลเพี้ยน/ว่าง (sanitize แล้วเหลือ 0 ใบ) = ทิ้งเงียบ ๆ (คงค่าเดิมไว้)
  socket.on("set_challenges", (data) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status === "playing") return;
    if (room.hostId !== socket.data.pid) {
      return socket.emit("game_error", { code: "NOT_HOST", message: "เฉพาะหัวห้องเท่านั้น" });
    }
    const sc = sanitizeChallenges(data?.challenges);
    if (!sc) return;
    room.settings.challenges = sc;
    io.to(room.code).emit("room_update", roomState(room));
  });

  // กดพร้อม/ไม่พร้อม (Ready) — ได้เฉพาะตอนไม่ได้เล่นอยู่ · หัวห้องไม่ต้องกด (client ไม่นับหัวห้องในเงื่อนไขเริ่มเกม)
  socket.on("set_ready", (data) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status === "playing") return;
    const player = room.players.find((p) => p.id === socket.data.pid);
    if (!player) return;
    player.ready = !!data?.ready;
    io.to(room.code).emit("room_update", roomState(room));
  });

  // เตะผู้เล่นออก — หัวห้องเท่านั้น (server ตรวจซ้ำเสมอ) · เตะตัวเองไม่ได้
  socket.on("kick_player", (data) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.hostId !== socket.data.pid) {
      return socket.emit("game_error", { code: "NOT_HOST", message: "เฉพาะหัวห้องเท่านั้น" });
    }
    const targetId = String(data?.playerId ?? "");
    if (!targetId || targetId === socket.data.pid) return;
    const target = room.players.find((p) => p.id === targetId);
    if (!target) return;
    // บอกทุก socket ของคนที่ถูกเตะให้กลับหน้าแรก (ส่งก่อนลบ ตอนเขายังอยู่ใน room จะได้รับแน่)
    io.to(targetId).emit("kicked", { code: room.code });
    // removePlayer ลบออกจากห้อง + ให้ socket ของเขา leave room (socketsLeave) + จัดการผลที่ตามมา
    // (ย้ายหัวห้อง · คนวาดหลุด · ห้องว่าง) เหมือนคนออกเอง
    // rejoin จะไม่ดึงเขากลับ เพราะเขาไม่ใช่สมาชิกแล้ว (rejoin ตอบ NOT_IN_ROOM) · จะเข้าใหม่ต้อง join_room ด้วยรหัสเอง
    removePlayer(room, targetId);
  });

  // เลือกทีม A–D ตามจำนวนทีมของห้อง (ตอนอยู่ในห้องรอ/จบเกม ไม่ใช่ตอนเล่น) — เฉพาะโหมดทีม
  socket.on("set_team", (data) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status === "playing" || !isTeamMode(room)) return;
    if (!activeTeams(room).includes(data?.team)) return;
    const player = room.players.find((p) => p.id === socket.data.pid);
    if (!player) return;
    if (player.team === data.team) return;
    // ทีมเต็มโควตา (ห้องรับกี่คน หารจำนวนทีม ปัดขึ้น) → ย้ายเข้าไม่ได้
    if (teamCount(room, data.team) >= teamCap(room)) {
      return socket.emit("game_error", { code: "TEAM_FULL", message: `ทีม ${data.team} เต็มแล้ว` });
    }
    player.team = data.team;
    syncTeamRoom(room, player);
    io.to(room.code).emit("room_update", roomState(room));
  });

  // จัดทีมให้สมดุลใหม่ — หัวห้องเท่านั้น · ไม่ได้เล่นอยู่ · เฉพาะโหมดทีม
  // (จำนวนคนต่างกันไม่เกิน 1 และคะแนนรวมสองทีมใกล้กัน · ถ้ายังไม่เคยเล่นก็คือสุ่มแบ่งเท่า ๆ กัน)
  socket.on("balance_teams", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status === "playing" || !isTeamMode(room)) return;
    if (room.hostId !== socket.data.pid) {
      return socket.emit("game_error", { code: "NOT_HOST", message: "เฉพาะหัวห้องเท่านั้น" });
    }
    balanceRoomTeams(room);
    io.to(room.code).emit("room_update", roomState(room));
  });

  socket.on("start_game", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status === "playing") return;
    if (room.hostId !== socket.data.pid) {
      return socket.emit("game_error", { code: "NOT_HOST", message: "เฉพาะหัวห้องเท่านั้นที่เริ่มเกมได้" });
    }
    if (room.players.length < 2) {
      return socket.emit("game_error", { code: "NOT_ENOUGH_PLAYERS", message: "ต้องมีอย่างน้อย 2 คน" });
    }

    // เล่นอีกรอบหลังจบเกม (ไม่มีหน้าห้องรอให้กดจัดทีม): ทีมเบี้ยวเพราะมีคนเข้า/ออก → จัดให้สมดุลเองด้วยคะแนนเกมที่เพิ่งจบ
    if (isTeamMode(room) && room.status === "ended" && !teamsBalanced(room)) balanceRoomTeams(room);
    if (isTeamMode(room) && activeTeams(room).some((t) => teamCount(room, t) < TEAM_MIN_PLAYERS)) {
      return socket.emit("game_error", {
        code: "NOT_ENOUGH_PLAYERS",
        message: `${activeTeams(room).length} ทีมต้องมีอย่างน้อย ${activeTeams(room).length * TEAM_MIN_PLAYERS} คน (ทีมละ ${TEAM_MIN_PLAYERS} คนขึ้นไป)`,
      });
    }
    if (isTeamMode(room) && !teamsBalanced(room)) {
      return socket.emit("game_error", {
        code: "TEAMS_UNBALANCED",
        message: `ทีมไม่สมดุล (${activeTeams(room).map((t) => `${t} ${teamCount(room, t)} คน`).join(" · ")}) แต่ละทีมต้องต่างกันไม่เกิน 1 คน กด "จัดทีมให้สมดุล" ก่อน`,
      });
    }
    room.status = "playing";
    room.players.forEach((p) => (p.score = 0));
    room.round = 1;
    room.turnOrder = room.players.map((p) => p.id);
    room.turnIndex = 0;
    room.challengeHistory = []; // เกมใหม่ (รวมเล่นอีกรอบ) = ตาแรกไม่มี Mini Challenge อีกครั้ง
    if (isTeamMode(room)) {
      // หนึ่งรอบ = ทีมที่ใหญ่กว่าวาดครบทุกคนหนึ่งรอบ (ทีมเล็กหมุนวนซ้ำ) · จำนวนตาทั้งเกมล็อกตอนเริ่ม
      room.teams = Object.fromEntries(activeTeams(room).map((t) => [t, newLane(room, t)]));
      room.teamPerRound = Math.max(...activeTeams(room).map((t) => teamCount(room, t)));
      room.teamTotalTurns = room.teamPerRound * room.settings.rounds;
      room.teamTurn = 0;
      room.drawerId = null; // โหมดทีมไม่ใช้ช่องนี้ (คนวาดอยู่ที่เลน)
    }

    io.to(room.code).emit("game_started", { mode: room.settings.mode, totalRounds: room.settings.rounds });
    io.to(room.code).emit("room_update", roomState(room));
    nextTurn(room);
  });

  socket.on("word_chosen", (data) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== "choosing") return;
    if (isTeamMode(room) ? !laneOfDrawer(room, socket.data.pid) : room.drawerId !== socket.data.pid) return;
    if (!room.wordOptions.includes(data?.word)) return;
    if (isTeamMode(room)) return startTeamDrawing(room, data.word);
    startDrawing(room, data.word);
  });

    socket.on("guess", (data) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.data.pid);
    const text = String(data?.text ?? "").trim().slice(0, 100);
    if (!player || !text) return;
    // จำกัดความถี่: ยิงทายรัว ๆ เกินเพดาน = ทิ้งเงียบ ๆ (เหมือน input ที่ไม่ผ่านกติกาอื่น ไม่บอกคนโกงว่าโดนดัก)
    if (!rateOk(socket, "guess", GUESS_MAX, GUESS_WINDOW_MS)) return;
    if (room.status === "playing" && isTeamMode(room)) return handleTeamGuess(socket, room, player, text);
    const msg = { playerId: socket.data.pid, name: player.name, text };

    // ไม่ได้อยู่ช่วงวาด คุยเล่นได้ปกติ
    if (room.phase !== "drawing" || room.intro) return io.to(room.code).emit("chat_message", msg);

    // ช่องโกง 1: คนวาดห้ามพิมพ์ระหว่างวาด
    if (socket.data.pid === room.drawerId) return;

    // ช่องโกง 2: คนที่ทายถูกแล้ว คุยได้แค่กับคนที่รู้คำตอบแล้ว
    if (room.guessedIds.has(socket.data.pid)) {
      for (const id of [room.drawerId, ...room.guessedIds]) {
        io.to(id).emit("chat_message", msg);
      }
      return;
    }

    // ทายถูก
    if (answers.isCorrect(text, room.word)) { // คำหลัก หรือคำที่นับว่าถูก (aliases · อังกฤษ · สะกดคล้าย)
      room.guessedIds.add(socket.data.pid);
      const gained = 50 + room.timeLeft * 5;
      player.score += gained;
      room.roundGains[socket.data.pid] = gained;

      const drawer = room.players.find((p) => p.id === room.drawerId);
      if (drawer) {
        drawer.score += 50;
        room.roundGains[drawer.id] = (room.roundGains[drawer.id] || 0) + 50;
      }

      // ช่องโกง 3 (ไอเดียเรา): คนทายเห็นคำตัวเอง คนอื่นเห็นเป็น ******
      socket.emit("chat_message", { ...msg, correct: true });
      socket.to(room.code).emit("chat_message", { ...msg, text: "******", correct: true });
      io.to(room.code).emit("correct_guess", { playerId: socket.data.pid, name: player.name });
      io.to(room.code).emit("room_update", roomState(room));

      const guessers = room.players.filter((p) => p.id !== room.drawerId && p.connected !== false); // คนที่หลุดอยู่ไม่ต้องรอ
      if (guessers.every((p) => room.guessedIds.has(p.id))) endRound(room);
      return;
    }

    // ทายผิด ทุกคนเห็นได้ · ผิดแต่ใกล้มาก บอกเฉพาะคนนี้คนเดียว
    io.to(room.code).emit("chat_message", msg);
    sendCloseHint(socket, text, room.word);
  });

  // ══════════════════════════════════════════════════════════════════
  // การวาด (ข้อ 4) — ทุกตัวหน้าตาเหมือนกัน: ตรวจสิทธิ์ → ตรวจข้อมูล → เก็บ → ส่งต่อ
  //
  // ข้อมูลผิด "ทิ้งเงียบ ๆ" ไม่ตอบ game_error กลับไป
  // เพราะการบอกว่าข้อมูลไหนผิด เท่ากับบอกใบ้คนที่กำลังลองโกงว่าเราดักตรงไหนอยู่
  // และไม่ว่าอะไรจะถูกส่งมา server ต้องไม่ล่ม — ตรวจให้ครบก่อนใช้ทุกครั้ง
  // ══════════════════════════════════════════════════════════════════

  socket.on("stroke_start", (data) => {
    const room = drawRoom(socket);
    if (!room || !data || typeof data !== "object") return;

    const { x, y, color, size, tool } = data;
    if (!isUnit(x) || !isUnit(y)) return;
    if (!isColor(color)) return;
    if (!isSize(size)) return;
    if (!VALID_TOOLS.includes(tool)) return;
    // กติกา Mini Challenge — ไม่ผ่านก็จบตรงนี้เหมือนข้อมูลผิดรูปแบบ (ทิ้งเงียบ ๆ)
    // ต้องเช็ค "ก่อน" เปิดเส้น ไม่งั้น stroke_points ที่ตามมาจะไหลผ่านเพราะ strokeOpen เป็นจริง
    if (!challengeAllowsStroke(room, color, tool)) return;

    const payload = { x, y, color, size, tool };
    room.strokeOpen = true;
    room.lastPoint = { x, y }; // จุดตั้งต้นของเส้นนี้ ใช้กรองจุดซ้ำในข้อความถัดไป
    storeAction(room, "stroke_start", payload);
    socket.to(room.code).emit("stroke_start", payload);
  });

  socket.on("stroke_points", (data) => {
    const room = drawRoom(socket);
    if (!room || !room.strokeOpen) return; // ไม่มีเส้นค้างอยู่ = ข้อมูลแปลกปลอม

    const points = cleanPoints(data);
    if (!points) return;

    const fresh = dedupePoints(room, points);
    if (fresh.length === 0) return; // จุดซ้ำทั้งหมด ไม่มีอะไรต้องส่ง

    storeAction(room, "stroke_points", { points: fresh });
    socket.to(room.code).emit("stroke_points", { points: fresh });
  });

  socket.on("stroke_end", () => {
    const room = drawRoom(socket);
    if (!room || !room.strokeOpen) return;

    room.strokeOpen = false;
    room.lastPoint = null;
    storeAction(room, "stroke_end", {});
    socket.to(room.code).emit("stroke_end", {});

    // dont_lift_pen: เส้นแรกจบแล้ว = "ยกปากกา" — วาดต่อไม่ได้อีกทั้งตา
    // ประกาศให้ทั้งห้องรู้ (events.md pen_locked) เพื่อให้ทุกจอขึ้นข้อความพร้อมกัน ไม่ใช่ให้ client เดา
    // penUsed เป็นของ "ตานี้" จึงถูกล้างตอน startDrawing เท่านั้น
    if (room.challenge?.type === "dont_lift_pen" && !room.penUsed) {
      room.penUsed = true;
      io.to(room.code).emit("pen_locked", {});
    }
  });

  socket.on("fill", (data) => {
    const room = drawRoom(socket);
    if (!room || !data || typeof data !== "object") return;

    const { x, y, color } = data;
    if (!isUnit(x) || !isUnit(y) || !isColor(color)) return;
    if (!challengeAllowsFill(room, color)) return;

    const payload = { x, y, color };
    storeAction(room, "fill", payload);
    socket.to(room.code).emit("fill", payload);
  });

  // draw_shape: เส้นตรง/สี่เหลี่ยม/วงกลม ที่ลากเสร็จแล้วส่งทีเดียว (ไม่มี stroke_start/points/end)
  // เก็บเป็นหนึ่งการกระทำในประวัติ จึงย้อน/ทำซ้ำ และส่งใน canvas_history ได้เหมือน fill
  socket.on("draw_shape", (data) => {
    const room = drawRoom(socket);
    if (!room || !data || typeof data !== "object") return;
    if (room.strokeOpen) return; // ลากเส้นค้างอยู่ ห้ามแทรก ไม่งั้นลำดับในประวัติเพี้ยน

    const { shape, x1, y1, x2, y2, color, size } = data;
    if (!VALID_SHAPES.includes(shape)) return;
    if (!isUnit(x1) || !isUnit(y1) || !isUnit(x2) || !isUnit(y2)) return;
    if (!isColor(color) || !isSize(size)) return;
    if (!challengeAllowsShape(room, color)) return;

    const payload = { shape, x1, y1, x2, y2, color, size };
    storeAction(room, "draw_shape", payload);
    socket.to(room.code).emit("draw_shape", payload);
  });

  // clear_canvas ไม่ได้ล้าง "ประวัติ" ทิ้ง แต่ถูกเก็บเป็นอีกหนึ่งการกระทำ
  // จึงกดย้อนกลับเพื่อเอากลับมาได้ (เหมือนโปรแกรมวาดรูปทั่วไป)
  socket.on("clear_canvas", () => {
    const room = drawRoom(socket);
    if (!room) return;

    storeAction(room, "clear_canvas", {});
    socket.to(room.code).emit("clear_canvas", {});
  });

  // ── ย้อนกลับ / ทำซ้ำ ──
  // client แค่ "ขอ" — server เป็นคนตัดสินว่าย้อนได้ไหม แล้วส่งภาพปัจจุบันทั้งชุดกลับให้ทั้งห้อง
  // (io.to ไม่ใช่ socket.to เพราะคนวาดต้องได้ด้วย จอตัวเองจะได้ย้อนตาม)
  //
  // dont_lift_pen ปฏิเสธทั้งคู่ **ที่ server** ไม่ใช่แค่ซ่อนปุ่ม
  // เพราะหัวใจของกติกาคือ "ห้ามยกปากกา" แต่การย้อนเส้นที่ลากผิดทิ้งแล้วลากใหม่ = ยกปากกาโดยไม่ถูกจับ
  // ปิดไว้ทั้งตา (ไม่ใช่เฉพาะหลังยก) เรียบง่ายและไม่มีช่องให้พลาด
  // ส่วน clear_canvas ยังอนุญาต เพราะการล้างจอไม่ได้ให้อะไรกลับมาเลย — ยังวาดต่อไม่ได้อยู่ดี
  const historyLocked = (room) => room.challenge?.type === "dont_lift_pen";

  socket.on("undo", () => {
    const room = drawRoom(socket);
    if (!room || historyLocked(room) || !undoCanvas(room)) return;
    io.to(room.code).emit("canvas_history", canvasPayload(room));
  });

  socket.on("redo", () => {
    const room = drawRoom(socket);
    if (!room || historyLocked(room) || !redoCanvas(room)) return;
    io.to(room.code).emit("canvas_history", canvasPayload(room));
  });

  // ── คำใบ้ (คนวาดขอเปิดก่อนเวลา) ──
  // drawRoom() เช็คให้ครบสามอย่างในตัวมันเองอยู่แล้ว: อยู่ในห้อง · กำลังวาด · เป็นคนวาด
  // ไม่ผ่านข้อใดข้อหนึ่ง = ทิ้งเงียบ ๆ เหมือน handler การวาดตัวอื่น (ไม่ตอบ error กลับ)
  // เปิดซ้ำครั้งที่สองก็เงียบ เพราะ revealHint มี hintOpen กันไว้แล้ว
  socket.on("request_hint", () => {
    const room = drawRoom(socket);
    if (!room) return;
    revealHint(room, "drawer");
  });

  // ---- Solo แข่งกับ AI ----
  socket.on("ai_start", (data) => {
    const name = cleanName(data?.name);
    if (!name) return socket.emit("game_error", { code: "INVALID_NAME", message: "กรุณาใส่ชื่อ" });
    if (!isNameAllowed(name)) return socket.emit("game_error", { code: "NAME_NOT_ALLOWED", message: "ชื่อนี้ไม่เหมาะสม ลองชื่ออื่นนะ" });
    const nameError = nameOwnerOk(socket, name, data?.nameOwnerKey);
    if (nameError) return socket.emit("game_error", { code: nameError, message: nameError === "NAME_OWNED" ? "ชื่อนี้มีเจ้าของแล้ว ลองชื่ออื่นนะ" : "ลองใหม่อีกครั้งในอีกสักครู่" });
    leaveRoom(socket); // ผู้เล่นหนึ่งคนอยู่ได้อย่างเดียว: ห้อง หรือ Solo
    stopSolo(socket);  // กดเริ่มซ้ำ = เริ่มเกมใหม่ เกมเก่าทิ้ง (รวมเกมที่ค้างอยู่ใต้ playerId เดียวกัน)
    const solo = {
      pid: socket.data.pid,
      name, avatar: cleanAvatar(data?.avatar), nameOwnerKey: data?.nameOwnerKey, difficulty: LEVELS.includes(data?.difficulty) ? data.difficulty : null, level: 1, lives: SOLO_LIVES, totalScore: 0, usedWords: new Set(), roundId: 0,
      over: false, drawing: false, busy: false, roundTimer: null, nextTimer: null, dropTimer: null,
      guessing: false, resting: false, drawNext: false, passed: false, strokeTimers: [],
    };
    socket.data.solo = solo;
    soloSessions.set(solo.pid, solo);
    startSoloRound(solo);
  });

  // ขอกลับเข้าเกม Solo เดิมหลังรีเฟรช — รู้ว่าเป็นใครจาก playerKey ใน handshake (ไม่รับ id จาก client)
  // ตอบสถานะปัจจุบันครั้งเดียวทาง callback แล้ว event ต่อจากนี้มาถึง socket ตัวใหม่ตามปกติ
  socket.on("ai_resume", (data, callback) => {
    if (typeof callback !== "function") return;
    const solo = socket.data.persistent ? soloSessions.get(socket.data.pid) : null;
    if (!solo) return callback({ ok: false, error: "NOT_IN_GAME" });
    if (socket.data.roomCode) leaveRoom(socket);
    if (!solo.over) clearTimeout(solo.dropTimer); // กลับมาทันเวลา = เลิกนับถอยหลังเลิกเกม
    socket.data.solo = solo.over ? null : solo;
    callback({ ok: true, state: soloSnapshot(solo) });
    if (solo.over) dropSolo(solo); // รับผลจบเกมไปแล้ว ไม่ต้องเก็บต่อ
  });

  socket.on("ai_snapshot", (data) => {
    handleSoloSnapshot(socket, data);
  });

  socket.on("ai_draw_guess", (data) => {
    handleSoloGuess(socket, data);
  });

  socket.on("leave_room", () => {
    stopSolo(socket); // ออกจาก Solo กลางเกม = ไม่บันทึกคะแนน
    leaveRoom(socket);
  });

  socket.on("disconnect", () => {
    console.log("มีคนหลุดออกไป:", socket.id);
    suspendSolo(socket); // มี playerKey = พักเกมไว้รอรีเฟรชกลับมา (ไม่กลับภายในเวลา = เลิก ไม่บันทึกคะแนน)
    handleDisconnect(socket); // อยู่ในห้อง: รอให้กลับมาก่อน ไม่ลบทันที
  });
});

const PORT = Number(process.env.PORT) || 3000; // เทสเปิด server ตัวที่สองบนพอร์ตอื่นได้
// โหลดคลังคำ/โมเดลของ Solo ให้เสร็จก่อนเปิดรับคน (ไม่ throw โหลดไม่ได้ก็ใช้สมองอื่น)
// leaderboard.init() = โหลดคะแนนจาก Upstash ถ้าตั้ง env ไว้ (ไม่ตั้ง = ใช้ไฟล์ ไม่ทำอะไร) · ไม่ throw
Promise.all([ai.init(), leaderboard.init()]).then(() => {
  aiDrawings.load();
  // ไม่ระบุ host = รับทุกการเชื่อมต่อ (เครื่องอื่นในวง Wi-Fi เดียวกันเข้าได้)
  // HOST=0.0.0.0 ไว้ให้ตอน deploy บน Render (ต้องฟังที่ 0.0.0.0 ตามที่ Render ต้องการ)
  const listenArgs = process.env.HOST ? [PORT, process.env.HOST] : [PORT];
  server.listen(...listenArgs, () => {
    console.log(`server พร้อมแล้ว ที่ http://localhost:${PORT}`);
    const ips = lanAddresses();
    if (ips.length) {
      console.log("ให้เพื่อนในวง Wi-Fi เดียวกันพิมพ์ที่อยู่นี้ในเบราว์เซอร์:");
      for (const ip of ips) console.log(`   http://${ip}:${PORT}`);
    } else {
      console.log("ไม่พบ IP ในวงแลน (ยังไม่ได้ต่อ Wi-Fi?) — เล่นเครื่องเดียวหรือใช้ npm run share ก็ได้");
    }
    if (!HAS_CLIENT) console.log("⚠️  ยังไม่ได้ build หน้าเว็บ (client/dist) — รัน npm run setup ก่อน");
    console.log(`AI Solo: โหมด ${ai.aiMode()}`);
  });
});

// ── กันโปรเซสดับจากข้อผิดพลาดที่ไม่ได้ดักไว้ ──
// ปกติ Node จะปิดโปรเซสทันทีเมื่อเจอ exception/rejection ที่ไม่มีใครจับ
// ระหว่างเดโมถ้า server ดับ = ทุกห้องหายหมด จึง log ไว้แล้วให้ทำงานต่อ (ตัวห่อ socket.on ด้านบนดักส่วนใหญ่ไว้แล้ว นี่คือตาข่ายชั้นสุดท้าย)
// ไม่ปิดโปรเซส เพราะเป้าหมายคือ "ห้ามล่มตอนเดโม" — error ยังถูกพิมพ์ให้เห็นเสมอ ไม่กลืนเงียบ
process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException (server ยังทำงานต่อ):", err?.stack || err?.message || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ unhandledRejection (server ยังทำงานต่อ):", reason?.stack || reason?.message || reason);
});

// ถูกสั่งปิด (deploy ใหม่/รีสตาร์ทบน Render ส่ง SIGTERM): เขียนคะแนนที่ค้างลง Upstash ให้เสร็จก่อนค่อยดับ จะได้ไม่เสียคะแนนล่าสุด
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    await leaderboard.flush();
    process.exit(0);
  });
}

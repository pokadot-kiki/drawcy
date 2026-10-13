import { useEffect, useRef, useState } from "react";
import { socket } from "../socket";
import { nameOwnerKey } from "../nameOwnerKey";
import Logo from "../components/Logo";
import Timer from "../components/Timer";
import Canvas from "../components/Canvas";
import Toolbar from "../components/Toolbar";
import Modal from "../components/Modal";
import TimeBar from "../components/TimeBar";
import Ribbon from "../components/Ribbon";
import Mascot, { MascotNote } from "../components/Mascot";
import AnimatedNumber from "../components/AnimatedNumber";
import { TopIcons, InfoModal, ExitModal } from "../components/TopIcons";
import { play } from "../sound/sfx";
import { beginStroke, extendStroke, endStroke, clearBoard } from "../canvas/actions";
import { PAINT_COLORS, SIZE_DEFAULT, TOOLS } from "../canvas/palette";
import { Icon } from "../components/Icons";
import { Sparkles, PAGE_SPARKLES } from "../components/Critter";

// ส่งภาพให้ AI ดูทุก 5 วินาที (server รับห่างกันได้ไม่ต่ำกว่า 4 วิ)
const SNAPSHOT_MS = 5000;
const SNAPSHOT_WIDTH = 512;
const THINK_TIMEOUT_MS = 20000; // server รอ AI สูงสุด 15 วิ เผื่อไว้อีกนิดกันค้างถ้าตอบหาย
// แปรงหนาสุดใน Solo — วัดแล้วแปรงหนามาก (24px ในภาพ 512px) ทำให้ AI ทายถูกแค่ครึ่งเดียว (84% → 49%)
// เป็นแค่การช่วยผู้เล่น ไม่ใช่กติกากันโกง (server ไม่ได้จำกัด)
const SOLO_MAX_SIZE = 12;

// ข้อความบอกโหมดของ AI ให้ตรงกับ aiMode ที่ server ส่งมาจริงในด่านนี้
const MODE_TEXT = {
  model: "AI ในเครื่อง — ดูภาพจริงด้วยโมเดลทายภาพวาด (ฟรี ไม่ใช้ API key)",
  claude: "AI Claude — ดูภาพจริง",
  mock: "โหมดจำลอง — ไม่มีโมเดลและไม่มี API key AI เดาสุ่ม ไม่ได้ดูภาพจริง",
};
const MAX_GUESS_CHARS = 40; // ตรงกับเพดานที่ server รับ
const NEXT_DELAY_S = 4; // server พัก 4 วิก่อนด่านถัดไป (ใช้แสดงนับถอยหลังเฉยๆ)

// การกระทำที่ "ย้อนได้ทีละหนึ่งอัน" — หนึ่งเส้น (start..end) หนึ่งครั้งเทสี หนึ่งครั้งล้างจอ
const OP_START = new Set(["stroke_start", "fill", "draw_shape", "clear_canvas"]);
function lastOpIndex(actions) {
  for (let i = actions.length - 1; i >= 0; i--) if (OP_START.has(actions[i].type)) return i;
  return -1;
}

/**
 * หน้า Solo แข่งกับ AI (ข้อ 7 ส่วนที่ 2) — ผู้เล่นวาด AI ทาย
 *
 * ผูก socket เองในหน้านี้ได้ (ต่างจากหน้าเกมปกติ) เพราะ event แรกคือ ai_round_start
 * มาหลังจากเรากด START เอง และเรา "ผูกก่อนแล้วค่อยส่ง ai_start" จึงไม่มีทางหลุด
 *
 * กติกาทุกอย่างอยู่ที่ server: เวลา ชีวิต คะแนน การขึ้นด่าน การบันทึก leaderboard
 * หน้านี้แค่แสดงผลและส่งภาพ — นับเวลาถอยหลังเองเพื่อโชว์เท่านั้น server เป็นคนปิดด่าน
 */
// ระดับความยากของชุดคำ (ค่าเดียวกับที่ server รับใน ai_start / settings.difficulty)
const DIFFICULTIES = [
  ["easy", "ง่าย"],
  ["medium", "กลาง"],
  ["hard", "ยาก"],
];

export default function SoloAI({ initialName = "", boot = null, onName, onBack }) {
  // intro = กรอกชื่อ · starting = ส่ง ai_start แล้วรอด่านแรก · playing = ช่วง 1 เราวาด AI ทาย
  // watch = ช่วง 2 ดูภาพที่เล่นซ้ำแล้วพิมพ์ทาย · rest = พักระหว่างช่วง · over = จบเกม
  const [phase, setPhase] = useState("intro");
  const [name, setName] = useState(initialName);
  // ระดับความยากของ "ชุดคำ" ทั้งเกม (เวลายังสั้นลงตามด่านเหมือนเดิม) — server เป็นคนสุ่มคำตามระดับนี้
  // มาจากหน้า SET UP (boot) ถ้าเข้าทางนั้น ไม่งั้นเริ่มที่ง่าย
  const [difficulty, setDifficulty] = useState(boot?.difficulty ?? "easy");
  const [round, setRound] = useState(null); // { level, word, time, lives, aiMode, drawNext }
  const [watch, setWatch] = useState(null); // ช่วง 2: { level, time, lives, category } (ไม่มีคำตอบ)
  const [answer, setAnswer] = useState(""); // ช่องพิมพ์ทายของช่วง 2
  const [wrongAnswers, setWrongAnswers] = useState([]); // คำที่เราทายผิดในช่วง 2
  const [roundId, setRoundId] = useState(0); // นับขึ้นทุกด่าน ไว้สั่งล้างกระดาน
  const [lives, setLives] = useState(3);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(null);
  const [guesses, setGuesses] = useState([]); // คำที่ AI เดาในด่านนี้
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState(null); // ผลช่วงล่าสุด { kind: "draw" | "guess", correct, gained, word }
  const [restLeft, setRestLeft] = useState(NEXT_DELAY_S);
  const [final, setFinal] = useState(null); // { totalScore, levelReached, rank }
  const [hist, setHist] = useState({ undo: false, redo: false });
  const [showInfo, setShowInfo] = useState(false);
  const [showExit, setShowExit] = useState(false);

  const [toolChoice, setToolChoice] = useState(TOOLS.PEN);
  const [color, setColor] = useState(PAINT_COLORS[0].hex);
  const [size, setSize] = useState(SIZE_DEFAULT);

  const canvasRef = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const roundRef = useRef(null);
  const thinkingRef = useRef(false);
  const thinkTimer = useRef(null);
  const watchRef = useRef(null);
  const anims = useRef([]); // เส้นของช่วง 2 ที่กำลังถูกไล่จุดอยู่ (เคลียร์ตอนจบช่วง/ออกจากหน้า)
  const rafRef = useRef(0);
  const redoRef = useRef([]); // กองทำซ้ำ (เก็บฝั่งเครื่องเรา ไม่มี server เก็บให้เหมือนห้องปกติ)

  function setThink(on) {
    thinkingRef.current = on;
    setThinking(on);
    clearTimeout(thinkTimer.current);
    if (on) thinkTimer.current = setTimeout(() => setThink(false), THINK_TIMEOUT_MS);
  }

  function clearStrokes() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    anims.current = [];
  }

  // เล่นซ้ำหนึ่งเส้นที่ server ส่งมา — server ส่งเส้นเต็ม (ทุกจุด) มาครั้งเดียวพร้อม ms แล้ว "client ไล่จุดเอง" ทุกเฟรม
  // ไม่รอข้อความเครือข่ายทีละจุด และไม่ใช้ setTimeout ที่ไม่ตรงเฟรม (ตัวทำให้กระตุกเดิม)
  // ทุกเฟรม: คำนวณว่าเวลาผ่านไปกี่ % ของ ms → เดินตามความยาวเส้นไปถึงระยะนั้น → ต่อจุดที่ผ่านมา + จุดปลายหัวเส้นที่แทรกค่า
  // ใช้ applyRemote (วาด + เก็บ แต่ไม่ส่งออก) กับ painter ตัวเดียวกับคนวาด เส้นจึงเรียบเหมือนที่ผู้เล่นวาดเอง
  function playStroke({ points, color, size, ms }) {
    const board = canvasRef.current;
    if (!board || !Array.isArray(points) || points.length === 0) return;
    board.applyRemote(beginStroke({ x: points[0].x, y: points[0].y, color, size, tool: TOOLS.PEN }));
    // ความยาวสะสมตามสัดส่วนกระดาน 4:3 (แกน y คูณ 0.75) ให้ความเร็วบนจอสม่ำเสมอ
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, (points[i].y - points[i - 1].y) * 0.75));
    }
    anims.current.push({ points, cum, total: cum[cum.length - 1], ms: Math.max(ms || 0, 16), t0: performance.now(), next: 1 });
    if (!rafRef.current) rafRef.current = requestAnimationFrame(frame);
  }

  function frame(now) {
    rafRef.current = 0;
    const board = canvasRef.current;
    if (!board) return;
    const alive = [];
    for (const a of anims.current) {
      const t = Math.min(1, (now - a.t0) / a.ms);
      const dist = t * a.total;
      const fresh = [];
      while (a.next < a.points.length && (t >= 1 || a.cum[a.next] <= dist)) fresh.push(a.points[a.next++]);
      if (t < 1 && a.next < a.points.length) {
        // หัวเส้นอยู่กลางช่วงระหว่างจุด a.next-1 กับ a.next — แทรกค่าให้เห็นเส้นยืดลื่นทุกเฟรม
        const i = a.next;
        const f = a.cum[i] > a.cum[i - 1] ? (dist - a.cum[i - 1]) / (a.cum[i] - a.cum[i - 1]) : 1;
        fresh.push({
          x: a.points[i - 1].x + (a.points[i].x - a.points[i - 1].x) * f,
          y: a.points[i - 1].y + (a.points[i].y - a.points[i - 1].y) * f,
        });
      }
      if (fresh.length) board.applyRemote(extendStroke(fresh));
      if (t >= 1) board.applyRemote(endStroke());
      else alive.push(a);
    }
    anims.current = alive;
    if (alive.length) rafRef.current = requestAnimationFrame(frame);
  }

  // ── ผูก event ของ Solo ครั้งเดียวตอนเปิดหน้า ──
  useEffect(() => {
    const onRoundStart = (d) => {
      roundRef.current = d;
      watchRef.current = null;
      setRound(d);
      setLives(d.lives);
      setTimeLeft(d.time);
      setGuesses([]);
      setResult(null);
      setThink(false);
      setRoundId((n) => n + 1);
      setPhase("playing");
      play("roundStart");
    };
    const onGuess = (d) => {
      setThink(false);
      setGuesses((g) => [...g, { text: String(d.guess ?? ""), correct: Boolean(d.correct) }]);
      if (d.correct) play("aiCorrect"); // AI ทายถูก (ดีใจ เพราะเราวาดรู้เรื่อง)
    };
    const onRoundEnd = (d) => {
      setThink(false);
      setScore(d.totalScore);
      setLives(d.lives);
      setResult({ kind: "draw", correct: d.correct, gained: d.gained, word: roundRef.current?.word ?? "" });
      setRestLeft(NEXT_DELAY_S);
      setPhase("rest");
    };
    // ช่วง 2 เริ่ม: ล้างกระดาน แล้วรอเส้นที่ server ส่งมาทีละเส้น
    const onDrawStart = (d) => {
      clearStrokes();
      watchRef.current = d;
      setWatch(d);
      setLives(d.lives);
      setTimeLeft(d.time);
      setResult(null);
      setAnswer("");
      setWrongAnswers([]);
      canvasRef.current?.resetBoard();
      redoRef.current = [];
      setHist({ undo: false, redo: false });
      setPhase("watch");
      play("roundStart");
    };
    const onDrawStroke = (d) => {
      if (watchRef.current) playStroke(d); // ใช้ ref ที่ตั้งทันทีตอน ai_draw_start (phaseRef ยังไม่ทันอัปเดตตอนเส้นแรกมาถึง)
    };
    const onDrawReply = (d) => {
      if (!d?.correct) setWrongAnswers((w) => [...w, String(d?.text ?? "")]);
    };
    const onDrawEnd = (d) => {
      clearStrokes();
      watchRef.current = null;
      canvasRef.current?.applyRemote(endStroke()); // ปิดเส้นที่เล่นค้างอยู่ (ถ้ามี)
      setScore(d.totalScore);
      setLives(d.lives);
      setResult({ kind: "guess", correct: d.correct, gained: d.gained, word: String(d.word ?? "") });
      setRestLeft(NEXT_DELAY_S);
      setPhase("rest");
      if (d.correct) play("selfCorrect");
    };
    const onGameEnd = (d) => {
      setThink(false);
      setScore(d.totalScore);
      setFinal(d);
      setPhase("over");
      play("gameOver");
    };
    const onError = (err) => {
      // AI ไม่ว่าง: ด่านเดินต่อ ไม่เสียชีวิต ส่งภาพใหม่ได้ (App โชว์ Toast ให้แล้ว)
      if (err?.code === "AI_UNAVAILABLE") setThink(false);
      // ชื่อไม่ผ่าน: ยังไม่ได้เริ่มเกมจริง กลับไปกรอกใหม่
      if (["INVALID_NAME", "NAME_OWNED", "NAME_NOT_ALLOWED"].includes(err?.code) && phaseRef.current === "starting") setPhase("intro");
    };
    socket.on("ai_round_start", onRoundStart);
    socket.on("ai_guess", onGuess);
    socket.on("ai_round_end", onRoundEnd);
    socket.on("ai_draw_start", onDrawStart);
    socket.on("ai_draw_stroke", onDrawStroke);
    socket.on("ai_draw_reply", onDrawReply);
    socket.on("ai_draw_end", onDrawEnd);
    socket.on("ai_game_end", onGameEnd);
    socket.on("game_error", onError);
    return () => {
      socket.off("ai_round_start", onRoundStart);
      socket.off("ai_guess", onGuess);
      socket.off("ai_round_end", onRoundEnd);
      socket.off("ai_draw_start", onDrawStart);
      socket.off("ai_draw_stroke", onDrawStroke);
      socket.off("ai_draw_reply", onDrawReply);
      socket.off("ai_draw_end", onDrawEnd);
      clearStrokes();
      socket.off("ai_game_end", onGameEnd);
      socket.off("game_error", onError);
      clearTimeout(thinkTimer.current);
      // ออกจากหน้ากลางเกม = เลิกเล่น (server ไม่บันทึกคะแนน)
      if (phaseRef.current === "starting" || phaseRef.current === "playing" || phaseRef.current === "watch" || phaseRef.current === "rest") {
        socket.emit("leave_room");
      }
    };
  }, []);

  // มาจากหน้า SET UP (เลือกโหมด "แข่งกับ AI") → เริ่มเกมทันที ข้ามหน้ากรอกชื่อ
  // ผูกไว้หลัง effect ที่ติด listener ด้านบน (เรียงตามลำดับ) จึงมั่นใจว่า listener พร้อมก่อนส่ง ai_start
  // ส่งเฉพาะตอนยังอยู่หน้ากรอกชื่อ กันยิงซ้ำถ้า component re-render
  useEffect(() => {
    if (!boot || phaseRef.current !== "intro") return;
    onName?.(initialName.trim());
    setScore(0);
    setLives(3);
    setFinal(null);
    setPhase("starting");
    socket.emit("ai_start", { name: initialName, difficulty: boot.difficulty, nameOwnerKey: nameOwnerKey() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ขึ้นด่านใหม่ = ล้างกระดานและประวัติย้อนกลับ
  useEffect(() => {
    if (roundId === 0) return;
    canvasRef.current?.resetBoard();
    redoRef.current = [];
    setHist({ undo: false, redo: false });
  }, [roundId]);

  // นับเวลาถอยหลังไว้โชว์ (server เป็นคนตัดสินว่าหมดเวลาจริง)
  const live = phase === "playing" || phase === "watch";
  const stage = phase === "watch" ? watch : round; // ช่วงที่กำลังเล่นอยู่ (ใช้ดูเวลาเต็ม)
  useEffect(() => {
    if (!live || !stage) return undefined;
    const deadline = Date.now() + stage.time * 1000;
    const id = setInterval(() => {
      setTimeLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [live, stage]);

  // 10 วิสุดท้าย ติ๊กทุกวินาที (เปลี่ยนค่า timeLeft ทีละวินาทีอยู่แล้ว ไม่ซ้ำ)
  useEffect(() => {
    if (live && timeLeft > 0 && timeLeft <= 10) play("tick", timeLeft <= 3);
  }, [live, timeLeft]);

  // นับถอยหลังช่วงพัก
  useEffect(() => {
    if (phase !== "rest") return undefined;
    const id = setInterval(() => setRestLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ส่งภาพให้ AI ทุก 5 วิ — ข้ามถ้ากระดานยังว่าง (ไม่เปลืองการเรียก AI) หรือ AI ยังคิดภาพก่อนหน้าอยู่
  useEffect(() => {
    if (phase !== "playing") return undefined;
    const id = setInterval(() => {
      if (thinkingRef.current) return;
      const board = canvasRef.current;
      if (!board || board.getActions().length === 0) return;
      const image = board.snapshot(SNAPSHOT_WIDTH);
      if (!image) return;
      setThink(true);
      socket.emit("ai_snapshot", { image });
    }, SNAPSHOT_MS);
    return () => clearInterval(id);
  }, [phase, roundId]);

  function start(e) {
    e?.preventDefault();
    if (!name.trim()) return;
    onName?.(name.trim()); // จำชื่อที่ใช้ไว้ (ชื่อเดียวกับหน้าแรก)
    setScore(0);
    setLives(3);
    setFinal(null);
    setPhase("starting");
    socket.emit("ai_start", { name, difficulty, nameOwnerKey: nameOwnerKey() });
  }

  // ช่วง 2: ส่งคำที่พิมพ์ให้ server ตัดสิน (ฝั่งนี้ไม่รู้คำตอบเลย)
  function sendAnswer(e) {
    e.preventDefault();
    const text = answer.trim();
    if (phase !== "watch" || !text) return;
    socket.emit("ai_draw_guess", { text });
    setAnswer("");
  }

  function handleLeave() {
    // ปิดเกมที่ server ด้วย (จบเกมแล้วไม่มีอะไรค้าง ส่งไปก็ไม่เป็นไร)
    socket.emit("leave_room");
    phaseRef.current = "over"; // กัน cleanup ส่งซ้ำ
    onBack();
  }

  // ── ย้อนกลับ/ทำซ้ำในเครื่อง (Solo ไม่มี server เก็บประวัติให้) ──
  function syncHist() {
    const b = canvasRef.current;
    setHist({ undo: !!b && lastOpIndex(b.getActions()) >= 0, redo: redoRef.current.length > 0 });
  }
  function handleAction(action) {
    if (!OP_START.has(action.type)) return;
    redoRef.current = []; // วาดใหม่หลังย้อน = ทิ้งกองทำซ้ำ (เหมือนโหมดห้อง)
    syncHist();
  }
  function undo() {
    const b = canvasRef.current;
    if (!b) return;
    const all = b.getActions();
    const i = lastOpIndex(all);
    if (i < 0) return;
    redoRef.current.push(all.slice(i));
    b.applyHistory(all.slice(0, i));
    syncHist();
  }
  function redo() {
    const b = canvasRef.current;
    const op = redoRef.current.pop();
    if (!b || !op) return;
    b.applyHistory([...b.getActions(), ...op]);
    syncHist();
  }

  const canDraw = phase === "playing" && (timeLeft ?? 1) > 0;

  useEffect(() => {
    if (!canDraw) return undefined;
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── หน้ากรอกชื่อ ──
  if (phase === "intro") {
    return (
      <div className="screen">
        <Logo />
        <Ribbon tone="purple">SOLO VS AI</Ribbon>
        <form className="panel solo-intro" onSubmit={start}>
          <h2 className="panel__title">
            <Icon name="robot" size={28} /> Solo แข่งกับ AI
          </h2>
          <p className="solo-intro__text">
            คุณวาดตามคำที่ได้ AI ดูภาพแล้วทาย · ทายถูกขึ้นด่านถัดไป ยิ่งผ่านมากยิ่งยาก
            ทายไม่ออกในเวลาเสีย 1 ชีวิต (มี 3 ชีวิต)
          </p>
          <label className="field__label" htmlFor="solo-name">
            CHOOSE YOUR NAME
          </label>
          <input
            id="solo-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="ชื่อเล่นของคุณ"
            autoComplete="off"
            autoFocus
          />
          <small className="name-owner-note">ชื่อนี้ผูกกับเบราว์เซอร์เครื่องนี้ · ล้างข้อมูลหรือเปลี่ยนเครื่องอาจใช้ชื่อเดิมไม่ได้</small>
          <span className="field__label" id="solo-diff-label">
            ระดับความยากของคำ
          </span>
          <div className="segmented" role="group" aria-labelledby="solo-diff-label">
            {DIFFICULTIES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={difficulty === value ? "seg seg--active" : "seg"}
                aria-pressed={difficulty === value}
                onClick={() => setDifficulty(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="submit" className="btn btn--primary btn--wide" disabled={!name.trim()}>
            START
          </button>
          <button type="button" className="btn btn--wide" onClick={onBack}>
            <Icon name="arrowL" size={14} /> กลับหน้าแรก
          </button>
        </form>
      </div>
    );
  }

  const tool = toolChoice;
  // หัวใจพิกเซล 3 ดวง (เต็ม = ชีวิตที่เหลือ · เทา = ชีวิตที่เสียไป)
  const hearts = (
    <span className="hearts">
      {Array.from({ length: 3 }, (_, i) => (
        <Icon key={i} name={i < lives ? "heart" : "heartOff"} size={22} />
      ))}
    </span>
  );
  const lastGuess = guesses[guesses.length - 1];

  return (
    <div className="screen screen--game">
      <Sparkles className="sparkles--page" spots={PAGE_SPARKLES} />
      <header className="topbar">
        <div className="topbar__stats">
          <div className="topbar__who">
            <span className="topbar__label">ด่าน</span>
            <span className="topbar__name">{round?.level ?? "-"}</span>
          </div>
          <div className="topbar__who">
            <span className="topbar__label">ชีวิต</span>
            <span className="topbar__name" aria-label={`เหลือ ${lives} ชีวิต`}>
              {hearts}
            </span>
          </div>
          <div className="topbar__who">
            <span className="topbar__label">คะแนน</span>
            <span className="topbar__name">
              <AnimatedNumber value={score} />
            </span>
          </div>
        </div>

        <div className="topbar__meta">
          <Timer timeLeft={live ? timeLeft : null} />
        </div>

        <TopIcons onInfo={() => setShowInfo(true)} onExit={() => setShowExit(true)} />
      </header>

      <main className="game game--solo">
        <section className="game__stage">
          {/* แถบคำเหนือกระดาน เหมือนหน้าเกมปกติ: ซ้าย = ป้ายบอกช่วง · กลาง = คำที่ต้องวาด (หรือหมวดของภาพในช่วง 2) */}
          <div className="wordbar">
            <div className="wordbar__side">
              {/* ป้ายบอกช่วง: ช่วง 1 ขึ้นเฉพาะด่านที่มีช่วง 2 ต่อท้าย */}
          {phase === "watch" ? (
            <div className="solo-stage solo-stage--watch">ช่วง 2/2 · ดูภาพแล้วพิมพ์ทาย</div>
          ) : (phase === "playing" || (phase === "rest" && result?.kind === "draw")) && round?.drawNext ? (
            <div className="solo-stage">ช่วง 1/2 · คุณวาด AI ทาย</div>
          ) : null}
            </div>
          <div className="wordbar__word">
            {phase === "watch" && watch ? (
              <span className="topbar__idle" title="หมวดหมู่ของภาพ">
                ภาพนี้คืออะไร? {watch.category && <>หมวด: <b>{watch.category}</b></>}
              </span>
            ) : round && phase !== "starting" ? (
              <span className="topbar__real-word" title="คำที่คุณต้องวาด">
                {round.word}
              </span>
            ) : (
              <span className="topbar__idle">กำลังเริ่มเกม...</span>
            )}
          </div>
            <div className="wordbar__side wordbar__side--end" />
          </div>
          <Canvas
            ref={canvasRef}
            canDraw={canDraw}
            tool={tool}
            color={color}
            size={Math.min(size, SOLO_MAX_SIZE)}
            onAction={handleAction}
            empty={
              phase === "playing" && round ? (
                <MascotNote mood="draw">วาด “{round.word}” เลย!</MascotNote>
              ) : phase === "watch" ? (
                <MascotNote mood="wait">ดูให้ดี แล้วพิมพ์ทายเลย!</MascotNote>
              ) : null
            }
          />

          <TimeBar timeLeft={live ? timeLeft : null} total={stage?.time ?? null} />
        </section>

        {/* คอลัมน์ขวา: เครื่องมือวาด (บน) + กล่องพิมพ์คำตอบ (ล่าง เต็มพื้นที่ที่เหลือจนถึงขอบล่างของกระดาน)
            ใช้ flex order ให้เครื่องมืออยู่บน แม้กล่องคำตอบมาก่อนใน DOM · บนมือถือ side ลงไปอยู่ใต้กระดาน */}
        <aside className="game__side">
          <div className="game__answers game__answers--solo">
            {phase === "watch" ? (
              <section className="panel ai-box" aria-live="polite">
                <h2 className="panel__title">พิมพ์คำตอบ</h2>
                <div className="ai-box__body">
                  <p className="ai-box__hint">
                    ภาพนี้เป็นการเล่นซ้ำภาพที่คนจริงเคยวาด (ชุดข้อมูล Google Quick, Draw!) ไม่ใช่ AI สร้างภาพเอง
                  </p>
                  {wrongAnswers.length > 0 && (
                    <p className="ai-box__past">ทายผิดไปแล้ว: {wrongAnswers.join(" · ")}</p>
                  )}
                </div>
                <form className="chat__form" onSubmit={sendAnswer}>
                  <input
                    className="input chat__input"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    maxLength={MAX_GUESS_CHARS}
                    placeholder="พิมพ์คำที่คิดว่าใช่ แล้วกด Enter"
                    autoComplete="off"
                    aria-label="พิมพ์คำตอบ"
                    autoFocus
                  />
                  <button type="submit" className="btn btn--primary" disabled={!answer.trim()}>
                    ทาย
                  </button>
                </form>
                <button type="button" className="link-btn ai-box__leave" onClick={() => setShowExit(true)}>
                  ออกจากเกม (ไม่บันทึกคะแนน)
                </button>
              </section>
            ) : (
            <section className="panel ai-box" aria-live="polite">
              <h2 className="panel__title">AI คิดว่า...</h2>
              <div className="ai-box__body">
                {lastGuess ? (
                  <p className={`ai-box__guess${lastGuess.correct ? " ai-box__guess--ok" : ""}`}>
                    <Icon name={lastGuess.correct ? "check" : "question"} size={24} /> {lastGuess.text}
                  </p>
                ) : (
                  <p className="ai-box__hint">
                    {thinking ? "กำลังดูภาพ..." : "วาดเลย AI จะดูภาพทุก 5 วินาที"}
                  </p>
                )}
                {lastGuess && thinking && <p className="ai-box__hint">กำลังดูภาพใหม่...</p>}
                {guesses.length > 1 && (
                  <p className="ai-box__past">
                    ก่อนหน้า: {guesses.slice(0, -1).map((g) => g.text).join(" · ")}
                  </p>
                )}
              </div>
              {round && MODE_TEXT[round.aiMode] && (
                <p className={`ai-box__mode${round.aiMode === "mock" ? " ai-box__mode--mock" : ""}`}>
                  {MODE_TEXT[round.aiMode]}
                </p>
              )}
              <button type="button" className="link-btn ai-box__leave" onClick={() => setShowExit(true)}>
                ออกจากเกม (ไม่บันทึกคะแนน)
              </button>
            </section>
            )}
          </div>

          <div className="game__tools">
            <Toolbar
              tool={tool}
              color={color}
              size={size}
              onTool={setToolChoice}
              onColor={setColor}
              onSize={setSize}
              onClear={() => canvasRef.current?.dispatch(clearBoard())}
              onUndo={undo}
              onRedo={redo}
              canUndo={hist.undo}
              canRedo={hist.redo}
              locked={!canDraw}
              maxSize={SOLO_MAX_SIZE}
            />
          </div>
        </aside>
      </main>

      {/* พักระหว่างด่าน — บอกผลด่านที่เพิ่งจบให้ชัด server เปลี่ยนด่านเอง ไม่มีปุ่มกด */}
      {phase === "rest" && result && (
        <Modal labelledBy="solo-rest-title">
          <Mascot mood={result.correct ? "happy" : "shock"} className="mascot--modal" />
          <h2 className="modal__title" id="solo-rest-title">
            {result.kind === "guess"
              ? result.correct ? "ทายถูก!" : "ทายไม่ทัน"
              : result.correct ? "AI ทายถูก!" : "AI ทายไม่ออก"}
          </h2>
          <p className="modal__note">{result.kind === "guess" ? "คำตอบของภาพนี้คือ" : "คำที่ให้วาดคือ"}</p>
          <p className="answer">{result.word}</p>
          {result.correct ? (
            <p className="solo-result solo-result--ok">
              +{result.gained} คะแนน{result.kind === "draw" && round?.drawNext ? " · ผ่านช่วงที่ 1" : " · ผ่านด่านนี้"}
            </p>
          ) : (
            <p className="solo-result solo-result--bad">เสียไป 1 ชีวิต · เหลือ {hearts}</p>
          )}
          <p className="modal__note">
            รวม {score} คะแนน ·{" "}
            {result.kind === "draw" && round?.drawNext ? "ช่วงที่ 2 (ดูภาพแล้วทาย)" : "ด่านถัดไป"} ใน{" "}
            <span className="modal__count">{restLeft}</span>
          </p>
        </Modal>
      )}

      {phase === "over" && final && (
        <Modal labelledBy="solo-over-title">
          <Mascot mood="trophy" className="mascot--modal" />
          <h2 className="modal__title" id="solo-over-title">
            จบเกม
          </h2>
          {result && (
            <p className="modal__note">
              {result.correct
                ? ""
                : result.kind === "guess"
                  ? `ด่านสุดท้ายทายภาพไม่ทัน (คำว่า "${result.word}")`
                  : `ด่านสุดท้าย AI ทายไม่ออก (คำว่า "${result.word}")`}
            </p>
          )}
          <p className="solo-final__score">{final.totalScore}</p>
          <p className="modal__note">คะแนนรวม · ถึงด่าน {final.levelReached}</p>
          <p className="solo-result solo-result--ok">
            {final.rank ? (
              <>
                <Icon name="trophy" size={22} /> อันดับ {final.rank} ของตลอดกาล
              </>
            ) : (
              "บันทึกคะแนนไม่สำเร็จ"
            )}
          </p>
          <div className="modal__actions">
            <button type="button" className="btn btn--primary" onClick={start}>
              เล่นอีกครั้ง
            </button>
            <button type="button" className="btn" onClick={handleLeave}>
              กลับหน้าแรก
            </button>
          </div>
        </Modal>
      )}

      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
      {showExit && (
        <ExitModal
          note="ออกกลางเกมจะไม่บันทึกคะแนน"
          onNo={() => setShowExit(false)}
          onYes={handleLeave}
        />
      )}
    </div>
  );
}

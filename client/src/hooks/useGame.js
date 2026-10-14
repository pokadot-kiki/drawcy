import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../socket";

// event การวาดที่ server ส่งกลับมาให้เราวาดตาม (events.md หัวข้อ 4)
// ทุกตัวมี payload ที่หน้าตาเหมือน action ใน canvas/actions.js เป๊ะ
// ต่างกันแค่ไม่มีช่อง type เราเลยเติมกลับเข้าไปแล้วส่งเข้า applyRemote ได้ตรงๆ
const DRAW_EVENTS = ["stroke_start", "stroke_points", "stroke_end", "fill", "draw_shape", "clear_canvas"];

// สถานะตั้งต้นของเกมหนึ่งเกม
function emptyGame() {
  return {
    active: false, // true ตั้งแต่ game_started จนถึง game_end
    round: null, // ก้อนข้อมูลจาก round_start — ใช้แค่ตอนกำลังวาด (มี hint กับ challenge)
    roundNo: null, // รอบที่เท่าไร เก็บไว้โชว์ตอนพักระหว่างตา (round เป็น null แล้ว)
    totalRounds: null,
    drawerId: null, // คนวาดตานี้ เก็บไว้เหมือนกัน จะได้ไม่หายตอนพัก
    word: null, // คำจริง เฉพาะคนวาด ได้จาก your_word
    timeLeft: null, // วินาทีที่เหลือ จาก timer
    options: null, // ตัวเลือกคำ 3 คำ เฉพาะคนวาด ได้จาก choose_word
    chooseTime: 10,
    summary: null, // จาก round_end (เฉลย + คะแนนที่ได้แต่ละคน)
    ranking: null, // จาก game_end
    // ── โหมดทีม (events.md หัวข้อ 8) — โหมดปกติค่าเหล่านี้ไม่ถูกใช้เลย ──
    team: null, // ทีมของเรา จาก round_start
    solvedTeams: [], // ทีมที่มีคนทายถูกแล้วในตานี้ (ชื่อทีมเท่านั้น)
    firstTeam: null, // ทีมที่ทายถูกก่อน (ได้โบนัส +100 ต่อคนที่ทายถูก) null = ยังไม่มี/ไม่รู้
    teamSkipped: false, // ตานี้ทีมเราไม่มีคนวาด (ถูกข้าม)
    teamRanking: null, // จาก game_end
    winner: null, // "A".."D" | null (เสมอ)
    guessed: [], // playerId ที่ทายถูกในตานี้ ไว้ขึ้น ✅
    messages: [], // แชท
    // นับขึ้นทุกครั้งที่ขึ้นตาใหม่ — ใช้เป็นคีย์บอกกล่องแชทว่า "ขึ้นตาใหม่แล้ว โฟกัสช่องพิมพ์ให้หน่อย"
    // (ข้อ 3 เดิมกระดานใช้ค่านี้ล้างจอ แต่ข้อ 4 ย้ายไปใช้คำสั่ง resetBoard ผ่านคิวเดียวกับ canvas_history แล้ว)
    roundKey: 0,
    // สถานะปุ่มย้อน/ทำซ้ำ (ข้อ 4) — server เป็นคนบอก เพราะ server เป็นเจ้าของลำดับการวาด
    // client ทำนายล่วงหน้าได้แค่ตอนวาดเพิ่ม (ดู sendAction) แล้วรอ server ยืนยันด้วย canvas_history
    canUndo: false,
    canRedo: false,
    // คำใบ้ขึ้นช้า — null จนกว่า server จะเปิด (ดู hint_reveal) ห้ามเดาเองในเครื่อง
    // ถ้า client เผลอสร้างคำใบ้เอง คนทายจะได้เปรียบโดยไม่รู้ตัว
    hint: null,
    hintAt: null, // เปิดเองเมื่อเวลาเหลือเท่านี้ (จาก round_start) ใช้โชว์ข้อความรอ
    // dont_lift_pen — true เมื่อ server บอกว่า "คนวาดยกปากกาแล้ว" (event pen_locked)
    // client ไม่เดาเองจาก "วาดไปกี่เส้น" เพราะคนวาดอาจกดค้างไม่ยอมปล่อยก็ได้
    penLocked: false,
    // Mini Challenge ที่คนวาดรู้ก่อนเลือกคำ (จาก choose_word) · intro = ช่วงป้ายใหญ่ (ห้ามวาด เวลายังไม่เดิน) จนกว่าจะได้ intro_end
    chooseChallenge: null,
    intro: false,
  };
}

/**
 * รวมสถานะของเกมที่กำลังเล่นอยู่ไว้ที่เดียว
 *
 * ทำไมต้องเป็น hook ที่ App เรียก ไม่ให้หน้า Game ผูก socket เอง
 * เพราะหน้า Game ถูกสร้างตอนได้ game_started เท่านั้น ถ้ามันผูก socket เอง
 * event ที่มาถึงก่อนมันเกิดจะหลุดไปเลย — เช่นตอนเข้าห้องกลางเกม server ส่ง
 * game_started แล้วตามด้วย round_start ทันที ซึ่งจังหวะนั้นหน้า Game ยังไม่ทันเกิด
 * App อยู่ตลอดตั้งแต่เปิดหน้าเว็บ จึงไม่มี event ไหนหลุด
 * (บทเรียนเดียวกับบั๊ก StrictMode ในข้อ 1: event ที่พลาดไปแล้วจะไม่ยิงซ้ำ)
 */
// จำกัดความถี่การทายตัวเดียวกับ server (GUESS_MAX / GUESS_WINDOW_MS ใน server/index.js) — ใช้แค่บอกผู้เล่น
// server ยังเป็นคนตัดสินและทิ้งเงียบเหมือนเดิม ฝั่งนี้แค่ไม่ส่งข้อความที่ server จะทิ้งอยู่แล้ว แล้วโชว์ Toast
// ข้อความ "ใกล้แล้ว" (ตายตัวที่หน้าเว็บ — server ไม่ส่งข้อความมาเลย จึงไม่มีทางมีคำตอบปน)
export const CLOSE_GUESS_TEXT = "ใกล้แล้ว! ลองเช็กคำที่พิมพ์อีกที";
const GUESS_MAX = 10;
const GUESS_WINDOW_MS = 5000;

export function useGame({ onRateLimited } = {}) {
  const rateRef = useRef({ times: [], onRateLimited });
  rateRef.current.onRateLimited = onRateLimited;
  const [game, setGame] = useState(emptyGame);
  const [chooseLeft, setChooseLeft] = useState(0);
  const playersRef = useRef(null); // รายชื่อผู้เล่นรอบก่อน ไว้เทียบว่าใครเข้าออก
  // ปลายทางของ action ที่มาจากคนอื่น — หน้า Game เป็นคนตั้งให้ เพราะมันถือ ref ของกระดานอยู่
  // (กระดานอยู่ลึกกว่านี้ เจ้านี้จึงไม่ถือ ref เอง เหมือนที่หน้านี้ไม่ถือ socket ของหน้า Game)
  const canvasApiRef = useRef(null);
  const introTimerRef = useRef(null); // กันเหนียว: ถ้าไม่ได้ intro_end (หลุด) ปลดล็อกเองหลัง 5 วิ — server ยังทิ้งการวาดที่มาก่อนเวลาอยู่ดี
  // คำสั่งวาดที่มาถึง "ก่อนกระดานจะเกิด" — ต้องพักไว้ก่อนแล้วค่อยวาดตอนกระดานพร้อม
  // จำเป็นจริงๆ ไม่ใช่กันเหนียว: ตอนเข้าห้องกลางตา server ส่ง game_started ต่อด้วย round_start
  // แล้วต่อด้วย canvas_history มาพร้อมกันในจังหวะเดียว แต่ตอนนั้น React ยังไม่ทันวาดหน้า Game
  // ถ้าทิ้งไปเลย คนที่เข้าทีหลังจะเห็นกระดานเปล่า ทั้งที่ในห้องมีรูปอยู่
  // (บทเรียนเดียวกับบั๊ก StrictMode ตอนข้อ 1 และบั๊ก listener ตอนข้อ 2 — "ของมาถึงก่อนเจ้าบ้าน")
  const pendingCanvasRef = useRef([]);

  useEffect(() => {
    // ใช้ฟังก์ชันรับค่าเก่า จะได้ไม่ต้องกังวลเรื่อง state ค้าง
    const patch = (fields) => setGame((g) => ({ ...g, ...fields }));

    // ประตูเดียวที่ทุกอย่างซึ่งเปลี่ยนภาพบนกระดานต้องผ่าน — ไม่ว่ามาจาก socket หรือจากในเครื่อง
    // วาดลงจอเลยถ้ากระดานพร้อม ถ้ายังก็พักไว้ก่อน แล้วระบายตามลำดับตอนกระดานเกิด (ดู bindCanvas)
    // การมีประตูเดียวคือเหตุผลที่ "ขึ้นตาใหม่" กับ "รับประวัติจาก server" เรียงลำดับกันได้แน่นอน
    const toCanvas = (cmd) => {
      if (canvasApiRef.current) cmd.apply(canvasApiRef.current);
      else pendingCanvasRef.current.push(cmd);
    };

    const onGameStarted = (data) =>
      setGame({ ...emptyGame(), active: true, totalRounds: data?.totalRounds ?? null });

    // มาถึงตอนนี้แปลว่าตาเก่าจบไป 3 วิแล้ว (server หน่วงก่อนขึ้นตาใหม่)
    // ต้องปิด modal สรุปตาไปพร้อมกัน ไม่งั้นคนวาดจะเห็นสอง modal ซ้อนกัน
    const onChooseWord = (data) =>
      patch({ options: data.options, chooseTime: data.time, summary: null, chooseChallenge: data.challenge ?? null });

    // ป้ายใหญ่หายแล้ว: คนวาดเริ่มวาดได้ เวลาเริ่มเดิน (server เป็นคนบอก)
    const onIntroEnd = () => {
      clearTimeout(introTimerRef.current);
      patch({ intro: false });
    };

    // ตาใหม่มาแล้ว ล้างของตาที่แล้วทั้งหมด (ตัวเลือกคำ สรุปตา คำจริง คนที่ทายถูก)
    // roundKey ต้องบวกจากค่าเดิม (ไม่ใช้ค่าคงที่) ไม่งั้นกล่องแชทจะไม่รู้ว่าขึ้นตาใหม่แล้วต้องโฟกัสช่องพิมพ์
    const onRoundStart = (data) => {
      // ตาใหม่ = ล้างกระดาน ผ่านประตูเดียวกับทุกอย่าง
      // สำคัญ: ต้องเข้าคิวเดียวกับ canvas_history ไม่ใช่ useEffect ที่เฝ้าค่า roundKey ในกระดาน
      // ตอนแรกเขียนเป็น useEffect แล้วได้บั๊กแบบสุ่ม — พอ round_start ของจริงตกลง state
      // ค่า roundKey เปลี่ยน 0→1 แล้วไปล้างภาพที่ canvas_history เพิ่งวาดเสร็จหมาดๆ ทิ้ง
      // ใครเข้าห้องกลางตาจะเห็นกระดานว่างเปล่า บางรอบเป็นบางรอบไม่เป็น (แล้วแต่ใครถึงก่อน)
      // เรียงในคิวเดียวกันแล้วไม่มีทางสลับ เพราะ socket ส่ง round_start มาก่อน canvas_history เสมอ
      toCanvas({ apply: (api) => api.resetBoard() });
      clearTimeout(introTimerRef.current);
      if (data.intro) introTimerRef.current = setTimeout(() => patch({ intro: false }), 5000);
      setGame((g) => ({
        ...g,
        round: data,
        roundNo: data.round,
        totalRounds: data.totalRounds,
        drawerId: data.drawerId,
        timeLeft: data.time,
        options: null,
        chooseChallenge: null,
        intro: Boolean(data.intro),
        summary: null,
        word: null,
        // คนที่ทายถูกไปก่อนเราเข้าห้อง server บอกมาพร้อม round_start (guessedIds)
        // ไม่งั้นคนที่เข้าห้องกลางตาจะไม่เห็น ✅ ของคนที่ทายไปแล้ว (งานค้างจากข้อ 2)
        guessed: data.guessedIds ?? [],
        // โหมดทีม: ทีมของเรา · ทีมที่ทายถูกไปแล้ว (ถ้าเข้ากลางตา) · ทีมเราไม่มีคนวาดไหม
        // (round_start ของทีมที่ถูกข้างตั้งแต่เลือกคำมี drawerId: null)
        team: data.team ?? null,
        solvedTeams: data.solvedTeams ?? [],
        firstTeam: data.solvedTeams?.length === 1 ? data.solvedTeams[0] : null,
        teamSkipped: Boolean(data.team) && data.drawerId === null,
        roundKey: g.roundKey + 1,
        canUndo: false, // ตาใหม่ = กระดานว่าง server ล้างประวัติแล้ว
        canRedo: false,
        // ตาใหม่ = คำใบ้ยังไม่เปิด จึงเป็น null ตามปกติ
        // ยกเว้นกรณีที่เราเข้าห้องกลางตาหลังเขาเปิดไปแล้ว server จะส่งชุดช่องจริงมาให้เลย
        hint: data.hint ?? null,
        hintAt: data.hintAt ?? null,
        // ตาใหม่ = ปากกายังไม่ถูกล็อก (กติกา dont_lift_pen เป็นของรายตา ไม่ลามไปตาถัดไป)
        penLocked: false,
      }));
    };

    // dont_lift_pen: คนวาดยกปากกาแล้ว — server ส่งครั้งเดียวต่อตา (events.md pen_locked)
    // เอาไว้ปิดเครื่องมือวาดของเรา เป็นแค่การช่วยให้ใช้ง่าย ของจริง server บังคับอยู่แล้ว
    // ข้อความระบบใส่กล่อง "ในห้อง" เพื่อให้ทุกคน (รวมคนที่ไม่ได้วาด) เข้าใจว่าทำไมภาพหยุด
    // โหมดทีม: คนวาดของทีมเราหลุดกลางตา → ทีมเราถูกข้ามตานี้ (server ส่งถึงทีมเราเท่านั้น)
    const onTeamSkipped = () =>
      setGame((g) => ({
        ...g,
        teamSkipped: true,
        messages: [...g.messages, { system: true, kind: "leave", text: "คนวาดของทีมหลุด ตานี้ทีมเราไม่มีคนวาด" }],
      }));

    const onPenLocked = () =>
      setGame((g) => ({
        ...g,
        penLocked: true,
        messages: [...g.messages, { system: true, kind: "pen", text: "คนวาดยกปากกาแล้ว วาดต่อไม่ได้อีก" }],
      }));

    // คำใบ้เปิดแล้ว — server ส่งครั้งเดียวต่อตา ไม่ว่าใครเปิด (คนวาดกดขอ หรือเวลาเหลือหนึ่งในสาม)
    // ข้อความระบบแยกตามคนเปิด เพื่อให้กล่อง "ในห้อง" เล่าเรื่องได้ครบ
    const onHintReveal = (data) =>
      setGame((g) => ({
        ...g,
        hint: data?.hint ?? null,
        messages: [
          ...g.messages,
          { system: true, kind: "hint", text: data?.by === "drawer" ? "คนวาดเปิดคำใบ้แล้ว" : "คำใบ้เปิดแล้ว" },
        ],
      }));

    const onYourWord = (data) => patch({ word: data.word });
    const onTimer = (data) => patch({ timeLeft: data.timeLeft });

    // จบตา: ซ่อนคำใบ้ ทิ้งตัวเลือก เก็บสรุปไว้โชว์เป็น modal
    // เวลาหมดจริง = เลขนาฬิกาตัวสุดท้ายที่ server ส่งมาเป็น 0 (จบเพราะทุกคนทายถูกจะยังเหลือเวลา)
    // server ส่ง timer 0 ก่อน round_end เสมอ จึงอ่านจาก state ได้ตรงๆ
    const onRoundEnd = (data) =>
      setGame((g) => ({
        ...g,
        summary: data,
        round: null,
        word: null,
        options: null,
        hint: null,
        messages: g.timeLeft === 0 ? [...g.messages, { system: true, kind: "timeout", text: "หมดเวลา!" }] : g.messages,
      }));

    // จบเกม: เก็บอันดับไว้โชว์ ส่วนประวัติแชทคงไว้ให้อ่านย้อนหลังได้ระหว่างดูอันดับ
    const onGameEnd = (data) =>
      setGame((g) => ({
        ...emptyGame(),
        messages: g.messages,
        ranking: data.ranking,
        teamRanking: data.teamRanking ?? null,
        winner: data.winner ?? null,
        totalRounds: g.totalRounds,
      }));

    const onChat = (msg) => setGame((g) => ({ ...g, messages: [...g.messages, msg] }));
    // ทายผิดแต่ใกล้มาก — server ส่งถึงเราคนเดียว (ไม่มีคำตอบใน event) ขึ้นเป็นบรรทัดส่วนตัวในกล่องคำตอบ
    const onCloseGuess = () => setGame((g) => ({ ...g, messages: [...g.messages, { close: true, text: CLOSE_GUESS_TEXT }] }));

    // ทายถูก: เก็บ id ไว้ขึ้น ✅ ที่แถบรายชื่อ และเพิ่มข้อความระบบไว้กล่อง "ในห้อง"
    // server ไม่ได้ส่งข้อความระบบนี้มา (ส่งมาแค่ id กับชื่อ) จึงประกอบเองฝั่งนี้
    //
    // โหมดทีม (events.md หัวข้อ 8) มีสองหน้าตา:
    //   { playerId, name, team } — คนในทีมเราทายถูก (ติ๊ก ✅ ได้)
    //   { team }                 — ทีมอื่นมีคนทายถูกคนแรก (ไม่มีชื่อ ไม่มีคำ) ใช้บอกใน "ในห้อง" เท่านั้น
    // ทีมที่ทายถูกก่อนได้โบนัส +100 ต่อคน — จำว่าทีมไหนก่อนจากลำดับที่ event มาถึง (server ส่งเรียงตามจริง)
    const onCorrectGuess = (data) =>
      setGame((g) => {
        const note = (kind, text) => ({ system: true, kind, text });
        if (!data.team) {
          return {
            ...g,
            guessed: [...g.guessed, data.playerId],
            messages: [...g.messages, note("correct", `${data.name} ทายถูก`)],
          };
        }
        const isFirst = !g.solvedTeams.includes(data.team) && g.solvedTeams.length === 0;
        const teamNew = !g.solvedTeams.includes(data.team);
        const solvedTeams = teamNew ? [...g.solvedTeams, data.team] : g.solvedTeams;
        const firstTeam = isFirst ? data.team : g.firstTeam;
        const msgs = [];
        if (data.playerId) {
          const bonus = firstTeam === data.team ? " (โบนัสทีมแรก +100)" : "";
          msgs.push(note("correct", `${data.name} ทายถูก${bonus}`));
        }
        if (teamNew) {
          msgs.push(
            note(
              "team",
              isFirst
                ? `ทีม ${data.team} ทายถูกก่อน! ทุกคนที่ทายถูกในทีมได้โบนัส +100`
                : `ทีม ${data.team} ทายถูกแล้ว (ทีมที่ตามมาไม่ได้โบนัส)`
            )
          );
        }
        return {
          ...g,
          guessed: data.playerId ? [...g.guessed, data.playerId] : g.guessed,
          solvedTeams,
          firstTeam,
          messages: [...g.messages, ...msgs],
        };
      });

    // ข้อความระบบ "ใครเข้าออก" — server ไม่ได้ส่ง event นี้มา ต้องเทียบรายชื่อเอาเอง
    const onRoomUpdate = (next) => {
      const prev = playersRef.current;
      const notes = [];
      if (prev) {
        for (const p of next.players) {
          const old = prev.get(p.id);
          if (!old) notes.push({ system: true, kind: "join", text: `${p.name} เข้าห้อง` });
          // หลุดชั่วคราว / กลับมาทันเวลา (server ยังเก็บที่ไว้ให้ 30 วิ ดูช่อง connected)
          else if (old.connected !== false && p.connected === false) notes.push({ system: true, kind: "leave", text: `${p.name} หลุด (รอกลับมา 30 วิ)` });
          else if (old.connected === false && p.connected !== false) notes.push({ system: true, kind: "join", text: `${p.name} กลับมาแล้ว` });
        }
        for (const p of prev.values()) {
          if (!next.players.some((x) => x.id === p.id)) notes.push({ system: true, kind: "leave", text: `${p.name} ออกจากห้อง` });
        }
      }
      playersRef.current = new Map(next.players.map((p) => [p.id, p]));
      if (notes.length > 0) setGame((g) => ({ ...g, messages: [...g.messages, ...notes] }));
    };

    // ── การวาด (ข้อ 4) ──
    // action ของคนวาด ไหลเข้า applyRemote ตัวเดียวกับที่กระดานใช้ตอนวาดเอง
    // จึงได้เส้นเหมือนกันเป๊ะ เพราะเป็น painter ตัวเดียวกัน กรองจุดซ้ำมาแล้วจาก server
    const drawHandlers = DRAW_EVENTS.map((type) => [
      type,
      (data) => {
        const action = { type, ...(data ?? {}) };
        toCanvas({ apply: (api) => api.applyRemote(action) });
      },
    ]);

    // ภาพทั้งชุดจาก server — มาสองจังหวะ
    //   1) ตอนเราเข้าห้องกลางตา (server ส่งให้คนเดียว)
    //   2) ตอนคนวาดกดย้อนกลับ/ทำซ้ำ (server ส่งให้ทั้งห้อง)
    // สองจังหวะใช้ทางเดียวกันได้ เพราะผลที่ต้องการเหมือนกัน: "ลืมของเดิม วาดใหม่ตามลิสต์นี้"
    const onCanvasHistory = (data) => {
      const items = data?.items ?? [];
      const cmd = { apply: (api) => api.applyHistory(items) };
      if (canvasApiRef.current) {
        pendingCanvasRef.current = []; // ของจริงมาถึงแล้ว ของที่พักไว้ไม่ต้องใช้อีก
        cmd.apply(canvasApiRef.current);
      } else {
        // ประวัติทั้งชุดคือภาพล่าสุด ทับของที่พักไว้ก่อนหน้าทั้งหมด ไม่ใช่ต่อท้าย ไม่งั้นภาพซ้อนกันมั่ว
        pendingCanvasRef.current = [cmd];
      }
      // server เป็นคนบอกว่ายังย้อน/ทำซ้ำได้อีกไหม — client ไม่เดาเอง
      setGame((g) => ({ ...g, canUndo: !!data?.canUndo, canRedo: !!data?.canRedo }));
    };

    for (const [type, handler] of drawHandlers) socket.on(type, handler);
    socket.on("canvas_history", onCanvasHistory);

    socket.on("game_started", onGameStarted);
    socket.on("choose_word", onChooseWord);
    socket.on("round_start", onRoundStart);
    socket.on("intro_end", onIntroEnd);
    socket.on("your_word", onYourWord);
    socket.on("hint_reveal", onHintReveal);
    socket.on("pen_locked", onPenLocked);
    socket.on("team_skipped", onTeamSkipped);
    socket.on("timer", onTimer);
    socket.on("round_end", onRoundEnd);
    socket.on("game_end", onGameEnd);
    socket.on("chat_message", onChat);
    socket.on("close_guess", onCloseGuess);
    socket.on("correct_guess", onCorrectGuess);
    socket.on("room_update", onRoomUpdate);

    return () => {
      for (const [type, handler] of drawHandlers) socket.off(type, handler);
      socket.off("canvas_history", onCanvasHistory);
      socket.off("game_started", onGameStarted);
      socket.off("choose_word", onChooseWord);
      socket.off("round_start", onRoundStart);
      socket.off("intro_end", onIntroEnd);
      clearTimeout(introTimerRef.current);
      socket.off("your_word", onYourWord);
      socket.off("hint_reveal", onHintReveal);
      socket.off("pen_locked", onPenLocked);
      socket.off("team_skipped", onTeamSkipped);
      socket.off("timer", onTimer);
      socket.off("round_end", onRoundEnd);
      socket.off("game_end", onGameEnd);
      socket.off("chat_message", onChat);
      socket.off("close_guess", onCloseGuess);
      socket.off("correct_guess", onCorrectGuess);
      socket.off("room_update", onRoomUpdate);
    };
  }, []);

  // นับถอยหลังตอนเลือกคำ — server ไม่ได้ส่งเวลาช่วงนี้มาเป็นรายวินาที (timer เริ่มตอนวาดแล้ว)
  // เลยนับเองในเครื่องเพื่อโชว์เฉยๆ ใครเลือกตอนไหนจริงๆ server เป็นคนตัดสิน
  useEffect(() => {
    if (!game.options) {
      setChooseLeft(0);
      return;
    }
    setChooseLeft(game.chooseTime ?? 10);
    const tick = setInterval(() => setChooseLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(tick);
  }, [game.options, game.chooseTime]);

  // ส่ง action ของกระดานไปให้ server (ข้อ 4 ข้อ 7)
  // action ในเครื่องเราหน้าตาเป็น { type, ...ช่องข้อมูล } ซึ่งตรงกับ events.md อยู่แล้ว
  // จึงแค่แยก type ออกมาเป็นชื่อ event ที่เหลือเป็น payload — ไม่ต้องแปลงอะไรอีก
  const sendAction = useCallback((action) => {
    const { type, ...payload } = action;
    socket.emit(type, payload);
    // วาดเพิ่มแล้ว = ย้อนได้แน่นอน และกองทำซ้ำหาย (server ทำเหมือนกัน)
    // ที่ต้องทำนายตรงนี้ด้วย เพราะ server ไม่ได้ส่งอะไรกลับมาให้ action ที่ถูกต้อง
    // (มันส่งต่อให้ "คนอื่น" เท่านั้น) — เดี๋ยว canvas_history จาก server จะมายืนยันอีกที
    setGame((g) => (g.canUndo && !g.canRedo ? g : { ...g, canUndo: true, canRedo: false }));
  }, []);

  // บอก server ว่า "ขอ" ย้อน/ทำซ้ำ — server เป็นคนตัดสินว่าทำได้จริงไหม
  // แล้วตอบกลับด้วย canvas_history ที่มีสถานะปุ่มล่าสุดมาด้วย
  const askUndo = useCallback(() => socket.emit("undo"), []);
  const askRedo = useCallback(() => socket.emit("redo"), []);

  // ขอเปิดคำใบ้ก่อนเวลา (คนวาดเท่านั้น) — เหมือน askUndo: แค่ "ขอ" server เป็นคนตัดสิน
  // ไม่ต้องปิดปุ่มเองในเครื่อง ปุ่มจะปิดเองเมื่อได้ hint_reveal กลับมา (game.hint มีค่า)
  const askHint = useCallback(() => socket.emit("request_hint"), []);

  // ให้หน้า Game ผูก ref ของกระดานเข้ามา เพื่อรับ action ของคนอื่นไปวาด
  // และระบายของที่พักไว้ตอนกระดานยังไม่เกิดออกไปตามลำดับที่มาถึง
  const bindCanvas = useCallback((api) => {
    canvasApiRef.current = api;
    if (!api) return; // กระดานถูกถอด (StrictMode ถอดแล้วใส่ใหม่) ของที่มาถึงระหว่างนั้นรอต่อได้
    const queued = pendingCanvasRef.current;
    pendingCanvasRef.current = [];
    for (const cmd of queued) cmd.apply(api);
  }, []);

  return {
    game,
    chooseLeft,
    sendAction,
    askUndo,
    askRedo,
    askHint,
    bindCanvas,
    chooseWord: (word) => socket.emit("word_chosen", { word }),
    sendGuess: (text) => {
      const now = Date.now();
      const times = rateRef.current.times.filter((t) => now - t <= GUESS_WINDOW_MS);
      rateRef.current.times = times;
      if (times.length >= GUESS_MAX) {
        rateRef.current.onRateLimited?.(); // พิมพ์เร็วเกินไป (server จะทิ้งข้อความนี้อยู่แล้ว)
        return;
      }
      times.push(now);
      socket.emit("guess", { text });
    },
    startGame: () => socket.emit("start_game"),
    // ออกจากห้องแล้วล้างให้เกลี้ยง ไม่งั้นกลับเข้าห้องใหม่แล้วอาจเห็นของเก่าค้างอยู่แวบหนึ่ง
    resetGame: () => {
      setGame(emptyGame());
      playersRef.current = null;
      pendingCanvasRef.current = [];
    },
  };
}

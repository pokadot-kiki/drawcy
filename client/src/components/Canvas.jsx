import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPainter, strokeShape } from "../canvas/painter";
import { beginStroke, extendStroke, endStroke, applyFill, clearBoard, drawShape } from "../canvas/actions";
import { TOOLS, isShapeTool } from "../canvas/palette";
import { boardCursor } from "../canvas/cursor";
import { reduceMotion } from "../prefs";

// ─────────────────────────────────────────────────────────────────────────
// โหมดดีบักชั่วคราว — เปิดด้วย ?debug=1 ต่อท้ายที่อยู่เว็บ
//
// ทำขึ้นเพราะเทสบนไอแพด (Safari) แล้วเจอ "เส้นเหลี่ยม" แต่เครื่องที่พัฒนาใช้ทดสอบ
// ไม่ใช่ Safari จึงไม่มีทางเห็นอาการเอง ต้องให้เครื่องที่เจอปัญหาเป็นคนรายงานตัวเลขกลับมา
//
// ลบทั้งโหมดได้เมื่อหาเสร็จ — ค้นคำว่า "โหมดดีบัก" แล้วลบใน 3 ที่
//   Canvas.jsx (บล็อกนี้ + ตัวนับใน handleDown/handleMove/handleUp + <pre> ท้ายไฟล์)
//   painter.js (ตัวนับ dbg กับ debugStats/debugReset)
//   theme.css (.board__debug กับ .board { position: relative })
// ─────────────────────────────────────────────────────────────────────────

// อ่านครั้งเดียวตอนโหลด เพราะที่อยู่เว็บไม่เปลี่ยนระหว่างเล่น
const DEBUG =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");

// ตรวจว่าเบราว์เซอร์นี้รู้จัก getCoalescedEvents ไหม (Safari รุ่นเก่าไม่รู้จัก)
// เช็คที่ prototype ไม่ใช่ที่ event เพราะต้องรู้ก่อนจะมี event แรกด้วยซ้ำ
const HAS_COALESCED =
  typeof PointerEvent !== "undefined" &&
  typeof PointerEvent.prototype.getCoalescedEvents === "function";

// events.md สั่งให้รวมจุดแล้ว "ส่ง" ทุก ~30-50ms ไม่ใช่ส่งทุกครั้งที่เมาส์ขยับ
// เราจึงพักจุดไว้ก่อน แล้วค่อยระบายออกเป็นชุดตามรอบเวลานี้
// ผลพลอยได้คือลิสต์ action ไม่บวมเป็นพันรายการตอนลากเส้นยาวๆ
//
// ⚠️ รอบนี้ใช้กับการ "ส่ง" เท่านั้น ไม่ใช่การ "วาด"
// เดิมทีเดียวใช้คุมทั้งสองอย่าง พอวัดจริงจึงรู้ว่าผิด: เส้นถูกวาดลงจอแค่ 25 ครั้ง/วิ (ทุก 40ms)
// วัดได้ว่ากว่าจุดจะโผล่บนจอช้ากว่ามือ 20-40ms และมี 36 ช่วงที่เส้นหยุดนิ่งเกิน 12ms แล้วโผล่ทีเดียว
// ยิ่งลากเร็ว ช่องว่างระหว่างก้อนยิ่งยาว จึงเห็นเป็นเส้นหักเป็นท่อน ๆ (อาการที่ผู้ใช้เจอ)
// ตอนนี้จึงวาดทันทีทุกครั้งที่เมาส์ขยับ แต่ยังรวมส่งเป็นชุดทุก 40ms ตามสัญญา
const FLUSH_MS = 40;

// ปัดพิกัดเหลือ 4 ตำแหน่ง พอสำหรับจอทุกขนาด แต่ payload เล็กลงมาก
const round4 = (v) => Math.round(v * 10000) / 10000;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * กระดานวาด — ข้อ 3
 *
 * ทุกการกระทำบนกระดานไหลผ่าน dispatch() ที่เดียว
 *   dispatch = วาดลงจอ → เก็บเข้าลิสต์ → ส่งออกทาง onAction
 * ข้อ 4 จึงเหลือแค่ต่อปลายสองทาง: onAction → socket.emit, และเรียก ref.applyRemote() เมื่อได้ action ของคนอื่น
 *
 * ลิสต์ action ยังเป็นแหล่งความจริงเดียวของ "ตานี้วาดอะไรไปแล้ว"
 * ใช้ทั้งตอนจอเปลี่ยนขนาด (วาดซ้ำ) และจะใช้เป็น canvas_history ในข้อ 4
 */
// empty = สิ่งที่โชว์กลางกระดานตอนยังไม่มีเส้น (มาสคอต) · หายเองเมื่อมีเส้นแรก และกลับมาถ้าล้างจอ
const Canvas = forwardRef(function Canvas({ canDraw, tool, color, size, onAction, empty = null, notice = null, overlay = null }, ref) {
  const [hasInk, setHasInk] = useState(false);
  // ── มาสคอตกลางกระดาน (prop empty) ──
  // ขึ้นตอนเริ่มตา/ช่วงเลือกคำเท่านั้น หายเมื่อมีเส้นแรก หรือครบ 3 วิ อย่างใดอย่างหนึ่งก่อน
  // หายแล้วไม่กลับมาอีกตลอดตานั้น (แม้ล้างจอ/ย้อนจนว่าง) จนกว่า resetBoard (ขึ้นตาใหม่) จะเริ่มรอบใหม่
  // sceneN นับตาใหม่ · goneFor = เลขตาที่มาสคอตหายไปแล้ว · fading = กำลังจางออก
  const [sceneN, setSceneN] = useState(0);
  const [goneFor, setGoneFor] = useState(-1);
  const [fading, setFading] = useState(false);
  const lastEmptyRef = useRef(null);
  const mascotOn = Boolean(empty) && !hasInk && goneFor !== sceneN;
  if (empty) lastEmptyRef.current = empty;
  const wasOnRef = useRef(false);

  useEffect(() => {
    if (!mascotOn) return undefined;
    const t = setTimeout(() => setGoneFor(sceneN), 3000);
    return () => clearTimeout(t);
  }, [mascotOn, sceneN]);

  // มีเส้นแรก = ถือว่าหายไปแล้วสำหรับตานี้ (ไม่กลับมาถึงล้างจอ)
  useEffect(() => {
    if (hasInk) setGoneFor(sceneN);
  }, [hasInk, sceneN]);

  // จากเปิด → ปิด: จางออก 0.5 วิแล้วค่อยถอดทิ้ง · ถ้าผู้ใช้ตั้งลดภาพเคลื่อนไหวไว้ ถอดทันที
  useEffect(() => {
    const wasOn = wasOnRef.current;
    wasOnRef.current = mascotOn;
    if (wasOn && !mascotOn && !reduceMotion()) {
      setFading(true);
      const t = setTimeout(() => setFading(false), 500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [mascotOn]);
  // มีหมึกบนกระดานไหม: action ล่าสุดไม่ใช่การล้างจอ (ถ้าลิสต์ว่างก็ไม่มี)
  const syncInk = () => {
    const list = actionsRef.current;
    setHasInk(list.length > 0 && list[list.length - 1].type !== "clear_canvas");
  };
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const previewRef = useRef(null); // ชั้นโปร่งใสทับกระดาน ไว้วาดเงารูปทรงตอนลาก (ไม่ใช่ภาพจริง ไม่เข้าลิสต์ action)
  const shapeRef = useRef(null); // รูปทรงที่กำลังลากอยู่ { shape, start, x1, y1, x2, y2 } · null = ไม่ได้ลากรูปทรง
  const painterRef = useRef(null);
  const actionsRef = useRef([]); // ทุก action ของตานี้ เรียงตามลำดับ

  // เก็บ callback ล่าสุดไว้ใน ref เพื่อให้ตัวที่ถูกเรียกจาก timer เห็นค่าใหม่อยู่เสมอ
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const pendingRef = useRef([]); // จุดที่รอส่ง
  const pointerRef = useRef(null); // pointerId ที่กำลังวาดอยู่ (กันนิ้วที่สอง)
  const timerRef = useRef(null);
  const lastPtRef = useRef(null); // จุดล่าสุดที่ "ส่งเข้า painter แล้ว" ใช้กรองจุดซ้ำ (ดู dedupe)

  // ── ตัวนับของโหมดดีบักชั่วคราว (?debug=1) — ลบได้ทั้งก้อน ──
  // เก็บใน ref ไม่ใช่ state เพราะถูกเขียนทุกครั้งที่นิ้วขยับ (วินาทีละหลายสิบครั้ง)
  // ถ้าเป็น state จะสั่งให้ React วาดจอใหม่ถี่เกินไปจนวาดไม่ทัน
  // ค่าถูกดึงไปแสดงเป็นรอบๆ ทุก 250ms แทน (ดู useEffect ด้านล่าง)
  const dbgRef = useRef({
    moves: 0, // handleMove ถูกเรียกกี่ครั้งในเส้นล่าสุด
    coalesced: 0, // รวมจำนวนจุดที่ getCoalescedEvents คืนมา
    points: 0, // รวมจำนวนจุดที่เก็บได้จริง
    dist: 0, // ผลรวมระยะห่างระหว่างจุดที่ติดกัน (CSS px)
    gaps: 0, // จำนวนช่วงที่คิดระยะ (ตัวหารของค่าเฉลี่ย)
    pointerType: "-", // mouse / touch / pen
    strokes: 0, // วาดไปกี่เส้นแล้วในตานี้
    cancels: 0, // pointercancel เจอกี่ครั้ง (สะสมทั้งเซสชัน ไม่รีเซ็ต)
    lastX: null, // ตำแหน่งจุดก่อนหน้า ไว้คิดระยะห่าง
    lastY: null,

    // ── รอบสอง: เพิ่มตามที่ผู้ใช้ขอ "เริ่มจากจุดซ้ำก่อน" (ไอแพดรายงานว่านิ้วเรียบ แต่ปากกาเหลี่ยม) ──
    dupes: 0, // จุดที่พิกัด 0–1 (ปัด 4 ตำแหน่ง) เท่ากับจุดก่อนหน้าสนิท → ช่วงนั้นยุบเป็นเส้นตรง
    nearDupes: 0, // ไม่เท่ากันเป๊ะแต่ห่างไม่ถึง 1 CSS px
    lastNx: null, // พิกัด 0–1 ของจุดก่อนหน้า (ไว้เทียบจุดซ้ำ — ต้องเทียบที่ค่านี้
    lastNy: null, //   ไม่ใช่ระยะพิกเซล เพราะพิกัดที่ส่งเข้า painter คือค่านี้)
    // ระยะห่าง "ระหว่างจุดที่ไม่ซ้ำ" — ตัวเลขนี้ทำนายความเหลี่ยมได้จริง
    // ส่วนค่าเฉลี่ยเดิม (จุดห่างกันเฉลี่ย) ถูกจุดซ้ำซึ่งมีระยะ 0 ฉุดให้ต่ำกว่าความจริง
    distinctDist: 0,
    distinctGaps: 0,
    lastDx: null,
    lastDy: null,

    buttons: null, // ค่า buttons ล่าสุดตอนขยับ (ปากกาลอย/hover จะได้ 0)
    pressure: null, // ค่า pressure ล่าสุด
    zeroButtonMoves: 0, // ขยับตอน buttons = 0 กี่ครั้ง — สัญญาณของปากกาลอยเหนือจอ
    ids: [], // pointerId ทุกตัวที่เคยเจอ
    lastId: null, // pointerId ของเส้นก่อนหน้า (ไว้ดูว่าเปลี่ยนกลางทางไหม)
    idChanges: 0, // เปลี่ยน pointerId ระหว่างเส้นกี่ครั้ง
    downs: 0,
    ups: 0,
    cancelEvts: 0,
    leaves: 0,
    lostCaptures: 0, // เสียการจับ pointer กลางคัน
    dropped: 0, // จุดที่ถูก "กรองทิ้ง" เพราะขยับไม่ถึง 1px (ตัวแก้ข้อ 2 ทำงานอยู่จริงไหม)
  });
  // อ่านค่าปัจจุบันทั้งหมดออกมาเป็นก้อนเดียว
  // ใช้ทั้งตอนเริ่ม (กล่องจะได้ขึ้นทันที ไม่ต้องรอครบรอบ 250ms ก่อน) และตอนอัปเดตเป็นรอบๆ
  function dbgSnapshot() {
    const d = dbgRef.current;
    const s = painterRef.current?.debugStats?.() ?? { curves: 0, straight: 0, tail: 0, dots: 0 };
    const canvas = canvasRef.current;
    return {
      moves: d.moves,
      coalesced: d.coalesced,
      points: d.points,
      spacing: d.gaps > 0 ? d.dist / d.gaps : 0,
      pointerType: d.pointerType,
      strokes: d.strokes,
      cancels: d.cancels,
      curves: s.curves,
      straight: s.straight,
      tail: s.tail,
      dots: s.dots,
      dupes: d.dupes,
      nearDupes: d.nearDupes,
      distinct: d.points - d.dupes - d.nearDupes,
      distinctSpacing: d.distinctGaps > 0 ? d.distinctDist / d.distinctGaps : 0,
      buttons: d.buttons,
      pressure: d.pressure,
      zeroButtonMoves: d.zeroButtonMoves,
      idCount: d.ids.length,
      idChanges: d.idChanges,
      downs: d.downs,
      ups: d.ups,
      cancelEvts: d.cancelEvts,
      leaves: d.leaves,
      lostCaptures: d.lostCaptures,
      dropped: d.dropped,
      boardCss: canvas ? `${Math.round(canvas.clientWidth)}×${Math.round(canvas.clientHeight)}` : "-",
      buffer: canvas ? `${canvas.width}×${canvas.height}` : "-",
      dpr: window.devicePixelRatio || 1,
    };
  }

  const [dbgView, setDbgView] = useState(() => (DEBUG ? dbgSnapshot() : null));

  // วาด action หนึ่งอัน — ทางเข้าจุดเดียวของการวาดทั้งกระดาน
  function dispatch(action) {
    painterRef.current?.apply(action);
    actionsRef.current.push(action);
    syncInk();
    onActionRef.current?.(action); // ข้อ 4 ต่อ socket ตรงนี้
  }

  // ตั้งขนาด canvas ตามขนาดที่ CSS ให้มา แล้ววาดซ้ำจากลิสต์
  function fit() {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const painter = painterRef.current;
    if (!wrap || !canvas || !painter) return;

    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;

    // จำกัด dpr ไว้ที่ 2 — จอ 3x ถ้าปล่อยเต็มจะได้ canvas ใหญ่เกินจำเป็นโดยตาแยกไม่ออก
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    const pv = previewRef.current;
    if (pv && (pv.width !== w || pv.height !== h)) {
      pv.width = w;
      pv.height = h;
    }

    // ตั้ง canvas.width เฉพาะตอนขนาดเปลี่ยนจริง เพราะการตั้งมันจะล้างภาพทิ้งทั้งใบ
    // (ถ้าตั้งทุกครั้ง ภาพจะหายวูบทุกครั้งที่จอขยับเล็กๆ)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    // สองบรรทัดนี้ต้องอยู่นอก if เสมอ
    // บทเรียนจากการรันเทสจริง: ตอนแรกเขียนให้ทั้งบล็อกอยู่ใน if ขนาดเปลี่ยน
    // พอ React (โหมด StrictMode) เรียก effect รอบสอง มันสร้าง painter ตัวใหม่ที่ยังไม่รู้ขนาด
    // แต่ canvas มีขนาดเดิมอยู่แล้ว จึงข้าม if ไป → painter ไม่เคยรู้ขนาด (w=h=0)
    // ทุกจุดที่วาดจึงคูณ 0 กลายเป็น (0,0) หมด ลากเมาส์แล้วไม่มีอะไรเกิดขึ้นเลย
    painter.setSize(cssW, cssH, dpr);
    painter.replay(actionsRef.current);
  }

  // ── ผูก painter กับ canvas ครั้งเดียว แล้วเฝ้าดูขนาดจอ ──
  useEffect(() => {
    painterRef.current = createPainter(canvasRef.current.getContext("2d"), DEBUG);
    fit();

    const ro = new ResizeObserver(fit);
    ro.observe(wrapRef.current);
    return () => {
      ro.disconnect();
      clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ขึ้นตาใหม่ ล้างกระดาน (โจทย์ข้อ 7) ──
  // เดิมเป็น useEffect ที่เฝ้าค่า resetKey แล้วล้างทุกครั้งที่ค่าปลี่ยน
  // บั๊กที่เจอตอนเทสข้อ 4: มันแข่งกับการรับ canvas_history ของคนที่เข้าห้องกลางตา
  //   ได้ประวัติมา → วาดลงจอกลายเป็น 2762 พิกเซล → พอ round_start ตกลง state ค่า roundKey เปลี่ยน
  //   effect นี้ก็ล้างทิ้ง → เหลือ 0 ภาพหายทั้งที่ไม่มี error สักตัว และเป็นบ้างไม่เป็นบ้างตามจังหวะ
  //   จับได้ด้วยการวัด "วาดเสร็จแล้วมีสีกี่พิกเซล" ไม่ใช่ด้วยการอ่านโค้ด
  // ย้ายมาเป็นคำสั่งที่ useGame เรียกผ่าน ref แทน → วิ่งในคิวเดียวกับ canvas_history จึงเรียงลำดับแน่นอน
  function resetBoard() {
    shapeRef.current = null; // ตาใหม่ ทิ้งรูปทรงที่ลากค้าง (ถ้ามี)
    drawPreview();
    actionsRef.current = [];
    pendingRef.current = [];
    painterRef.current?.replay([]);
    syncInk();
    setSceneN((n) => n + 1); // ตาใหม่ = มาสคอตมีสิทธิ์ขึ้นอีกหนึ่งรอบ
  }

  // ── โหมดดีบักชั่วคราว: ดึงตัวเลขออกมาแสดงเป็นรอบๆ ทุก 250ms ──
  // ไม่ผูกกับ pointermove เพราะจะทำให้ React วาดจอใหม่ถี่เกินไปจนเส้นกระตุก
  // 250ms ถี่พอให้เห็นตัวเลขขยับระหว่างลาก และไม่กระทบการวาด
  useEffect(() => {
    if (!DEBUG) return undefined;
    const id = setInterval(() => setDbgView(dbgSnapshot()), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── เงารูปทรงตอนลาก: วาดลงชั้นโปร่งใสด้านบน จางลงให้รู้ว่ายังไม่ได้วาดจริง ──
  // ปล่อยมือแล้วค่อย dispatch(drawShape) ลงกระดานจริง ชั้นนี้ถูกล้างทิ้งทันที
  function drawPreview() {
    const pv = previewRef.current;
    const wrap = wrapRef.current;
    if (!pv || !wrap) return;
    const ctx = pv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pv.width, pv.height);
    const s = shapeRef.current;
    if (!s || wrap.clientWidth <= 0) return;
    const k = pv.width / wrap.clientWidth;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 0.6;
    strokeShape(ctx, { ...s, color, size }, wrap.clientWidth, wrap.clientHeight);
    ctx.globalAlpha = 1;
  }

  // ปลายอีกด้านของรูปทรงจากตำแหน่งนิ้ว — วงกลมบังคับกรอบเป็นจัตุรัส "ตามพิกเซลจริง" (กระดานเป็น 4:3
  // จัตุรัสในพิกัด 0–1 จะกลายเป็นวงรี) แล้วไม่ให้ล้นขอบกระดาน · สัญญา draw_shape ส่งวงรีในกรอบอยู่แล้ว จึงไม่ต้องแก้ server
  function shapeEnd(s, p, rect) {
    if (s.shape !== "circle") return p;
    const dx = (p.x - s.start.x) * rect.width;
    const dy = (p.y - s.start.y) * rect.height;
    const sx = dx >= 0 ? 1 : -1;
    const sy = dy >= 0 ? 1 : -1;
    const roomX = (sx > 0 ? 1 - s.start.x : s.start.x) * rect.width;
    const roomY = (sy > 0 ? 1 - s.start.y : s.start.y) * rect.height;
    const side = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), roomX, roomY);
    return {
      x: round4(s.start.x + (sx * side) / rect.width),
      y: round4(s.start.y + (sy * side) / rect.height),
    };
  }

  function moveShape(e) {
    const s = shapeRef.current;
    const rect = canvasRef.current.getBoundingClientRect();
    const end = shapeEnd(s, toNorm(e.nativeEvent, rect), rect);
    s.x2 = end.x;
    s.y2 = end.y;
    drawPreview();
  }

  // ปล่อยมือ: commit=true วาดจริง (ถ้าลากไกลพอ ไม่ใช่แค่แตะ) · commit=false ยกเลิก (นิ้วถูกแย่ง/ตาใหม่)
  function finishShape(commit) {
    const s = shapeRef.current;
    const id = pointerRef.current;
    shapeRef.current = null;
    pointerRef.current = null;
    if (id !== null) {
      try {
        canvasRef.current?.releasePointerCapture(id);
      } catch {
        /* ไม่ได้จับอยู่ ก็ไม่เป็นไร */
      }
    }
    drawPreview();
    if (!s || !commit) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (Math.hypot((s.x2 - s.x1) * rect.width, (s.y2 - s.y1) * rect.height) < 4) return; // แค่แตะ ไม่นับ
    dispatch(drawShape({ shape: s.shape, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, color, size }));
  }

  // ── ทางเข้า/ออกของกระดาน ให้คนนอก (ปุ่มล้างจอบนแถบเครื่องมือ และข้อ 4) เรียกใช้ ──
  useImperativeHandle(ref, () => ({
    // action ที่เกิดในเครื่องเราแต่ไม่ได้มาจากการลากเส้น (เช่นกดปุ่มล้างจอ)
    // เข้าทางเดียวกับเส้นทุกอย่าง → วาด + เก็บ + ส่งออก
    dispatch,
    // action ที่มาจากคนวาด — วาดลงจอ + เก็บเข้าลิสต์ แต่ไม่ส่งต่อ (กันวนกลับ)
    applyRemote(action) {
      painterRef.current?.apply(action);
      actionsRef.current.push(action);
      syncInk();
    },
    // ขึ้นตาใหม่ — useGame เรียกผ่านประตูเดียวกับ action อื่น จึงไม่แซงกัน
    resetBoard,
    // canvas_history ทั้งก้อนที่ server ส่งมาตอนเข้าห้องกลางตา
    applyHistory(items) {
      actionsRef.current = [...items];
      painterRef.current?.replay(actionsRef.current);
      syncInk();
    },
    // ภาพกระดานตอนนี้เป็น data URL JPEG ย่อให้กว้างไม่เกิน maxWidth (ข้อ 7 Solo ส่งให้ AI ดู)
    // กระดานเป็นพื้นขาวทึบ (painter ถมสีพื้นเอง) JPEG จึงไม่ได้พื้นดำ · ย่อก่อนส่งเพื่อให้ข้อความเล็กและเร็ว
    snapshot(maxWidth = 512) {
      const src = canvasRef.current;
      if (!src || src.width === 0) return null;
      const w = Math.min(maxWidth, src.width);
      const h = Math.max(1, Math.round((src.height * w) / src.width));
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      out.getContext("2d").drawImage(src, 0, 0, w, h);
      return out.toDataURL("image/jpeg", 0.8);
    },
    // ให้ข้อ 4 เรียกอ่านได้ตอนขอประวัติ
    getActions() {
      return actionsRef.current;
    },
  }));

  // ── แปลงตำแหน่งนิ้ว/เมาส์เป็นสัดส่วน 0–1 ตาม events.md ──
  // รับ rect เข้ามาจากคนเรียก เพราะจุดหลายจุดของเหตุการณ์เดียวกันใช้ rect อันเดียวกันได้
  // (เรียก getBoundingClientRect ซ้ำทุกจุดจะช้ากว่าที่ควร เพราะมันสั่งให้เบราว์เซอร์คิด layout ใหม่)
  function toNorm(e, rect) {
    return {
      x: round4(clamp01((e.clientX - rect.left) / rect.width)),
      y: round4(clamp01((e.clientY - rect.top) / rect.height)),
    };
  }

  // ระบายจุดที่พักไว้ออกเป็น stroke_points หนึ่งชุด
  //
  // ที่นี่ "ไม่วาดลงจอ" เพราะจุดพวกนี้ถูกวาดไปแล้วตอนเมาส์ขยับ (ดู handleMove)
  // ทำแบบนี้ได้เพราะการวาดเป็นฟังก์ชันของ "ลำดับจุด" ไม่ใช่ "การแบ่งชุด"
  // ไม่ว่าจุด 8 จุดจะมาทีเดียวหรือมาทีละจุด ผลลัพธ์บนจอเท่ากันเป๊ะ
  // จึงวาดสดทีละจุดเพื่อให้ทันมือ แต่ยังเก็บและส่งเป็นชุดเพื่อลดข้อความบนสาย
  // และตอน replay จากลิสต์ (จอเปลี่ยนขนาด / ข้อ 4) ก็ได้ภาพเดิมเพราะลำดับจุดยังเหมือนเดิม
  function flush() {
    if (pendingRef.current.length === 0) return;
    const points = pendingRef.current;
    pendingRef.current = [];
    const action = extendStroke(points);
    actionsRef.current.push(action);
    onActionRef.current?.(action); // ข้อ 4 ต่อ socket ตรงนี้
  }

  // ─────────────────────────────────────────────────────────────────────
  // กรอง "จุดซ้ำ" ทิ้ง — ตัวแก้หลักของอาการ "ปากกาเหลี่ยมบนไอแพด"
  //
  // ทำไมจุดซ้ำทำให้เส้นเหลี่ยม (วัดจริงใน /tmp/dupe-corner.mjs):
  //   เส้นโค้งช่วงหนึ่งวาดจากจุดกึ่งกลางหนึ่ง ไปยังจุดกึ่งกลางถัดไป โดยมี "จุดจริง" เป็นจุดควบคุม
  //   ถ้าจุดใหม่ซ้ำกับจุดเดิมพอดี จุดกึ่งกลางจะเท่ากับจุดเดิม → จุดควบคุมทับกับจุดปลาย
  //   สมการกำลังสองยุบเป็น "เส้นตรง" และช่วงถัดไปก็ยุบเป็นเส้นตรงอีกช่วง
  //   สองเส้นตรงมาบรรจบกันที่จุดซ้ำนั้น ด้วย "มุมหักเต็มๆ ของเส้นหัก"
  //
  //   วัดบนวงก้นหอยแน่น (รัศมี 8–98px บนกระดาน 420×321) ที่จุดห่างกัน 20px
  //     จุดซ้ำ 0%  → มุมหักสูงสุด   0.00° (0 มุมที่เกิน 15°)
  //     จุดซ้ำ 40% → มุมหักสูงสุด 101.81° (35 มุมที่เกิน 15°)   ← ตรงกับที่ผู้ใช้เจอบนไอแพด
  //     กรองจุดซ้ำออกแล้ว → กลับมา 0.00° (0 มุม)
  //
  // ตัวเลขของผู้ใช้: นิ้ว 124 จุด โค้ง 122 ตรง 3 (เรียบ) · ปากกา 137 จุด โค้ง 71 ตรง 67 (เหลี่ยม)
  //   "ตรง 67" คือราวครึ่งหนึ่งของจุดทั้งหมด = จุดซ้ำเยอะ ซึ่งตรงกับแถว 40–50% พอดี
  //
  // เกณฑ์ 1px (ไม่ใช่ 0) เพราะจุดที่ขยับไม่ถึงพิกเซลก็ไม่ได้ข้อมูลใหม่ และยังทำให้ช่วงยุบได้
  // เทียบเป็นพิกเซลจริงบนกระดาน ไม่เทียบในพิกัด 0–1 เพราะกระดานแต่ละจอขนาดไม่เท่ากัน
  // ─────────────────────────────────────────────────────────────────────
  const MIN_STEP_PX = 1;

  function dedupe(points, rect) {
    const out = [];
    let last = lastPtRef.current;
    for (const p of points) {
      if (last !== null) {
        const dx = (p.x - last.x) * rect.width;
        const dy = (p.y - last.y) * rect.height;
        if (Math.hypot(dx, dy) < MIN_STEP_PX) {
          if (DEBUG) dbgRef.current.dropped++; // นับไว้ยืนยันว่ากรองทำงานจริง
          continue; // ขยับไม่ถึง 1px ทิ้งได้ ไม่เสียข้อมูล
        }
      }
      out.push(p);
      last = p;
    }
    lastPtRef.current = last;
    return out;
  }

  function handleDown(e) {
    if (!canDraw || pointerRef.current !== null) return;

    // เริ่มเส้นใหม่ = เริ่มนับใหม่ (ตัวนับใน painter รวมการวาดซ้ำตอนจอเปลี่ยนขนาดมาด้วย
    // จึงต้องล้างตรงนี้ เพื่อให้ตัวเลขหมายถึงเส้นที่เพิ่งลากจริงๆ)
    if (DEBUG) {
      const d = dbgRef.current;
      d.moves = 0;
      d.coalesced = 0;
      d.points = 0;
      d.dist = 0;
      d.gaps = 0;
      d.lastX = null;
      d.lastY = null;
      d.dupes = 0;
      d.nearDupes = 0;
      d.lastNx = null;
      d.lastNy = null;
      d.distinctDist = 0;
      d.distinctGaps = 0;
      d.lastDx = null;
      d.lastDy = null;
      d.buttons = null;
      d.pressure = null;
      d.zeroButtonMoves = 0;
      d.strokes++;
      d.downs++;
      // pointerId เปลี่ยนระหว่างเส้นไหม — ถ้าเปลี่ยน แปลว่าเบราว์เซอร์มองเป็นการชี้ใหม่
      // ซึ่งทำให้ setPointerCapture ที่ค้างอยู่ไม่ตรงกับ event ที่ตามมา
      if (d.lastId !== null && d.lastId !== e.pointerId) d.idChanges++;
      d.lastId = e.pointerId;
      if (!d.ids.includes(e.pointerId)) d.ids.push(e.pointerId);
      d.pointerType = e.pointerType || "-";
      painterRef.current?.debugReset?.();
    }

    const p = toNorm(e, canvasRef.current.getBoundingClientRect());
    lastPtRef.current = p; // จุดตั้งต้นของเส้นนี้นับเป็นจุดแรกของสาย (กรองจุดซ้ำอิงจากตัวนี้)

    // ถังสีไม่ใช่การลากเส้น จึงจบในคลิกเดียว ไม่ต้องจับ pointer
    if (tool === TOOLS.BUCKET) {
      dispatch(applyFill({ x: p.x, y: p.y, color }));
      return;
    }

    // รูปทรง: จับ pointer แล้วเริ่มเงา (ยังไม่ส่งอะไร จนกว่าจะปล่อยมือ)
    if (isShapeTool(tool)) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* จับไม่ได้ก็ยังลากได้ */
      }
      pointerRef.current = e.pointerId;
      shapeRef.current = { shape: tool, start: p, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      drawPreview();
      return;
    }

    // จับ pointer ไว้ ทำให้ลากออกนอกกระดานแล้วเส้นยังต่อได้ ไม่ขาดกลางคัน
    // ต้องครอบ try ไว้ เพราะเบราว์เซอร์โยน NotFoundError ถ้า pointerId ไม่ได้กดอยู่จริง
    // (เช่น event ที่สร้างขึ้นเอง หรือปากกาที่เบราว์เซอร์ปลดไปแล้ว) — โยนเมื่อไหร่เส้นจะเริ่มไม่ได้เลย
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* จับไม่ได้ก็ยังวาดได้ เพียงแต่ลากออกนอกกระดานแล้วเส้นอาจขาด */
    }
    pointerRef.current = e.pointerId;
    pendingRef.current = [];

    dispatch(
      beginStroke({
        x: p.x,
        y: p.y,
        color,
        size,
        tool: tool === TOOLS.ERASER ? "eraser" : "pen",
      }),
    );
    timerRef.current = setInterval(flush, FLUSH_MS);
  }

  function handleMove(e) {
    if (pointerRef.current !== e.pointerId) return;
    if (shapeRef.current) return moveShape(e);

    const rect = canvasRef.current.getBoundingClientRect();

    // getCoalescedEvents คืนทุกตำแหน่งที่เบราว์เซอร์เก็บไว้ระหว่างเฟรม
    // (วัดจริงได้ 120 จุดจาก pointermove เพียง 52 ครั้ง) จึงได้จุดถี่ขึ้นมากตอนลากเร็ว
    // เบราว์เซอร์ที่ไม่รู้จัก หรือคืนลิสต์ว่าง ก็ถอยไปใช้ตำแหน่งปกติของ event เอง
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const list = coalesced.length > 0 ? coalesced : [e.nativeEvent];
    const raw = list.map((ev) => toNorm(ev, rect));

    // นับของโหมดดีบัก: วัดระยะห่างเป็น CSS pixel จากตำแหน่งจริงบนจอ
    // (ไม่วัดจากพิกัด 0–1 เพราะตัวเลขพิกเซลอ่านออกทันทีว่า "ห่างกันกี่ px")
    if (DEBUG) {
      const d = dbgRef.current;
      d.moves++;
      d.coalesced += list.length;
      d.points += raw.length; // จุดที่ "รับเข้ามา" ก่อนกรอง (ตัวหลังกรองดูที่บรรทัด "กรองทิ้งแล้ว")
      // buttons = 0 ตอนขยับ คือสัญญาณของ "ปากกาลอยอยู่เหนือจอ" (hover)
      // ถ้าปากกาส่ง event แบบนี้แทรกเข้ามาระหว่างลาก จะทำให้จุดกระโดดและเส้นขาดตอน
      d.buttons = e.buttons;
      d.pressure = e.pressure;
      if (e.buttons === 0) d.zeroButtonMoves++;

      for (let i = 0; i < list.length; i++) {
        const x = list[i].clientX - rect.left;
        const y = list[i].clientY - rect.top;
        const nx = raw[i].x;
        const ny = raw[i].y;

        // นับจุดซ้ำจาก "พิกัด 0–1" ไม่ใช่ระยะพิกเซล เพราะค่านั้นคือสิ่งที่ส่งเข้า painter จริง
        // จุดที่ซ้ำจะทำให้ช่วงนั้นยุบเป็นเส้นตรงและไม่ได้ข้อมูลใหม่เลย
        const exact = d.lastNx !== null && nx === d.lastNx && ny === d.lastNy;
        if (exact) {
          d.dupes++;
        } else if (d.lastDx !== null && Math.hypot(x - d.lastDx, y - d.lastDy) < 1) {
          d.nearDupes++;
        } else {
          // จุดที่ไม่ซ้ำ — วัดระยะจาก "จุดที่ไม่ซ้ำตัวก่อนหน้า" เท่านั้น
          // (ค่าเฉลี่ยรวมทุกช่วงจะต่ำกว่าความจริง เพราะช่วงที่เป็นจุดซ้ำมีระยะ 0)
          if (d.lastDx !== null) {
            d.distinctDist += Math.hypot(x - d.lastDx, y - d.lastDy);
            d.distinctGaps++;
          }
          d.lastDx = x;
          d.lastDy = y;
        }

        if (d.lastX !== null) {
          d.dist += Math.hypot(x - d.lastX, y - d.lastY);
          d.gaps++;
        }
        d.lastX = x;
        d.lastY = y;
        d.lastNx = nx;
        d.lastNy = ny;
      }
    }

    // กรองจุดซ้ำก่อนใช้ — ทั้งตอนวาดลงจอและตอนส่ง ต้องใช้ชุดเดียวกันเป๊ะ
    // (ถ้ากรองไม่เหมือนกัน ภาพบนจอกับที่ส่งไปเครื่องอื่นจะไม่ตรงกัน)
    const points = dedupe(raw, rect);
    if (points.length === 0) return; // จุดชุดนี้ขยับไม่ถึง 1px เลย ไม่มีอะไรต้องทำ

    // วาดลงจอเดี๋ยวนี้เลย ไม่รอรอบ flush — เส้นจึงตามมือทันที ไม่กระตุกเป็นก้อนทุก 40ms
    painterRef.current?.apply(extendStroke(points));
    // จุดชุดเดียวกันถูกพักไว้ส่งเป็นชุดถัดไป (ตอน flush จะไม่วาดซ้ำ)
    pendingRef.current.push(...points);
  }

  function handleUp(e) {
    // pointercancel คือสัญญาณว่าเบราว์เซอร์แย่งนิ้วไปทำอย่างอื่น (เช่นเลื่อนจอ หรือปากกาถูกมองว่าลอย)
    // บนไอแพดถ้าเกิดบ่อย แปลว่า touch-action: none ยังไม่ได้ผลจริง — นับไว้ดู
    if (DEBUG) {
      const d = dbgRef.current;
      if (e.type === "pointercancel") {
        d.cancels++;
        d.cancelEvts++;
      } else {
        d.ups++;
      }
    }

    // ไม่มีเส้นค้างอยู่ = ไม่มีอะไรต้องปิด (เช่น pointerup ของนิ้วที่สองที่ handleDown ปฏิเสธไปแล้ว)
    if (pointerRef.current === null) return;
    // event ของ pointer อื่น ไม่ใช่ของเรา — แต่ถ้าเป็นการ "เสียการจับ" ต้องปิดเส้นของเราเอง
    // เพราะเบราว์เซอร์อาจไม่ส่ง pointerup ตามมาเลย ถ้าปล่อยไว้จะค้างวาดเส้นต่อไปไม่ได้
    if (e.pointerId !== pointerRef.current && e.type !== "lostpointercapture") return;

    finishStroke(e.type === "pointercancel");
  }

  // ปิดเส้นที่กำลังวาดอยู่ให้เรียบร้อย — ทางเดียวที่ใช้ปิดเส้น ทุกสาเหตุเรียกฟังก์ชันนี้
  // (pointerup · pointercancel · เสียการจับ pointer)
  //
  // เดิม guard ถูกเขียนไว้ "ก่อน" clearInterval/pointerRef.current = null
  // ถ้า pointerId ไม่ตรง (หรือ pointerup ไม่มาเลย) timer จะค้างและ pointerRef ไม่ถูกปลด
  // ผลคือกดวาดเส้นถัดไปไม่ได้อีกเลยทั้งตา — ย้ายการปลดทรัพยากรให้อยู่รวมที่นี่ที่เดียว
  function finishStroke(cancelled = false) {
    if (shapeRef.current) return finishShape(!cancelled);
    const id = pointerRef.current;
    clearInterval(timerRef.current);
    timerRef.current = null;
    pointerRef.current = null;
    if (id !== null) {
      // คืนการจับ pointer ตามมารยาท ถ้าไม่ได้จับอยู่เบราว์เซอร์จะโยน error แล้วเราไม่สน
      try {
        canvasRef.current?.releasePointerCapture(id);
      } catch {
        /* ไม่ได้จับอยู่ ก็ไม่เป็นไร */
      }
    }
    flush(); // เก็บจุดสุดท้ายที่ค้างอยู่ก่อนปิดเส้น ไม่งั้นปลายเส้นหายไปนิดหนึ่ง
    dispatch(endStroke());
  }

  // ปากกา/นิ้วออกนอกกระดาน — ปกติเกิดตอนยกออก ซึ่ง pointerup มาก่อนแล้ว
  // แต่ถ้ามันมาก่อน pointerup แปลว่าปากกาถูกมองว่าออกจากพื้นที่ทั้งที่ยังกดอยู่ นับไว้ดู
  function handleLeave() {
    if (DEBUG) dbgRef.current.leaves++;
  }

  // เสียการจับ pointer กลางคัน (เบราว์เซอร์แย่งไปทำอย่างอื่น) — ปิดเส้นทิ้งอย่างเรียบร้อย
  // ภาพที่วาดไปแล้วยังอยู่ครบ ไม่หาย แต่ปล่อยให้วาดเส้นใหม่ได้ ไม่ค้าง
  function handleLostCapture() {
    // ตอนปิดเส้นปกติ เราปล่อยการจับเอง เบราว์เซอร์ก็ส่ง event นี้มาด้วย — ไม่ใช่ "การถูกแย่ง"
    // นับเฉพาะตอนที่ยังมีเส้นค้างอยู่จริง ซึ่งแปลว่าเบราว์เซอร์ปลดให้เองโดยเราไม่ได้สั่ง
    if (pointerRef.current === null) return;
    if (DEBUG) dbgRef.current.lostCaptures++;
    finishStroke(true);
  }

  // ข้อความในกล่องดีบัก (โหมดดีบักชั่วคราว) — ลบได้ทั้งก้อน
  let dbgText = null;
  if (DEBUG && dbgView) {
    const straight = dbgView.straight + dbgView.tail;
    // ตัดสินว่า "เส้นล่าสุดใช้เส้นโค้งหรือเส้นตรง" — คำถามข้อ 5 ของโจทย์
    // จุดยิ่งน้อยยิ่งมีโอกาสที่ทุกช่วงจะเป็นเส้นตรง เพราะช่วงแรกของทุกเส้นเป็นเส้นตรงเสมอ
    const verdict =
      dbgView.points < 3
        ? `จุดน้อยเกินไป (${dbgView.points} จุด) ลากยาวอีกหน่อย`
        : dbgView.curves === 0
          ? "เส้นตรงล้วน ⚠️ ไม่ได้ใช้เส้นโค้งเลย"
          : `ใช้เส้นโค้ง ${dbgView.curves} ช่วง`;
    dbgText = [
      "?debug=1 · โหมดดีบักชั่วคราว",
      `getCoalescedEvents : ${HAS_COALESCED ? "มี" : "ไม่มี ✗"}`,
      `ชนิด pointer       : ${dbgView.pointerType}`,
      `pointermove        : ${dbgView.moves} ครั้ง · ได้ ${dbgView.points} จุด`,
      `จุดห่างกันเฉลี่ย    : ${dbgView.spacing.toFixed(1)} px  (เฉลี่ยรวมจุดซ้ำ ซึ่งระยะเป็น 0)`,
      `จุดซ้ำตำแหน่งเดิม   : ${dbgView.dupes} จุด · ห่างไม่ถึง 1px อีก ${dbgView.nearDupes} จุด`,
      // ★ ค่านี้คือตัวชี้ขาด: จุดซ้ำมีระยะ 0 จึงฉุดค่าเฉลี่ยข้างบนให้ต่ำกว่าความจริง
      //   ระยะระหว่างจุดที่ไม่ซ้ำต่างหากที่บอกว่าที่จริงแล้วจุดห่างกันแค่ไหน
      `จุดที่ไม่ซ้ำ        : ${dbgView.distinct} จุด ★`,
      `   ห่างกันเฉลี่ย    : ${dbgView.distinctSpacing.toFixed(1)} px  (เกิน ~25px = เริ่มเห็นมุม)`,
      `กรองทิ้งแล้ว       : ${dbgView.dropped} จุด  (ขยับไม่ถึง 1px · ตัวแก้ข้อ 2)`,
      `เส้นล่าสุด         : ${verdict}`,
      `   โค้ง ${dbgView.curves} · ตรง ${straight} (ปิดปลาย ${dbgView.tail}) · จุดกลม ${dbgView.dots}`,
      `ทั้งตา            : ${dbgView.strokes} เส้น · ถูกแย่งนิ้ว ${dbgView.cancels} ครั้ง`,
      `เหตุการณ์         : down ${dbgView.downs} · up ${dbgView.ups} · cancel ${dbgView.cancelEvts} · leave ${dbgView.leaves} · เสียการจับ ${dbgView.lostCaptures}`,
      `pointerId         : ${dbgView.idCount} แบบ · เปลี่ยนกลางทาง ${dbgView.idChanges} ครั้ง`,
      `ปากกา            : buttons ${dbgView.buttons ?? "-"} · pressure ${dbgView.pressure ?? "-"} · ขยับตอน buttons=0 ${dbgView.zeroButtonMoves} ครั้ง`,
      `กระดาน            : ${dbgView.boardCss} css · บัฟเฟอร์ ${dbgView.buffer} · dpr ${dbgView.dpr}`,
    ].join("\n");
  }

  return (
    // วาดได้ = เคอร์เซอร์ของเราเอง (วงกลมตามขนาดแปรง/ถังสี/กากบาท) ขอบดำ+ขาว เห็นชัดทุกพื้น ต่อท้าย crosshair เป็นสำรอง (ดู canvas/cursor.js)
    // วาดไม่ได้ (ไม่ใช่ตาเรา · ยกปากกาแล้ว · ช่วงป้ายใหญ่) = ไม่ตั้ง ใช้เคอร์เซอร์ปกติของระบบ
    <div
      className={`board${canDraw ? " board--draw" : ""}`}
      ref={wrapRef}
      style={canDraw ? { cursor: boardCursor(tool, size, color) } : undefined}
    >
      <canvas
        ref={canvasRef}
        className="board__canvas"
        aria-label={canDraw ? "กระดานวาดของคุณ" : "กระดานวาด"}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onPointerLeave={handleLeave}
        onLostPointerCapture={handleLostCapture}
      />
      <canvas ref={previewRef} className="board__preview" aria-hidden="true" />
      {(mascotOn || fading) && (
        <div className={`board__empty${mascotOn ? "" : " board__empty--out"}`}>{empty || lastEmptyRef.current}</div>
      )}
      {overlay}
      {notice && (
        <div className="board__notice" role="status">
          {notice}
        </div>
      )}
      {dbgText && <pre className="board__debug">{dbgText}</pre>}
    </div>
  );
});

export default Canvas;

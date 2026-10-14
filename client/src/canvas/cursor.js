// เคอร์เซอร์ของเราเองบนกระดานวาด
//
// ทำไมไม่ใช้ crosshair ของระบบ: บน Windows crosshair เป็นเส้นบาง 1px สีอ่อน มองแทบไม่เห็นบนกระดานสีขาว (บน Mac เป็นกากบาทสีดำจึงเห็นชัด)
// (ย้ายมาจาก justdrawit — เคยแก้ที่นั่นแล้วแต่ไม่เคยเข้ามาใน DRAW.CY กระดานที่นี่จึงยังใช้ crosshair ของระบบ = อาการกลับมา)
// ⚠️ ห้ามใช้ cursor: none แล้ววาดเคอร์เซอร์ด้วย JS แทน — event หลุดเมื่อไรเคอร์เซอร์หายทั้งจอ (มีเทสใน smoke.js ข้อ 47 กันไว้)
// เราจึงวาดเคอร์เซอร์เป็นรูป PNG เอง ขอบสองชั้น (ดำบาง + ขาวบาง) เห็นชัดทั้งบนพื้นขาวและพื้นสีเข้ม
//   ปากกา/ยางลบ = วงกลมขนาดตามแปรง (เส้นผ่านศูนย์กลาง = ขนาดแปรงเป็น CSS px เท่ากับเส้นที่จะวาดจริง) จุดปลายอยู่กลางวง
//   ถังสี = รูปถังสีที่ใช้สีที่เลือกอยู่ จุดปลายอยู่ที่หยดสีมุมล่างซ้าย (จุดที่จะเทสี)
//   รูปทรง = กากบาทสองชั้นของเราเอง (ดำ+ขาว) จุดปลายอยู่กลางกากบาท
// ภาพทุกใบ ≤ 32×32 (เพดานเคอร์เซอร์ของ Windows) สร้างครั้งเดียวต่อคีย์แล้วเก็บแคช · ต่อท้ายด้วย crosshair เป็นตัวสำรองเสมอ
// (รูปสร้างไม่ได้/เบราว์เซอร์ไม่รับรูป = ใช้ crosshair ปกติ ยังเห็นเคอร์เซอร์เสมอ)
import { TOOLS, isShapeTool } from "./palette";

export const CURSOR_MAX = 32; // เพดานขนาดรูปเคอร์เซอร์ (พิกเซล) — Windows รองรับสูงสุดราว 32×32
const MIN_DIAMETER = 8; // แปรงเล็กมาก (2px) ยังต้องเห็นวงกลม
const FALLBACK = "crosshair";

const cache = new Map();

function makeCanvas(n) {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  return [c, c.getContext("2d")];
}

// เส้นสองชั้น: ขาวหนากว่าอยู่ล่าง ดำบางอยู่บน = ขอบขาวล้อมเส้นดำ
function ring2(ctx, draw) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3.5;
  draw();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5; // 1.5px ให้เส้นวงกลมที่คร่อมพิกเซลยังดำพอ (1px เต็มๆ จะกลายเป็นสีเทาจางบนพื้นขาว)
  draw();
}

// วงกลมแปรง: ดำบาง 1px ที่ขอบวง แล้วขาว 1px ล้อมนอกวงดำ (เห็นชัดทั้งบนพื้นขาวและพื้นเข้ม)
function brushImage(size) {
  const d = Math.max(MIN_DIAMETER, Math.min(size, CURSOR_MAX - 4)); // เผื่อขอบ 2px ต่อข้าง ให้รูปไม่เกิน 32
  const n = Math.min(CURSOR_MAX, 2 * Math.ceil((d + 4) / 2)); // เลขคู่ จุดกลางวงจึงเป็นจำนวนเต็มพอดี (hotspot ต้องตรงกลาง)
  const [c, ctx] = makeCanvas(n);
  const r = d / 2;
  ring2(ctx, () => {
    ctx.beginPath();
    ctx.arc(n / 2, n / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  });
  return { url: c.toDataURL("image/png"), hx: n / 2, hy: n / 2 };
}

function crossImage() {
  // ขนาดคี่ + วางเส้นกลางพิกเซล (x.5) ให้เส้นดำ 1px คมเต็มพิกเซล (ถ้าคร่อมสองพิกเซลจะเป็นสีเทาจาง) · จุดปลายคือพิกเซลกลาง
  const n = 25;
  const [c, ctx] = makeCanvas(n);
  const m = 12.5;
  ring2(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(m, 2.5);
    ctx.lineTo(m, m - 3);
    ctx.moveTo(m, m + 3);
    ctx.lineTo(m, n - 2.5);
    ctx.moveTo(2.5, m);
    ctx.lineTo(m - 3, m);
    ctx.moveTo(m + 3, m);
    ctx.lineTo(n - 2.5, m);
    ctx.stroke();
  });
  return { url: c.toDataURL("image/png"), hx: 12, hy: 12 };
}

// ถังสีเอียง เทสีลงหยดที่มุมล่างซ้าย · ตัวถังใช้สีที่เลือกอยู่ (ผู้เล่นเห็นว่าจะเทสีอะไร)
function bucketImage(color) {
  const n = CURSOR_MAX;
  const [c, ctx] = makeCanvas(n);
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(12, 6); // ปากถัง
    ctx.lineTo(27, 14);
    ctx.lineTo(22, 24); // ก้นถัง
    ctx.lineTo(8, 16);
    ctx.closePath();
  };
  // ขอบขาวหนา → ตัวถังสีที่เลือก → ขอบดำบาง
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  body();
  ctx.stroke();
  ctx.fillStyle = color || "#ffffff";
  body();
  ctx.fill();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  body();
  ctx.stroke();
  // หูหิ้ว
  ring2(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(12, 6);
    ctx.quadraticCurveTo(14, 0.5, 21, 3.5);
    ctx.stroke();
  });
  // หยดสีที่ปลายซ้ายล่าง = จุดที่เท (hotspot)
  ctx.fillStyle = color || "#000000";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  const drop = () => {
    ctx.beginPath();
    ctx.moveTo(4, 29);
    ctx.quadraticCurveTo(1.5, 25, 5, 21.5);
    ctx.quadraticCurveTo(8.5, 25, 4, 29);
    ctx.closePath();
  };
  drop();
  ctx.stroke();
  ctx.fill();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1;
  drop();
  ctx.stroke();
  return { url: c.toDataURL("image/png"), hx: 4, hy: 29 };
}

/**
 * ค่า CSS `cursor` สำหรับกระดานตอน "วาดได้" (ตอนวาดไม่ได้ ไม่ต้องเรียกฟังก์ชันนี้ — ใช้เคอร์เซอร์ปกติของระบบ)
 * คืนค่าเป็นสตริงเสมอ ลงท้าย `, crosshair`
 */
export function boardCursor(tool, size, color) {
  try {
    let key;
    let make;
    if (tool === TOOLS.BUCKET) {
      key = `bucket:${color}`;
      make = () => bucketImage(color);
    } else if (isShapeTool(tool)) {
      key = "cross";
      make = crossImage;
    } else {
      // ปากกา และยางลบ = วงกลมแบบเดียวกัน (ปัดขนาดเป็นจำนวนเต็มก่อน จำนวนรูปในแคชจะได้ไม่บาน)
      const d = Math.round(Number(size) || MIN_DIAMETER);
      key = `brush:${d}`;
      make = () => brushImage(d);
    }
    let img = cache.get(key);
    if (!img) {
      img = make();
      cache.set(key, img);
    }
    return `url("${img.url}") ${img.hx} ${img.hy}, ${FALLBACK}`;
  } catch {
    return FALLBACK; // canvas ใช้ไม่ได้ (เช่นไม่มี DOM) ยังได้ crosshair
  }
}

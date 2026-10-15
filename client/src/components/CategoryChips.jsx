import { categoryPool, categoriesLabel, countsKnown, difficultyLabel } from "../roomOptions";

// ชิปเลือก "หมวดหมู่คำ" — เลือกได้หลายหมวด (กดซ้ำ = เอาออก)
// ใช้ทั้งในห้องรอ (หัวห้องเท่านั้นที่กดได้ คนอื่นเห็นค่าที่ตั้งไว้) และหน้า SET UP ของ Solo
//
// ค่าที่เก็บจริงคือ "อาร์เรย์ชื่อหมวด" ใน settings.categories · **อาร์เรย์ว่าง = ทุกหมวด** (ค่าเริ่มต้น)
// กติกา: ต้องเหลืออย่างน้อย 1 หมวด → กดหมวดสุดท้ายออกไม่ได้ ต้องกด "ทุกหมวด" ถ้าอยากกลับไปทุกหมวด
// (เหมือนการ์ด Mini Challenge ที่ปิดใบสุดท้ายไม่ได้) · server กรองชื่อที่ไม่รู้จักทิ้งอยู่แล้ว
//
// list = [{name, counts:{easy,medium,hard}, total}] จาก useWordCategories
// value = ชื่อหมวดที่เลือก · difficulty = ความยากที่ตั้งไว้ (ใช้บอกว่ามีคำกี่คำ) · turns = เกมนี้มีกี่ตา (ใช้เตือนคำซ้ำ)
// variant = "wrap" (ห้องรอ: ห่อบรรทัดในกรอบ) | "row" (SET UP Solo: แถวเดียว เลื่อนแนวนอน)
export default function CategoryChips({
  list,
  value = [],
  onChange,
  difficulty = "easy",
  mode = "room",
  perTurn = 3,
  turns = 0,
  disabled = false,
  variant = "wrap",
}) {
  const selected = Array.isArray(value) ? value : [];
  const known = countsKnown(list);
  const pool = categoryPool(list, selected, difficulty, mode);

  // ป้ายบอกผลข้างล่างชิป: ทุกคนในห้องเห็นเหมือนกัน (ผู้เล่นทั่วไปรู้ว่ากำลังเล่นหมวดอะไร)
  let note = `ใช้คำจาก ${categoriesLabel(selected)}`;
  let tone = "ok";
  if (known) {
    if (mode === "solo") {
      if (pool === 0) {
        note = `หมวดที่เลือกยังไม่มีคำเลย — เลือกหมวดอื่น`;
        tone = "bad";
      } else {
        note = `ใช้คำจาก ${categoriesLabel(selected)} · ${pool} คำ (ทุกระดับ)`;
      }
    } else if (pool < perTurn) {
      note = `หมวดที่เลือกมีคำไม่พอ (${pool} คำ ในระดับ${difficultyLabel(difficulty)}) — ต้องมีอย่างน้อย ${perTurn} คำ เลือกหมวดเพิ่มหรือเปลี่ยนความยาก`;
      tone = "bad";
    } else {
      note = `ใช้คำจาก ${categoriesLabel(selected)} · ระดับ${difficultyLabel(difficulty)} มี ${pool} คำ`;
      if (turns > 0 && pool < turns) {
        note += ` · เกมนี้มีประมาณ ${turns} ตา คำจะซ้ำกันบ้าง`;
        tone = "warn";
      }
    }
  } else if (selected.length > 0) {
    note = `ใช้คำจาก ${categoriesLabel(selected)}`;
  }

  // กดได้เฉพาะหัวห้อง (หรือผู้เล่น Solo ที่ตั้งเกมของตัวเอง) — server ตรวจซ้ำเสมอ
  function toggle(name) {
    if (disabled) return;
    const has = selected.includes(name);
    if (has && selected.length <= 1) return; // เหลือหมวดสุดท้าย = กดออกไม่ได้ (ไปกด "ทุกหมวด" แทน)
    onChange(has ? selected.filter((c) => c !== name) : [...selected, name]);
  }

  const chip = (name, on, title) => (
    <button
      key={name}
      type="button"
      className={on ? "cat-chip cat-chip--on" : "cat-chip"}
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={() => (name === null ? onChange([]) : toggle(name))}
    >
      {name ?? "ทุกหมวด"}
    </button>
  );

  return (
    <div className="cat-pick">
      <div className={variant === "row" ? "cat-chips cat-chips--row" : "cat-chips"} role="group" aria-label="หมวดหมู่คำ">
        {chip(null, selected.length === 0, "ใช้คำจากทุกหมวด (เหมือนเดิม)")}
        {list.map((c) => chip(c.name, selected.includes(c.name), c.counts ? `${c.name} · ${c.total} คำ` : c.name))}
      </div>
      <p className={`cat-note cat-note--${tone}`} role="status">
        {note}
      </p>
    </div>
  );
}

import { socket } from "../socket";
import { CHALLENGE_CARDS, DEFAULT_CHALLENGES } from "../roomOptions";

// การ์ดเปิด/ปิด Mini Challenge ทีละใบ (ในห้องรอ)
// หัวห้องกดสลับได้ · คนอื่นเห็นสถานะ realtime แต่กดไม่ได้ (การ์ดเป็น div ไม่ใช่ปุ่ม)
// ต้องเปิดอย่างน้อย 1 ใบเสมอ — ถ้าเหลือใบเดียวจะปิดใบนั้นไม่ได้
// server ตรวจซ้ำทุกครั้ง (set_challenges รับเฉพาะหัวห้อง และ sanitize ให้เหลือ ≥1)
export default function ChallengeCards({ enabled = DEFAULT_CHALLENGES, isHost }) {
  const active = CHALLENGE_CARDS.filter((c) => enabled.includes(c.id)).length;

  function toggle(id) {
    if (!isHost) return;
    const has = enabled.includes(id);
    if (has && enabled.length <= 1) return; // ต้องเหลืออย่างน้อย 1 ใบ
    const next = has ? enabled.filter((x) => x !== id) : [...enabled, id];
    socket.emit("set_challenges", { challenges: next });
  }

  return (
    <div className="challenge-cards-wrap">
      <div className="challenge-cards-head">
        <span className="field__label">Mini Challenge</span>
        <span className="wr-challenge-hint">สุ่มใช้ระหว่างวาด</span>
        <span className="challenge-count">เปิด {active}/{CHALLENGE_CARDS.length}</span>
      </div>
      <div className="challenge-cards" role={isHost ? "group" : undefined} aria-label="เปิด/ปิด Mini Challenge">
        {CHALLENGE_CARDS.map((c) => {
          const on = enabled.includes(c.id);
          const lastOne = on && enabled.length <= 1; // ปิดไม่ได้เพราะเหลือใบเดียว
          const cls = `chal-card wr-chal-card--${c.id}${on ? " chal-card--on" : ""}${isHost ? " chal-card--host" : ""}`;
          const icon = c.id === "colour_fix" ? "◉" : c.id === "shapes_only" ? "◈" : "✎";
          const content = (
            <>
              <span className="wr-chal-card__icon" aria-hidden="true">{icon}</span>
              <span className="chal-card__title">{c.title}</span>
              <span className="chal-card__desc">{c.desc}</span>
              <span className={`chal-card__badge chal-card__badge--${on ? "on" : "off"}`}>
                {on ? "เปิดอยู่ ✓" : "ปิดอยู่"}
              </span>
            </>
          );
          // หัวห้อง = ปุ่มกดสลับได้ · คนอื่น = div อ่านอย่างเดียว
          return isHost ? (
            <button
              key={c.id}
              type="button"
              className={cls}
              aria-pressed={on}
              disabled={lastOne}
              title={lastOne ? "ต้องเปิดอย่างน้อย 1 ใบ" : on ? "กดเพื่อปิด" : "กดเพื่อเปิด"}
              onClick={() => toggle(c.id)}
            >
              {content}
            </button>
          ) : (
            <div key={c.id} className={cls}>
              {content}
            </div>
          );
        })}
      </div>
      {!isHost && <p className="hint-text">หัวห้องเป็นคนเปิด/ปิดกติกา</p>}
    </div>
  );
}

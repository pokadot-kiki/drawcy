import { useEffect, useRef, useState } from "react";

/**
 * กล่อง "คำตอบ" — ใต้กระดาน ฝั่งซ้าย (DESIGN.md หัวข้อหน้าเกม)
 *
 * เก็บเฉพาะ "คำที่ผู้เล่นพิมพ์ทาย" ส่วนเรื่องในห้อง (ใครเข้าออก ใครทายถูก) อยู่กล่องขวา (RoomLog)
 * แยกกันเพราะคนละประโยชน์: กล่องนี้คือที่ที่เราต้องจ้องเพื่อทาย ส่วนกล่องขวาไว้อ่านบรรยากาศห้อง
 *
 * ข้อความ 3 แบบ
 *   ทายผิด  ดำปกติ
 *   ทายถูก  พื้นเขียวอ่อนตัวเขียว (คำของตัวเองเห็นคำจริง คนอื่นเห็น ****** — server ตัดสิน)
 *   ของตัวเอง ขอบซ้ายสีฟ้า
 *
 * คนวาดพิมพ์ไม่ได้ระหว่างวาด server ตัดทิ้งอยู่แล้ว แต่ฝั่งเราปิดช่องไปเลยจะได้เข้าใจง่าย
 */
export default function Chat({
  messages = [],
  meId,
  disabled = false,
  onSend,
  focusKey = 0,
  autoFocus = true,
  title = "คำตอบ",
  emptyText = "พิมพ์ทายคำที่นี่",
  placeholder = "ทายคำ...",
  disabledPlaceholder = "คุณกำลังวาดอยู่", // ข้อความในช่องตอนพิมพ์ไม่ได้ (Solo ใช้ข้อความอื่น)
  maxLength = 100, // Solo ช่วง 2 ใช้ 40 ตามเพดานที่ server รับ
  className = "panel panel--answers",
}) {
  const [text, setText] = useState("");
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // ข้อความใหม่มา ให้เลื่อนลงล่างสุดเสมอ
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  // ขึ้นตาใหม่ = เริ่มทายใหม่ ให้เคอร์เซอร์อยู่ที่ช่องพิมพ์เลย จะได้พิมพ์ได้ทันทีไม่ต้องกดก่อน
  // ข้ามตอนที่พิมพ์ไม่ได้ (เราเป็นคนวาด) ไม่งั้นจะไปแย่งโฟกัสทั้งที่พิมพ์ไม่ได้
  useEffect(() => {
    if (!disabled && autoFocus) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, autoFocus, disabled]);

  function handleSubmit(e) {
    e.preventDefault(); // กด Enter ในช่องนี้ = ส่ง (ฟอร์มจัดการให้เอง ไม่ต้องดักคีย์เอง)
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText("");
  }

  const guesses = messages.filter((m) => !m.system);

  return (
    <section className={className} aria-label={title}>
      <h2 className="panel__title">{title}</h2>

      <div className="chat__list" ref={listRef}>
        {guesses.length === 0 && <p className="chat__empty">{emptyText}</p>}
        {guesses.map((m, i) => {
          const classes = ["chat__row"];
          if (m.correct) classes.push("chat__row--correct");
          if (m.playerId === meId) classes.push("chat__row--mine");
          return (
            <p className={classes.join(" ")} key={i}>
              <span className="chat__name">{m.name}:</span> {m.text}
            </p>
          );
        })}
      </div>

      <form className="chat__form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="input chat__input"
          type="text"
          value={text}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={disabled ? disabledPlaceholder : placeholder}
          aria-label={title === "คำตอบ" ? "ช่องทายคำ" : "ช่องแชทรอห้อง"}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn--primary" type="submit" disabled={disabled || !text.trim()}>
          ส่ง
        </button>
      </form>
    </section>
  );
}

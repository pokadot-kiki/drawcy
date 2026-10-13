import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import AvatarPicker from "./AvatarPicker";

// กล่องใส่รหัสห้อง 5 หลัก · เปิดจากลิงก์เชิญจะเติมรหัสให้เลย (initialCode)
export default function JoinModal({ initialCode = "", busy, onSubmit, onClose, avatar, onAvatarChange }) {
  const [code, setCode] = useState(initialCode);
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);

  function submit(e) {
    e.preventDefault();
    if (code.length === 5) onSubmit(code);
  }

  return (
    <Modal labelledBy="join-title" onClose={onClose}>
      <form onSubmit={submit}>
        <h2 className="modal__title" id="join-title">
          เข้าห้อง
        </h2>
        <label className="field__label" htmlFor="room-code">
          ROOM CODE · รหัสห้อง 5 หลัก
        </label>
        <input
          id="room-code"
          ref={inputRef}
          className="input input--code"
          value={code}
          // รับเฉพาะตัวเลข 5 หลัก (server ยังตรวจซ้ำอีกชั้น)
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
          inputMode="numeric"
          placeholder="12345"
          autoComplete="off"
        />
        <p className="join-avatar__label">เลือกอวตาร</p>
        <AvatarPicker compact value={avatar} onChange={onAvatarChange} />
        <div className="modal__actions modal__actions--row">
          <button type="submit" className="btn btn--primary" disabled={code.length !== 5 || busy}>
            {busy ? "กำลังเข้า..." : "เข้าห้อง"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            ยกเลิก
          </button>
        </div>
      </form>
    </Modal>
  );
}

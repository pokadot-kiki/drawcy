import { AVATARS } from "../avatars";
import { AvatarArt, Icon } from "./Icons";

// เลือกอวตาร: โชว์ตัวที่เลือกอยู่ตัวเดียว มีลูกศรซ้าย/ขวากดเลื่อน (วนรอบ 12 แบบ ตรงกับ avatar ใน events.md)
// compact = ใช้ในกล่องแคบ (SET UP / กล่องเข้าห้อง) ภาพเล็กลง แต่โครงเหมือนกัน
export default function AvatarPicker({ value = 0, onChange, compact = false }) {
  const n = AVATARS.length;
  // วนรอบ: ตัวสุดท้ายกดขวาแล้วกลับตัวแรก (+n กันค่าติดลบ)
  const step = (d) => onChange((value + d + n) % n);
  return (
    <div className={`avatar-picker${compact ? " avatar-picker--compact" : ""}`} role="group" aria-label="เลือกอวตาร">
      <button type="button" className="avatar-picker__arrow" onClick={() => step(-1)} aria-label="อวตารก่อนหน้า">
        <Icon name="arrowL" size={18} />
      </button>
      <div className="avatar-picker__stage" aria-live="polite">
        <AvatarArt index={value} size={compact ? 72 : 112} label={`อวตาร ${AVATARS[value]}`} />
      </div>
      <button type="button" className="avatar-picker__arrow" onClick={() => step(1)} aria-label="อวตารถัดไป">
        <Icon name="arrowR" size={18} />
      </button>
    </div>
  );
}

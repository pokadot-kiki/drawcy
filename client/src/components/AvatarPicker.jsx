import { AVATARS } from "../avatars";
import { AvatarArt } from "./Icons";

// เลือกจากภาพทั้ง 12 แบบได้ทันที เพื่อไม่ต้องกดวนทีละตัว
export default function AvatarPicker({ value = 0, onChange, compact = false }) {
  return (
    <div className={`avatar-picker${compact ? " avatar-picker--compact" : ""}`} role="group" aria-label="เลือกอวตาร">
      {!compact && <div className="avatar-picker__stage"><AvatarArt index={value} size={76} label={`อวตาร ${AVATARS[value]}`} /></div>}
      <div className="avatar-picker__grid">
        {AVATARS.map((name, index) => (
          <button
            key={name}
            type="button"
            className={`avatar-picker__choice${value === index ? " avatar-picker__choice--selected" : ""}`}
            onClick={() => onChange(index)}
            aria-label={`เลือกอวตาร ${name}`}
            aria-pressed={value === index}
            title={name}
          >
            <AvatarArt index={index} size={30} />
          </button>
        ))}
      </div>
    </div>
  );
}

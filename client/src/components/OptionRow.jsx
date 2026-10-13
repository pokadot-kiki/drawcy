// แถวปุ่มเลือกหนึ่งค่า (ปุ่มเรียงติดกัน ตัวที่เลือกอยู่กดยุบ) — ใช้คลาส .segmented/.seg เดิมของแอป
// choices = [[ค่า, ป้าย], ...] · value = ค่าที่เลือกอยู่ · onChange(ค่าใหม่)
// disabled = แสดงค่าที่เลือกอยู่ได้ แต่กดเปลี่ยนไม่ได้ (ผู้เล่นทั่วไปในห้องรอ ดูค่าที่หัวห้องตั้งไว้)
export default function OptionRow({ label, choices, value, onChange, disabled = false }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {choices.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          className={value === v ? "seg seg--active" : "seg"}
          aria-pressed={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

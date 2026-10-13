// โลโก้สองบรรทัด DRAW สีฟ้า / .CY สีเหลือง (ชื่อเกม DRAW.CY) ขอบตัวอักษรดำ (ตาม DESIGN.md)
export default function Logo() {
  return (
    <h1 className="logo" aria-label="DRAW.CY">
      <span className="logo__just">DRAW</span>
      <span className="logo__drawit">.CY</span>
    </h1>
  );
}

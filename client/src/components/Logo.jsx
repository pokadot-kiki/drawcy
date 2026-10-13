// โลโก้บรรทัดเดียว DRAW.CY — DRAW สีฟ้า / .CY สีเหลือง ขอบตัวอักษรดำ (ตาม DESIGN.md)
// เดิมแยกเป็นสองบรรทัด (DRAW บน .CY ล่าง) ผู้ใช้ขอให้รวมเป็นบรรทัดเดียว สีและขอบคงเดิม
export default function Logo() {
  return (
    <h1 className="logo" aria-label="DRAW.CY">
      <span className="logo__just">DRAW</span>
      <span className="logo__drawit">.CY</span>
    </h1>
  );
}

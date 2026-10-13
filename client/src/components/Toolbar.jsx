import { useState } from "react";
import { Icon } from "./Icons";
import { PAINT_COLORS, SIZE_MIN, SIZE_MAX, TOOLS, PICK_DEFAULT, colorLabel, hslToHex } from "../canvas/palette";
import ColorPicker from "./ColorPicker";

/**
 * แถบเครื่องมือวาด — อยู่คอลัมน์ขวาของหน้าเกม (DESIGN.md)
 *
 * ตัวนี้ไม่รู้จัก canvas เลย มันแค่บอกพ่อแม่ (Game) ว่า "ผู้ใช้เลือกอะไร"
 * แล้วพ่อแม่ส่งค่าลงไปให้ Canvas อีกที — แยกหน้าที่กันชัด จะได้หาที่ผิดง่าย
 *
 * สองโหมด
 *   ปกติ (จอใหญ่)  แนวตั้ง อยู่ในคอลัมน์ขวา มือขวาเอื้อมถึงง่าย
 *   มือถือ          แนวนอน เป็นแถบใต้กระดาน (Game เป็นคนสลับด้วย CSS)
 *
 * คนที่ไม่ใช่คนวาดยังเห็นแถบนี้ แต่จางและกดไม่ได้ (locked)
 * เหตุผล: ถ้าซ่อนไปเลย กระดานจะเปลี่ยนความกว้างทุกครั้งที่สลับคนวาด ภาพที่วาดไว้จะกระโดด
 */
export default function Toolbar({
  tool,
  color,
  size,
  onTool,
  onColor,
  onSize,
  onClear,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  locked = false,
  // ── Mini Challenge (ข้อ 5) — ค่าที่มีผลจริงถูกคิดมาแล้วจาก Game ──
  // lockedColor: สีเดียวที่ใช้ได้ในตานี้ (colour_fix) ไม่มีก็เป็น null
  // hideBucket : dont_lift_pen ซ่อนปุ่มถังสี ไม่ใช่แค่ปิด (กติกาคือ "ห้ามยกปากกา" การเทสีคือการวาด)
  // historyLocked: dont_lift_pen ห้ามย้อน/ทำซ้ำ — ใช้แค่เปลี่ยนข้อความ tooltip ให้อธิบายได้
  lockedColor = null,
  // maxSize: เพดานขนาดแปรงของหน้านี้ (Solo ตั้ง 12 เพราะแปรงหนาทำให้ AI ทายแม่นลดลงครึ่งหนึ่ง) · ไม่ใส่ = SIZE_MAX
  maxSize = SIZE_MAX,
  hideBucket = false,
  // hideShapes: dont_lift_pen ซ่อนเครื่องมือรูปทรงด้วย (ลากแล้วปล่อยครั้งเดียว = ยกปากกา server ทิ้งทุกครั้ง)
  hideShapes = false,
  // hidePen: shapes_only ซ่อนปากกา+ยางลบ เหลือแต่เครื่องมือรูปทรง (server ทิ้งเส้นมือเปล่าทุกครั้ง)
  hidePen = false,
  historyLocked = false,
}) {
  // สีที่เลือกเอง: เก็บเป็น "องศาสี + ความสว่าง" (ไม่ใช่ hex) เพราะช่องเลือกสีต้องรู้ว่าจะวางจุดจับไว้ตรงไหน
  const [pick, setPick] = useState(PICK_DEFAULT);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hasPicked, setHasPicked] = useState(false); // เคยเลือกสีเองแล้วหรือยัง → ขึ้นจุดสีที่มุมช่อง และกดช่องแล้วใช้สีนั้นได้เลย
  const custom = hslToHex(pick.hue, 1, pick.light);
  const customPicked = color.toLowerCase() === custom.toLowerCase() && !PAINT_COLORS.some((c) => c.hex === color.toLowerCase());
  // colour_fix: กลุ่มเลือกสีใช้ไม่ได้ทั้งกลุ่ม (สีล็อกจาก server แล้ว ไม่ใช่สีที่ผู้ใช้เลือก)
  const colourLocked = Boolean(lockedColor);
  const closePicker = () => setPickerOpen(false);

  // ลาก/แตะในช่องเลือกสี → ได้สีนั้นทันที ไม่ต้องกดยืนยัน
  function handlePick(hue, light) {
    setPick({ hue, light });
    setHasPicked(true);
    onColor(hslToHex(hue, 1, light));
  }

  return (
    <div
      className={`toolbar${locked ? " toolbar--locked" : ""}`} data-picker={pickerOpen && !colourLocked ? "open" : undefined}
      // aria-disabled บอกโปรแกรมอ่านหน้าจอว่าตอนนี้ใช้ไม่ได้ (ตัวกันการกดจริงคือ CSS pointer-events)
      aria-disabled={locked || undefined}
    >
      {/* ── ปุ่มย้อนกลับ / ทำซ้ำ (ข้อ 4) — อยู่บนสุดของคอลัมน์ เหมือนแถบริบบอนของ Word ──
          ทั้งคู่เป็นปุ่ม "สั่ง" ไม่ใช่โหมด จึงใช้ tool--action (ทึบเต็มเวลากดได้)
          ไม่ค้างสถานะกดไว้แบบปุ่มเครื่องมือ · กดไม่ได้เมื่อไม่มีอะไรให้ย้อน/ทำซ้ำ (server เป็นคนบอก)
          ดูคีย์ลัด ⌘Z / ⌘⇧Z ได้ที่ screens/Game.jsx */}
      <div className="toolbar__group toolbar__group--history" role="group" aria-label="ย้อนกลับและทำซ้ำ">
        <button
          type="button"
          className="tool tool--action"
          aria-label="ย้อนกลับ"
          title={historyLocked ? "กติกา ห้ามยกปากกา: ย้อนกลับไม่ได้" : "ย้อนกลับ (⌘Z)"}
          disabled={locked || !canUndo}
          onClick={onUndo}
        >
          <Icon name="undo" size={38} />
        </button>
        <button
          type="button"
          className="tool tool--action"
          aria-label="ทำซ้ำ"
          title={historyLocked ? "กติกา ห้ามยกปากกา: ทำซ้ำไม่ได้" : "ทำซ้ำ (⌘⇧Z)"}
          disabled={locked || !canRedo}
          onClick={onRedo}
        >
          <Icon name="redo" size={38} />
        </button>
      </div>

      {/* ── จานสี 20 สี + ปุ่ม "สีเอง" รวม 21 ช่อง เรียงเป็นตารางสี่เหลี่ยมเล็ก 7×3 ──
          colour_fix: ทั้งกลุ่มกดไม่ได้ (สีถูกล็อกไว้แล้ว) แต่ยังโชว์ให้เห็นว่ามีสีอะไรบ้าง
          สีที่ล็อกอยู่จะติด swatch--on เอง เพราะ Game ส่ง drawColor ลงมาเป็นสีที่ล็อกแล้ว
          (สีล็อกมาจากชุดสีหลักของ server ซึ่งอยู่ในจานนี้ครบ ดู palette.js) */}
      <div
        className="toolbar__group toolbar__group--colors"
        role="group"
        aria-label={colourLocked ? "สี (กติกาล็อกไว้ที่สีเดียว)" : "สี"}
        title={colourLocked ? "กติกา Colour Fix: ตานี้ใช้ได้สีเดียว" : undefined}
      >
        {PAINT_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            className={`swatch${color.toLowerCase() === c.hex ? " swatch--on" : ""}`}
            style={{ background: c.hex }}
            aria-label={colorLabel(c)}
            title={c.name}
            aria-pressed={color.toLowerCase() === c.hex}
            disabled={colourLocked}
            onClick={() => {
              onColor(c.hex);
              closePicker();
            }}
          />
        ))}
        {/* ช่องที่ 21 = สีเอง: พื้นสีรุ้งพิกเซล + เครื่องหมาย + (กดเพื่อเลือกสีเพิ่ม) ต่างจากช่องสีธรรมดาทันที
            เลือกสีเองแล้ว → มุมช่องมีจุดสีของสีเองล่าสุด · กดช่องนี้ขณะใช้สีอื่นอยู่ = ใช้สีเองล่าสุดเลย
            กดอีกครั้งตอนที่ใช้สีเองอยู่ = เปิด/ปิดช่องเลือกสีเพื่อปรับ (ยังไม่เคยเลือก = เปิดช่องเลือกสีก่อน) */}
        <button
          type="button"
          className={`swatch swatch--custom${customPicked ? " swatch--on" : ""}`}
          aria-label={hasPicked ? `สีเอง ${custom}` : "สีเอง เปิดช่องเลือกสี"}
          title={hasPicked ? "สีเอง: กดเพื่อใช้สีล่าสุด · กดซ้ำเพื่อปรับสี" : "สีเอง: เลือกสีเพิ่ม"}
          aria-pressed={customPicked}
          aria-expanded={pickerOpen}
          disabled={colourLocked}
          onClick={() => {
            if (!hasPicked || customPicked) return setPickerOpen((o) => !o);
            onColor(custom); // ใช้สีเองล่าสุดเลย
            setPickerOpen(false);
          }}
        >
          {hasPicked && <span className="swatch__dot" style={{ background: custom }} />}
        </button>
      </div>

      {pickerOpen && !colourLocked && (
        <ColorPicker hue={pick.hue} light={pick.light} onChange={handlePick} onClose={closePicker} />
      )}

      {/* ── ขนาดแปรง 2–40 ── */}
      <div className="toolbar__group toolbar__group--size">
        <span className="toolbar__label">ขนาด</span>
        <input
          type="range"
          className="toolbar__range"
          min={SIZE_MIN}
          max={Math.min(SIZE_MAX, maxSize)}
          value={Math.min(size, maxSize)}
          aria-label="ขนาดแปรง"
          onChange={(e) => onSize(Number(e.target.value))}
        />
        <span className="toolbar__size-value">{Math.min(size, maxSize)}</span>
      </div>

      {/* ── เครื่องมือ 4 ปุ่ม แถวเดียว อยู่ล่างสุดของแถบ · ไอคอนลอยเปล่าๆ ไม่มีกรอบ อันที่เลือกทึบเต็มมีขีดใต้ไอคอน ── */}
      <div className="toolbar__group toolbar__group--tools" role="group" aria-label="เครื่องมือ">
        {/* ปากกา+ยางลบ — shapes_only ซ่อนไปเลย เหลือแต่รูปทรง (server ทิ้งเส้นมือเปล่าทุกครั้ง) */}
        {!hidePen && (
          <button
            type="button"
            className={`tool${tool === TOOLS.PEN ? " tool--on" : ""}`}
            aria-label="ปากกา"
            aria-pressed={tool === TOOLS.PEN}
            onClick={() => onTool(TOOLS.PEN)}
          >
            <Icon name="pen" size={38} />
          </button>
        )}
        {!hidePen && (
          <button
            type="button"
            className={`tool${tool === TOOLS.ERASER ? " tool--on" : ""}`}
            aria-label="ยางลบ"
            aria-pressed={tool === TOOLS.ERASER}
            onClick={() => onTool(TOOLS.ERASER)}
          >
            <Icon name="eraser" size={38} />
          </button>
        )}
        {/* ถังสี — dont_lift_pen ซ่อนไปเลย เพราะกติกาคือ "ห้ามยกปากกา"
            การเทสีทั้งพื้นที่ในคลิกเดียวไม่ใช่การวาดเส้นต่อเนื่อง และ server ก็ทิ้ง fill ทุกครั้งอยู่แล้ว */}
        {!hideBucket && (
          <button
            type="button"
            className={`tool${tool === TOOLS.BUCKET ? " tool--on" : ""}`}
            aria-label="ถังสี"
            aria-pressed={tool === TOOLS.BUCKET}
            onClick={() => onTool(TOOLS.BUCKET)}
          >
            {/* ทั้งถัง หูหิ้ว หยดสี ใช้สีที่เลือกอยู่สีเดียว (เฉดเข้ม/อ่อนของสีนั้น) */}
            <Icon name="bucket" size={48} accent={color} />
          </button>
        )}
        {/* รูปทรง: เส้นตรง สี่เหลี่ยม วงกลม — ลากเห็นเงาก่อน ปล่อยแล้วค่อยวาดจริง */}
        {!hideShapes &&
          [
            [TOOLS.LINE, "เส้นตรง", "shape-line"],
            [TOOLS.RECT, "สี่เหลี่ยม", "shape-rect"],
            [TOOLS.CIRCLE, "วงกลม", "shape-circle"],
          ].map(([t, label, icon]) => (
            <button
              key={t}
              type="button"
              className={`tool${tool === t ? " tool--on" : ""}`}
              aria-label={label}
              title={label}
              aria-pressed={tool === t}
              onClick={() => onTool(t)}
            >
              <Icon name={icon} size={38} />
            </button>
          ))}
        {/* ล้างจอทำทันที ไม่ใช่โหมด จึงไม่ได้ค้างสถานะกดไว้แบบสามปุ่มบน */}
        <button type="button" className="tool tool--danger" aria-label="ล้างจอ" onClick={onClear}>
          <Icon name="trash" size={38} />
        </button>
      </div>
    </div>
  );
}

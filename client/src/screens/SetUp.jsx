import { useState } from "react";
import Ribbon from "../components/Ribbon";
import Critter from "../components/Critter";
import { randomName } from "../playerName";
import { AvatarArt, Icon } from "../components/Icons";
import { useEnterRoom } from "../hooks/useEnterRoom";
import OptionRow from "../components/OptionRow";
import AvatarPicker from "../components/AvatarPicker";
import { DIFFICULTY_CHOICES, VISIBILITY_CHOICES } from "../roomOptions";

// หน้า SET UP (กดสร้างห้องแล้วมาหน้านี้): ซ้าย ตั้งค่ารอบ/เวลา · ขวา การ์ดโหมดใหญ่สองใบ · ล่าง ปุ่มสร้างห้อง
// ค่าที่เลือกส่งไปกับ create_room (events.md §1) server เช็คซ้ำ ค่าไม่ถูกจะใช้ค่าเริ่มต้น
const ROUND_CHOICES = [1, 2, 3, 4, 5];
const TIME_CHOICES = [30, 45, 60, 90];

export default function SetUp({ connected, profile, onProfile, onBack, onEntered, onError, onStartSolo }) {
  const [mode, setMode] = useState("classic"); // classic | team | ai (ai = Solo แข่งกับ AI ไม่สร้างห้อง)
  const [rounds, setRounds] = useState(3);
  const [drawTime, setDrawTime] = useState(60);
  const [difficulty, setDifficulty] = useState("easy"); // ชุดคำ (ไม่เกี่ยวกับเวลา)
  const [visibility, setVisibility] = useState("private");
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  // Challenge เลือกเปิด/ปิดทีละใบในห้องรอ (การ์ด 4 ใบ) ไม่ตั้งที่นี่แล้ว — ห้องเริ่มด้วยชุดเริ่มต้นของ server
  const { busy, enter } = useEnterRoom({ connected, onEntered, onError });
  const { name, avatar } = profile;

  const isAI = mode === "ai";

  function submit() {
    if (isAI) {
      // โหมดแข่งกับ AI: ไม่สร้างห้อง เข้าเกม Solo ทันทีด้วยความยากที่เลือก
      onStartSolo(difficulty);
      return;
    }
    const who = name.trim() || randomName(); // กันกรณีชื่อว่าง
    enter(
      "create_room",
      { name: who, avatar, mode, rounds, drawTime, difficulty, visibility },
      { name: who, avatar }
    );
  }

  return (
    <div className="screen screen--setup">
      <button type="button" className="back-btn" onClick={onBack}>
        <Icon name="arrowL" size={14} /> กลับ
      </button>
      <Ribbon tone="red">SET UP</Ribbon>

      <div className="setup">
        <section className="panel setup__opts deco-host" aria-label="ตั้งค่าห้อง">
          <Critter name="cat" className="crit crit--top-left" />
          <h2 className="panel__title setup__title">ตั้งค่า</h2>
          <div className="setup__opt">
            <h3 className="setup__head">
              <Icon name="flag" size={22} /> จำนวนรอบ
            </h3>
            <div className="segmented" role="group" aria-label="จำนวนรอบ">
              {ROUND_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={rounds === n ? "seg seg--active" : "seg"}
                  aria-pressed={rounds === n}
                  onClick={() => setRounds(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="setup__opt">
            <h3 className="setup__head">
              <Icon name="clock" size={22} /> เวลาวาด <small>(วินาที)</small>
            </h3>
            <div className="segmented" role="group" aria-label="เวลาวาดต่อตา">
              {TIME_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={drawTime === n ? "seg seg--active" : "seg"}
                  aria-pressed={drawTime === n}
                  onClick={() => setDrawTime(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="setup__opt">
            <h3 className="setup__head">
              <Icon name="star" size={22} /> ความยากของคำ
            </h3>
            <OptionRow label="ระดับความยากของคำ" choices={DIFFICULTY_CHOICES} value={difficulty} onChange={setDifficulty} />
          </div>
          {/* โหมดแข่งกับ AI ไม่ต้องมีห้อง จึงซ่อนตัวเลือกประเภทห้อง */}
          {!isAI && (
            <div className="setup__opt">
              <h3 className="setup__head">
                <Icon name="door" size={22} /> ประเภทห้อง
              </h3>
              <OptionRow label="ประเภทห้อง" choices={VISIBILITY_CHOICES} value={visibility} onChange={setVisibility} />
            </div>
          )}
          <p className="setup__note">
            {isAI
              ? "แข่งกับ AI: วาดคนเดียว AI ทายภาพ ความยากของคำใช้ค่าที่เลือกด้านบน"
              : visibility === "public"
                ? "Public: ห้องขึ้นในรายการหน้าแรก ใครก็กดเข้าได้ · Mini Challenge เปิด/ปิดได้ในห้องรอ"
                : "Private: เข้าได้ด้วยรหัสห้องหรือลิงก์เชิญเท่านั้น · Mini Challenge เปิด/ปิดได้ในห้องรอ"}
          </p>
          <p className="setup__who">
            <AvatarArt index={avatar} size={34} />
            <span>{name.trim() || "ยังไม่ได้ใส่ชื่อ"}</span>
          </p>
          <button type="button" className="btn setup-avatar__toggle" aria-expanded={showAvatarPicker} onClick={() => setShowAvatarPicker((open) => !open)}>
            {showAvatarPicker ? "ซ่อนอวตาร" : "เปลี่ยนอวตาร"}
          </button>
          {showAvatarPicker && <AvatarPicker compact value={avatar} onChange={(nextAvatar) => onProfile({ ...profile, avatar: nextAvatar })} />}
        </section>

        <div className="mode-cards deco-host" role="radiogroup" aria-label="โหมดเกม">
          <Critter name="parrot" className="crit crit--top-right" />
          <button
            type="button"
            role="radio"
            aria-checked={mode === "classic"}
            className={mode === "classic" ? "mode-card mode-card--active" : "mode-card"}
            onClick={() => setMode("classic")}
          >
            <span className="mode-card__art mode-card__art--classic" aria-hidden="true">
              <AvatarArt index={1} size={44} />
              <span className="mode-card__frame">
                <Icon name="house" size={78} />
              </span>
              <AvatarArt index={3} size={44} />
            </span>
            <span className="mode-card__title">แข่งเดี่ยว</span>
            <span className="mode-card__desc">ทุกคนแข่งกันเอง ผลัดกันวาด คนอื่นพิมพ์ทาย ทายถูกเร็วได้คะแนนเยอะ</span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={mode === "team"}
            className={mode === "team" ? "mode-card mode-card--active" : "mode-card"}
            onClick={() => setMode("team")}
          >
            <span className="mode-card__art mode-card__art--team" aria-hidden="true">
              <span className="mode-card__side mode-card__side--A">
                <AvatarArt index={0} size={40} />
                <AvatarArt index={2} size={40} />
              </span>
              <span className="mode-card__vs">VS</span>
              <span className="mode-card__side mode-card__side--B">
                <AvatarArt index={4} size={40} />
                <AvatarArt index={5} size={40} />
              </span>
            </span>
            <span className="mode-card__title">ทีม A vs B</span>
            <span className="mode-card__desc">แบ่งสองทีม วาดคำเดียวกันพร้อมกัน ทีมไหนทายถูกก่อนได้โบนัส (ต้องมี 4 คนขึ้นไป)</span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={mode === "ai"}
            className={`mode-card mode-card--ai${mode === "ai" ? " mode-card--active" : ""}`}
            onClick={() => setMode("ai")}
          >
            <span className="mode-card__art mode-card__art--ai" aria-hidden="true">
              <Icon name="robot" size={78} />
            </span>
            <span className="mode-card__title">แข่งกับ AI</span>
            <span className="mode-card__desc">วาดคนเดียว AI ทายภาพ ยิ่งผ่านยิ่งยาก เก็บคะแนนขึ้นกระดาน (เล่นคนเดียวได้)</span>
          </button>
        </div>
      </div>

      <button type="button" className="big-btn big-btn--green setup__create" disabled={!connected || busy} onClick={submit}>
        <Icon name={isAI ? "robot" : "star"} size={28} />
        <span>{isAI ? "เริ่มเกม" : busy ? "กำลังสร้าง..." : "สร้างห้อง"}</span>
      </button>
    </div>
  );
}

import { useState } from "react";
import Logo from "../components/Logo";
import Critter, { GrassStrip, Sparkles } from "../components/Critter";
import Ribbon from "../components/Ribbon";
import LeaderboardPanel from "../components/LeaderboardPanel";
import AvatarPicker from "../components/AvatarPicker";
import JoinModal from "../components/JoinModal";
import OpenRooms from "../components/OpenRooms";
import { Icon } from "../components/Icons";
import { randomName, NAME_MAX_LEN } from "../playerName";
import { useEnterRoom } from "../hooks/useEnterRoom";

// หน้าแรก (หน้าเดียว ไม่รก)
// ซ้าย: ริบบิ้น PLAY · อวตารใหญ่ + ลูกศร · ชื่อ · ปุ่มใหญ่ 3 ปุ่ม (สร้างห้อง / เข้าห้อง / Solo)
// ขวา: Leaderboard เดือนนี้ (เวลาไทย)
// ชื่อกับอวตารอยู่ที่ App (profile) เพื่อให้ติดไปหน้า SET UP ได้ ฝั่งนี้แค่ช่วยให้ใช้ง่าย server ตรวจซ้ำเสมอ
export default function Lobby({
  connected,
  profile,
  onProfile,
  inviteCode,
  onEntered,
  onError,
  onOpenSetup,
}) {
  // เปิดจากลิงก์เชิญ (?room=12345) → กล่องใส่รหัสขึ้นเองพร้อมรหัสที่เติมไว้แล้ว
  const [joining, setJoining] = useState(Boolean(inviteCode));
  const { busy, enter } = useEnterRoom({ connected, onEntered, onError });

  const name = profile.name;

  function join(code) {
    const who = name.trim() || randomName(); // กันกรณีชื่อว่าง
    enter("join_room", { code, name: who, avatar: profile.avatar }, { name: who, avatar: profile.avatar });
  }

  return (
    <div className="screen screen--home">
      <GrassStrip />
      <div className="logo-wrap">
        <Logo />
        <Sparkles spots={[[-8, 10, 3, 0], [104, 0, 4, 0.7], [-2, 78, 2, 1.4], [98, 82, 3, 0.35], [50, -22, 2, 1.1]]} />
      </div>

      <div className="lobby">
        <section className="panel home deco-host" aria-label="เริ่มเล่น">
          <Critter name="cat" className="crit crit--top-left" />
          <Critter name="star" className="crit crit--side-left" />
          <Ribbon tone="red">PLAY</Ribbon>

          <AvatarPicker value={profile.avatar} onChange={(avatar) => onProfile({ ...profile, avatar })} />

          <label className="field__label" htmlFor="player-name">
            CHOOSE YOUR NAME
          </label>
          {/* ช่องชื่อมีชื่อสุ่มใส่ไว้ให้แล้ว (ไม่ต้องพิมพ์ก็เล่นได้) · ปุ่มลูกเต๋า = สุ่มชื่อใหม่ · ปล่อยช่องว่างไว้ = สุ่มให้เองตอนออกจากช่อง */}
          <div className="name-row">
            <input
              id="player-name"
              className="input"
              value={name}
              onChange={(e) => onProfile({ ...profile, name: e.target.value })}
              onBlur={() => !name.trim() && onProfile({ ...profile, name: randomName() })}
              maxLength={NAME_MAX_LEN}
              placeholder="ชื่อเล่นของคุณ"
              autoComplete="off"
            />
            <button
              type="button"
              className="icon-btn name-row__dice"
              onClick={() => onProfile({ ...profile, name: randomName() })}
              aria-label="สุ่มชื่อใหม่"
              title="สุ่มชื่อใหม่"
            >
              <Icon name="dice" size={30} />
            </button>
          </div>
          <small className="name-owner-note">ชื่อนี้ผูกกับเบราว์เซอร์เครื่องนี้ · ล้างข้อมูลหรือเปลี่ยนเครื่องอาจใช้ชื่อเดิมไม่ได้</small>

          <div className="home__buttons">
            <button type="button" className="big-btn big-btn--green" disabled={!connected} onClick={onOpenSetup}>
              <Icon name="star" size={44} />
              <span>สร้างห้อง</span>
            </button>
            <button type="button" className="big-btn big-btn--blue" disabled={!connected} onClick={() => setJoining(true)}>
              <Icon name="door" size={44} />
              <span>เข้าห้อง</span>
            </button>
          </div>
          {/* โหมดแข่งกับ AI ย้ายไปเป็นการ์ดโหมดในหน้า SET UP แล้ว (กด "สร้างห้อง" แล้วเลือก "แข่งกับ AI") */}

          {!connected && (
            <p className="form-note">
              ยังต่อ server ไม่ได้ — เปิด server ด้วย <code>cd server && node index.js</code> ก่อน
            </p>
          )}
        </section>

        {/* Leaderboard ตัวเต็มในการ์ดขวาเลย (dropdown เดือน + แท็บ + ตาราง) ตารางเลื่อนภายในการ์ด */}
        <section className="panel lobby__board board-panel deco-host" aria-label="Leaderboard">
          <Critter name="parrot" className="crit crit--top-right" />
          <Critter name="trophy" className="crit crit--side-right" />
          <LeaderboardPanel limit={20} scroll meName={name.trim()} />
        </section>

        {/* ห้อง Public: กดเข้าได้เลยด้วยชื่อ/อวตารที่เลือกไว้ข้างบน */}
        <OpenRooms disabled={!connected || busy} onJoin={join} />
      </div>

      {joining && <JoinModal initialCode={inviteCode ?? ""} busy={busy} onSubmit={join} onClose={() => setJoining(false)} avatar={profile.avatar} onAvatarChange={(avatar) => onProfile({ ...profile, avatar })} />}
    </div>
  );
}

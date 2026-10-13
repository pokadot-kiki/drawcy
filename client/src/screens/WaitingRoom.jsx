import { useEffect, useState } from "react";
import { socket } from "../socket";
import Avatar from "../components/Avatar";
import Logo from "../components/Logo";
import { MascotNote } from "../components/Mascot";
import { InfoModal } from "../components/TopIcons";
import { AudioButtons } from "../components/AudioDock";
import YouTag from "../components/YouTag";
import { markRulesSeen, rulesSeen } from "../prefs";
import { Icon } from "../components/Icons";
import { copyText, inviteUrl } from "../invite";
import OptionRow from "../components/OptionRow";
import ChallengeCards from "../components/ChallengeCards";
import Chat from "../components/Chat";
import { DIFFICULTY_CHOICES, VISIBILITY_CHOICES, DEFAULT_CHALLENGES, MAX_PLAYERS_LIMIT, maxPlayersChoices, TEAM_COUNT_CHOICES, TEAM_MIN_PLAYERS, teamIdsOf, teamCapOf, minPlayersForTeams } from "../roomOptions";

// ค่าที่ server ยอมรับ ตาม events.md (ค่าอื่น server จะเมิน)
const ROUND_CHOICES = [1, 2, 3, 4, 5].map((n) => [n, String(n)]);
const TIME_CHOICES = [30, 45, 60, 90].map((n) => [n, String(n)]);
const MODE_CHOICES = [
  ["classic", "แข่งเดี่ยว"],
  ["team", "โหมดทีม"],
];
const TEAM_MIN = TEAM_MIN_PLAYERS; // โหมดทีมต้องมีทีมละอย่างน้อย 2 คน (server เช็คซ้ำ)

// การ์ดตัวเลือกหนึ่งใบในกล่อง "ตั้งค่าเกม" (เลขกำกับ + ชื่อ + ปุ่มเลือก) wide = กินเต็มสองคอลัมน์
function Opt({ n, label, wide = false, children }) {
  return (
    <div className={wide ? "wr-opt wr-opt--wide" : "wr-opt"}>
      <div className="wr-opt__head">
        <span className="wr-opt__num" aria-hidden="true">
          {n}
        </span>
        <span className="wr-opt__label">{label}</span>
      </div>
      {children}
    </div>
  );
}

export default function WaitingRoom({ room, me, onLeave }) {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  // กล่องกติกาโชว์เองครั้งแรกที่เข้าห้อง (จำไว้ในเบราว์เซอร์) ครั้งต่อไปกดดูเองได้จากปุ่ม ℹ️ ในหน้าเกม
  const [showRules, setShowRules] = useState(() => !rulesSeen());
  const isHost = room.hostId === me?.playerId;
  const teamMode = room.settings.mode === "team";
  const teamSize = (t) => room.players.filter((p) => p.team === t).length;
  const teamCount = room.settings.teams ?? 2; // หัวห้องเลือก 2/3/4 ทีม
  const TEAMS = teamIdsOf(teamCount); // ["A","B"] · ["A","B","C"] · ["A","B","C","D"]
  const teamsReady = TEAMS.every((t) => teamSize(t) >= TEAM_MIN);
  const maxPlayers = room.settings.maxPlayers ?? MAX_PLAYERS_LIMIT; // หัวห้องเลือกไว้กี่คน
  const teamCap = teamCapOf(maxPlayers, teamCount); // ทีมละกี่คนได้สูงสุด
  const sizes = TEAMS.map(teamSize);
  const spread = Math.max(...sizes) - Math.min(...sizes);
  const teamsBalanced = spread <= 1; // ทุกทีมคนต่างกันไม่เกิน 1 (server เช็คซ้ำตอนเริ่ม)
  const sizesText = TEAMS.map((t) => `${t} ${teamSize(t)} คน`).join(" · ");
  const showTeamScore = teamMode && TEAMS.some((t) => (room.teamScores?.[t] ?? 0) > 0); // เพิ่งจบเกมมา: โชว์คะแนนรวมทีม
  const meInRoom = room.players.find((p) => p.id === me?.playerId);
  const myTeam = meInRoom?.team ?? null;
  const myReady = meInRoom?.ready ?? false;
  // ผู้เล่นคนอื่น (ไม่ใช่หัวห้อง) ต้องกด Ready ครบทุกคน หัวห้องจึงเริ่มได้ (หัวห้องไม่ต้องกด)
  const others = room.players.filter((p) => p.id !== room.hostId);
  const allReady = others.length > 0 && others.every((p) => p.ready);
  const enoughPlayers = teamMode ? teamsReady && teamsBalanced : room.players.length >= 2;
  const canStart = enoughPlayers && allReady;

  useEffect(() => {
    setChatMessages([]);
    const onChatMessage = (message) => setChatMessages((items) => [...items.slice(-79), message]);
    socket.on("chat_message", onChatMessage);
    return () => socket.off("chat_message", onChatMessage);
  }, [room.code]);

  function sendRoomChat(text) {
    socket.emit("guess", { text });
  }

  // ลิงก์เชิญ: เพื่อนเปิดแล้วหน้าแรกเติมรหัสห้องให้เอง
  async function copyLink() {
    if (await copyText(inviteUrl(room.code))) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    }
  }

  function copyCode() {
    navigator.clipboard?.writeText(room.code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {} // เบราว์เซอร์บางตัวไม่ให้คัดลอก ก็ไม่เป็นไร ให้ผู้ใช้จดเอง
    );
  }

  // แก้ตั้งค่าได้เฉพาะหัวห้อง — server เช็คซ้ำอีกชั้นเสมอ
  // ส่งไปทั้งก้อนตามหน้าตาใน events.md (server อ่านแค่ rounds กับ drawTime)
  function changeSetting(patch) {
    socket.emit("update_settings", { ...room.settings, ...patch });
  }

  // ที่นั่งที่ยังว่าง — ขนาดเท่ากับการ์ดผู้เล่นจริงทุกประการ (ความสูงเท่ากัน ดู CSS .player-card)
  // ทำให้ทั้งห้องดู "เต็มผัง" ไม่ใช่การ์ดลอยอยู่สองใบแล้วเหลือที่ว่างเป็นพรวด
  function renderEmptySeats(count, keyPrefix) {
    return Array.from({ length: Math.max(0, count) }, (_, i) => (
      <div className="player-card player-card--empty" key={`${keyPrefix}-seat-${i}`} aria-hidden="true">
        <span className="player-card__seat">
          <Icon name="users" size={18} />
        </span>
        <span className="player-card__seat-text">ว่าง</span>
      </div>
    ));
  }

  function renderPlayer(player) {
    return (
      <div
        key={player.id}
        className={`player-card${player.id === me?.playerId ? " player-card--me" : ""}${player.connected === false ? " player-card--away" : ""}`}
      >
        <Avatar index={player.avatar} />
        <span className="player-card__who">
          <span className="player-card__name">
            {player.name}
            {/* หลุดอยู่: server ยังเก็บที่ไว้ให้ 30 วิ เผื่อรีเฟรชแล้วกลับมา */}
            {player.connected === false && <small className="player-card__away"> (หลุด กำลังรอ...)</small>}
          </span>
          <small className="player-card__score">{player.score ?? 0} คะแนน</small>
        </span>
        {player.id === me?.playerId && <YouTag />}
        <span className="player-card__badges">
          {/* ใช้ hostId เป็นหลัก เพราะ server เป็นคนตัดสินว่าใครเป็นหัวห้อง */}
          {player.id === room.hostId ? (
            <span title="หัวห้อง" aria-label="หัวห้อง">
              <Icon name="crown" size={22} />
            </span>
          ) : (
            // ผู้เล่นคนอื่นโชว์สถานะ READY / WAITING
            <span className={`ready-badge ready-badge--${player.ready ? "on" : "off"}`}>
              {player.ready ? "พร้อม" : "รอ"}
            </span>
          )}
          {/* หัวห้องเห็นปุ่มเตะออกข้างชื่อคนอื่น (ไม่ใช่ตัวเอง) — server ตรวจซ้ำว่าเป็นหัวห้อง */}
          {isHost && player.id !== me?.playerId && (
            <button
              type="button"
              className="kick-btn"
              aria-label={`เตะ ${player.name} ออกจากห้อง`}
              title="เตะออกจากห้อง"
              onClick={() => socket.emit("kick_player", { playerId: player.id })}
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </span>
      </div>
    );
  }

  return (
    // wr--host / wr--guest ใช้สลับลำดับกล่องบนมือถือ (หัวห้องตั้งค่าก่อน ผู้เล่นทั่วไปดูรายชื่อก่อน)
    <div className={`screen screen--waiting ${isHost ? "wr--host" : "wr--guest"}${teamMode ? " wr--team" : ""}`}>
      {/* แถบบน: โลโก้ + รหัสห้อง ซ้าย · เสียง โปรไฟล์ ปุ่มออก ขวา */}
      <header className="wr-topbar">
        <div className="wr-topbar__left">
          <Logo />
          <span className="wr-roomchip">ห้อง {room.code}</span>
        </div>
        <div className="wr-topbar__right">
          <AudioButtons />
          {meInRoom && (
            <span className="wr-me" title={meInRoom.name}>
              <Avatar index={meInRoom.avatar} />
              <span className="wr-me__name">{meInRoom.name}</span>
            </span>
          )}
          <button type="button" className="btn btn--danger wr-exit" onClick={onLeave}>
            <Icon name="door" size={20} /> ออกจากห้อง
          </button>
        </div>
      </header>

      <main className="wr">
        {/* แถบรหัสห้อง: กดรหัส = คัดลอกรหัส · ปุ่ม = คัดลอกลิงก์เชิญ · ขวา = ประเภทห้อง */}
        <div className="wr-bar">
          <button
            type="button"
            className="wr-code"
            onClick={copyCode}
            aria-label={`คัดลอกรหัสห้อง ${room.code}`}
            title="กดเพื่อคัดลอกรหัสห้อง แล้วส่งให้เพื่อน"
          >
            <span className="wr-code__label">รหัสห้อง</span>
            <span className="wr-code__digits">{copied ? "คัดลอกแล้ว!" : room.code}</span>
            <Icon name="share" size={20} />
          </button>
          <button type="button" className="btn btn--invite" onClick={copyLink}>
            {linkCopied ? "คัดลอกลิงก์แล้ว!" : "คัดลอกลิงก์เชิญ"}
          </button>
          <div className="wr-bar__right">
            <button type="button" className="btn wr-rules-btn" onClick={() => setShowRules(true)}>
              <Icon name="info" size={20} /> กติกา
            </button>
            <span className="wr-chip wr-bar__vis">ห้อง {room.settings.visibility === "public" ? "Public" : "Private"}</span>
          </div>
        </div>

        <div className="wr__cols">
          {/* ===== ซ้าย: ตั้งค่าเกม + Mini Challenge (ค่ามาจาก room.settings ที่ server เก็บ ทุกคนเห็นตรงกัน) ===== */}
          <div className="wr__left">
            <section className="wr-card wr-card--settings" aria-label="ตั้งค่าเกม">
              <div className="wr-card__head">
                <h2 className="wr-card__title">ตั้งค่าเกม</h2>
                {/* ผู้เล่นทั่วไปดูได้อย่างเดียว (รวมถึงการ์ด Mini Challenge ข้างล่างด้วย) */}
                {!isHost && <span className="wr-card__note">หัวห้องเป็นคนตั้งค่าและเปิด/ปิดกติกา</span>}
              </div>
              <div className="wr-opts">
                <Opt n={1} label="โหมด">
                  <OptionRow
                    label="โหมดเกม"
                    choices={MODE_CHOICES}
                    value={room.settings.mode}
                    disabled={!isHost}
                    onChange={(mode) => changeSetting({ mode })}
                  />
                </Opt>
                <Opt n={2} label={teamMode ? "จำนวนทีม" : "จำนวนผู้เล่น"}>
                  {teamMode ? (
                    <OptionRow
                      label="จำนวนทีม"
                      choices={TEAM_COUNT_CHOICES}
                      value={teamCount}
                      disabled={!isHost}
                      onChange={(teams) => changeSetting({ teams })}
                    />
                  ) : (
                    <OptionRow
                      label="จำนวนผู้เล่นสูงสุด"
                      choices={maxPlayersChoices()}
                      value={maxPlayers}
                      disabled={!isHost}
                      onChange={(maxPlayers) => changeSetting({ maxPlayers })}
                    />
                  )}
                </Opt>
                <Opt n={3} label="เวลาต่อตา (วินาที)">
                  <OptionRow
                    label="เวลาวาดต่อตา"
                    choices={TIME_CHOICES}
                    value={room.settings.drawTime}
                    disabled={!isHost}
                    onChange={(drawTime) => changeSetting({ drawTime })}
                  />
                </Opt>
                <Opt n={4} label="จำนวนรอบ">
                  <OptionRow
                    label="จำนวนรอบ"
                    choices={ROUND_CHOICES}
                    value={room.settings.rounds}
                    disabled={!isHost}
                    onChange={(rounds) => changeSetting({ rounds })}
                  />
                </Opt>
                <Opt n={5} label="ความยากของคำ">
                  <OptionRow
                    label="ระดับความยากของคำ"
                    choices={DIFFICULTY_CHOICES}
                    value={room.settings.difficulty}
                    disabled={!isHost}
                    onChange={(difficulty) => changeSetting({ difficulty })}
                  />
                </Opt>
                <Opt n={6} label="ประเภทห้อง">
                  <OptionRow
                    label="ประเภทห้อง"
                    choices={VISIBILITY_CHOICES}
                    value={room.settings.visibility}
                    disabled={!isHost}
                    onChange={(visibility) => changeSetting({ visibility })}
                  />
                </Opt>
              </div>
            </section>

            {/* การ์ด Mini Challenge — ทุกคนเห็น (หัวห้องกดสลับได้ คนอื่นดูอย่างเดียว) */}
            <section className="wr-card wr-card--challenges" aria-label="Mini Challenge">
              <ChallengeCards enabled={room.settings.challenges ?? DEFAULT_CHALLENGES} isHost={isHost} />
            </section>
          </div>

          {/* ===== ขวา: ผู้เล่น + ปุ่มเริ่ม/พร้อม (+ กติกาทีมถ้าเป็นโหมดทีม) ===== */}
          <div className="wr__right">
            <section className={`wr-card wr-card--players${room.players.length < 2 ? " wr-card--waiting" : ""}`} aria-label="ผู้เล่น">
              <div className="wr-card__head">
                <h2 className="wr-card__title">
                  <Icon name="users" size={22} /> ผู้เล่น
                </h2>
                <span className="wr-chip">
                  {room.players.length}/{maxPlayers} คน
                </span>
              </div>
              {teamMode ? (
                // โหมดทีม: 2–4 ฝั่ง (แดง ฟ้า เขียว เหลือง) · แถบบอกความสมดุลและรายชื่อของแต่ละทีม
                <>
                  <div className={`wr-balance ${teamsBalanced ? "wr-balance--ok" : "wr-balance--bad"}`} role="status">
                    <div className="wr-balance__bar" aria-hidden="true">
                      {TEAMS.map((t) => (
                        <span key={t} className={`wr-balance__seg wr-balance__${t}`} style={{ flexGrow: Math.max(teamSize(t), 0.15) }}>
                          {teamSize(t)}
                        </span>
                      ))}
                    </div>
                    <span className="wr-balance__text">
                      {teamsBalanced ? "ทีมสมดุล" : `ไม่สมดุล (ต่างกัน ${spread} คน · ต้องไม่เกิน 1)`}
                    </span>
                    {isHost && (
                      <button type="button" className="btn wr-balance__btn" onClick={() => socket.emit("balance_teams")}>
                        <Icon name="dice" size={18} /> จัดทีมให้สมดุล
                      </button>
                    )}
                  </div>
                  <div className={`team-cols team-cols--${TEAMS.length}`}>
                    {TEAMS.map((t) => {
                      const members = room.players.filter((p) => p.team === t);
                      const full = members.length >= teamCap;
                      return (
                        <section className={`team-col team-col--${t}`} key={t} aria-label={`ทีม ${t}`}>
                          <h3 className="team-col__title">
                            <span className="team-col__name">
                              <span className="team-col__badge" aria-hidden="true">{t}</span> ทีม {t}
                            </span>
                            <span className="team-col__count">
                              {members.length}/{teamCap} คน
                              {showTeamScore && <small> · {room.teamScores?.[t] ?? 0} คะแนน</small>}
                            </span>
                          </h3>
                          <div className="player-list">
                            {members.map(renderPlayer)}
                            {renderEmptySeats(teamCap - members.length, t)}
                          </div>
                          {myTeam !== t && (
                            <button
                              type="button"
                              className="btn team-col__join"
                              disabled={full}
                              onClick={() => socket.emit("set_team", { team: t })}
                            >
                              {full ? `ทีม ${t} เต็ม` : `ย้ายมาทีม ${t}`}
                            </button>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="player-list">
                  {room.players.map(renderPlayer)}
                  {renderEmptySeats(maxPlayers - room.players.length, "solo")}
                </div>
              )}
              {/* อยู่คนเดียว = มาสคอตถือนาฬิการอเพื่อน */}
              {room.players.length < 2 && <MascotNote mood="wait">รอเพื่อนเข้าห้อง...</MascotNote>}

              <div className="wr-actions">
                {isHost ? (
                  <button
                    type="button"
                    className="btn btn--primary wr-actions__go"
                    disabled={!canStart}
                    onClick={() => socket.emit("start_game")}
                  >
                    เริ่มเกม
                  </button>
                ) : (
                  // ผู้เล่นคนอื่นกดพร้อม/ยกเลิก (สลับได้) — รอหัวห้องเริ่มเกม
                  <button
                    type="button"
                    className={`${myReady ? "btn btn--ready-on" : "btn btn--primary"} wr-actions__go`}
                    onClick={() => socket.emit("set_ready", { ready: !myReady })}
                  >
                    {myReady ? "ยกเลิกพร้อม" : "พร้อม"}
                  </button>
                )}

                {isHost && !enoughPlayers && (
                  <p className="form-note">
                    {!teamMode
                      ? "ต้องมีผู้เล่นอย่างน้อย 2 คนจึงเริ่มได้"
                      : !teamsReady
                        ? `${teamCount} ทีมต้องมีอย่างน้อย ${minPlayersForTeams(teamCount)} คน (ทีมละ ${TEAM_MIN} คนขึ้นไป) · ตอนนี้ ${sizesText}`
                        : `ทีมไม่สมดุล (${sizesText}) ทุกทีมต้องต่างกันไม่เกิน 1 คน กด "จัดทีมให้สมดุล" ก่อนเริ่มเกม`}
                  </p>
                )}
                {isHost && enoughPlayers && !allReady && (
                  <p className="form-note">รอผู้เล่นคนอื่นกด "พร้อม" ให้ครบทุกคนก่อนเริ่มเกม</p>
                )}
                {isHost && canStart && <p className="form-note form-note--ok">ทุกคนพร้อมแล้ว เริ่มเกมได้เลย!</p>}
                {!isHost && teamMode && !teamsReady && (
                  <p className="form-note">โหมดทีมต้องมีทีมละอย่างน้อย {TEAM_MIN} คนถึงจะเริ่มได้</p>
                )}
                {!isHost && teamMode && teamsReady && !teamsBalanced && (
                  <p className="form-note">ทีมยังไม่สมดุล รอหัวห้องจัดทีมให้</p>
                )}
                {!isHost && enoughPlayers && <p className="form-note">รอหัวห้องเริ่มเกม...</p>}
              </div>
            </section>

            <Chat
              className="wr-chat panel panel--answers"
              messages={chatMessages}
              meId={me?.playerId}
              onSend={sendRoomChat}
              autoFocus={false}
              title="แชทรอห้อง"
              emptyText="ทักทายเพื่อนที่เข้าห้องได้เลย"
              placeholder="พิมพ์ข้อความ..."
            />

          </div>
        </div>
      </main>

      {showRules && (
        <InfoModal
          teamMode={teamMode}
          onClose={() => {
            markRulesSeen();
            setShowRules(false);
          }}
        />
      )}
    </div>
  );
}

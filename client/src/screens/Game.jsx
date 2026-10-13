import { useEffect, useRef, useState } from "react";
import HintSlots from "../components/HintSlots";
import Timer from "../components/Timer";
import TimeBar from "../components/TimeBar";
import { MascotNote } from "../components/Mascot";
import Scoreboard from "../components/Scoreboard";
import Chat from "../components/Chat";
import RoomLog from "../components/RoomLog";
import ChallengeBanner from "../components/ChallengeBanner";
import Canvas from "../components/Canvas";
import Toolbar from "../components/Toolbar";
import WordChoiceModal from "../components/WordChoiceModal";
import ChallengeIntro from "../components/ChallengeIntro";
import RoundSummaryModal from "../components/RoundSummaryModal";
import GameOverModal from "../components/GameOverModal";
import { TopIcons, InfoModal, ExitModal } from "../components/TopIcons";
import { markTeamRulesSeen, teamRulesSeen } from "../prefs";
import { play } from "../sound/sfx";
import { clearBoard } from "../canvas/actions";
import { PAINT_COLORS, SIZE_DEFAULT, TOOLS, isShapeTool } from "../canvas/palette";
import { Icon } from "../components/Icons";
import { Sparkles, PAGE_SPARKLES } from "../components/Critter";

/**
 * หน้าเกมทั้งหมด (ข้อ 2 + กระดานวาดข้อ 3)
 *
 * หน้านี้ไม่ผูก socket เอง รับสถานะสำเร็จรูปมาจาก useGame ที่ App เรียก
 * เพราะหน้านี้เกิดตอนได้ game_started เท่านั้น event ที่มาก่อนหน้าจะหลุด
 */
export default function Game({
  room,
  meId,
  game,
  chooseLeft,
  chooseWord,
  sendGuess,
  startGame,
  sendAction,
  askUndo,
  askRedo,
  askHint,
  bindCanvas,
  onLeave,
  onToast,
}) {
  const players = room.players;
  const isDrawer = game.drawerId === meId;
  const drawing = Boolean(game.round); // กำลังวาดอยู่ (round_start มาแล้ว ยังไม่ round_end)
  // โหมดทีม: drawerId/hint/✅ ที่ได้รับเป็นของ "ทีมเรา" เสมอ (server ส่งแยกทีม)
  const teamMode = room.settings.mode === "team";
  const myTeam = teamMode ? players.find((p) => p.id === meId)?.team ?? null : null;
  const teamSkipped = teamMode && game.teamSkipped && drawing; // ตานี้ทีมเราไม่มีคนวาด
  const drawerName =
    players.find((p) => p.id === game.drawerId)?.name ?? (teamSkipped ? "ไม่มีคนวาด" : "—");

  // มาสคอตกลางกระดานตอนยังไม่มีเส้น (หายเองเมื่อมีเส้นแรก) — เลือกอารมณ์ตามสถานะของตา
  // ถ้ามีหน้าต่างสรุปตา/จบเกมเปิดอยู่ ภาพของตาที่แล้วยังค้างบนกระดาน มาสคอตจึงไปอยู่ในหน้าต่างนั้นแทน
  let boardMascot = null;
  if (game.intro) {
    boardMascot = null; // ช่วงป้ายใหญ่: ป้ายใหญ่ขึ้นแทน ไม่ซ้อนกับมาสคอตกลางกระดาน
  } else if (teamSkipped) {
    boardMascot = <MascotNote mood="shock">ตานี้ทีมเราไม่มีคนวาด รอตาหน้านะ</MascotNote>;
  } else if (drawing) {
    boardMascot = isDrawer ? (
      <MascotNote mood="draw">ถึงตาคุณวาดแล้ว!</MascotNote>
    ) : (
      <MascotNote mood="wait">รอ {drawerName} เริ่มวาด...</MascotNote>
    );
  } else if (!game.summary && !game.ranking) {
    boardMascot = (
      <MascotNote mood="think">{game.options ? "เลือกคำที่จะวาดเลย" : "คนวาดกำลังเลือกคำ..."}</MascotNote>
    );
  }

  // ── Mini Challenge ของตานี้ (ข้อ 5) ──
  // มาจาก server เท่านั้น (game.round.challenge ติดมากับ round_start) client ไม่สุ่มเอง
  const challenge = game.round?.challenge ?? null;
  const colourFix = challenge?.type === "colour_fix" ? challenge.color : null;
  const noLift = challenge?.type === "dont_lift_pen";
  const shapesOnly = challenge?.type === "shapes_only"; // วาดได้แต่รูปทรง (ซ่อนปากกา/ยางลบ)
  // dont_lift_pen ห้ามย้อน/ทำซ้ำ **ที่หน้าจอด้วย** ไม่ใช่แค่ที่ server
  // (server ก็ปฏิเสธอยู่แล้ว ตรงนี้ทำเพื่อไม่ให้ผู้เล่นเสียเวลากดปุ่มที่ไม่ทำอะไร)
  const historyLocked = noLift;

  // วาดได้เฉพาะคนวาด และเฉพาะช่วงกำลังวาด (โจทย์ข้อ 6)
  // ช่วงเลือกคำ game.round ยังเป็น null จึงวาดไม่ได้ ซึ่งถูกต้อง — ยังไม่รู้คำด้วยซ้ำ
  // ยกปากกาแล้ว (penLocked) ก็วาดต่อไม่ได้อีกทั้งตา
  // ช่วงป้ายใหญ่ (game.intro) ยังวาดไม่ได้ — server ทิ้งการวาดที่มาก่อนเวลาอยู่แล้ว ตรงนี้แค่ปิดเครื่องมือให้เห็นชัด
  const canDraw = isDrawer && drawing && !game.penLocked && !game.intro;

  // เครื่องมือที่เลือกอยู่ — เป็นสถานะของหน้าจอ ไม่เกี่ยวกับ server
  const [toolChoice, setToolChoice] = useState(TOOLS.PEN);
  const [color, setColor] = useState(PAINT_COLORS[0].hex); // เริ่มที่สีดำ (ตัวแรกในพาเลต)
  const [size, setSize] = useState(SIZE_DEFAULT);
  // กล่องกติกา ℹ️ — เริ่มเกมโหมดทีมครั้งแรก (ยังไม่เคยเห็นกติกาทีม) โชว์เองเลย
  const [showInfo, setShowInfo] = useState(() => room.settings.mode === "team" && !teamRulesSeen());
  const closeInfo = () => {
    if (teamMode) markTeamRulesSeen();
    setShowInfo(false);
  };
  const [showExit, setShowExit] = useState(false); // กล่องยืนยันออก
  const canvasRef = useRef(null); // ใช้เรียกคำสั่งบนกระดาน (รับ action ของคนอื่น · สั่งล้างจอ)

  // ค่าที่ "มีผลจริง" ของตานี้ — คิดออกมาจากที่เดียว ไม่ต้องมี effect คอยแก้ state
  // (ถ้าใช้ effect ค่อยบังคับ state จะมีวาบหนึ่งที่ยังใช้ค่าที่ผิดกติกาอยู่)
  //   colour_fix → ใช้สีที่ล็อกไว้ ไม่สนใจสีที่ผู้ใช้เลือก (สีที่เลือกไว้ยังอยู่ครบ กลับมาใช้ได้ตาถัดไป)
  //   dont_lift_pen → ถังสีหายไป ถ้าเลือกถังสีค้างไว้ก็ถอยไปใช้ปากกา
  const drawColor = colourFix ?? color;
  //   dont_lift_pen → ถังสี/รูปทรงหายไป ถอยไปใช้ปากกา
  //   shapes_only → ปากกา/ยางลบหายไป ถ้าเลือกค้างไว้ก็ถอยไปใช้รูปทรงเส้นตรง
  let tool = noLift && (toolChoice === TOOLS.BUCKET || isShapeTool(toolChoice)) ? TOOLS.PEN : toolChoice;
  if (shapesOnly && (tool === TOOLS.PEN || tool === TOOLS.ERASER)) tool = TOOLS.LINE;

  // ── เสียงเอฟเฟกต์ (ข้อ 1 ของรอบตกแต่งที่ 2) ──
  // ทุกเสียงขับจากสถานะที่ server ส่งมา ไม่ได้ผูกกับ event ตรงๆ (หน้านี้ไม่ได้ผูก socket เอง)
  // เริ่มตา: roundKey เพิ่มทุกครั้งที่ได้ round_start
  useEffect(() => {
    if (game.round) play(game.round.intro ? "alert" : "roundStart"); // ตาที่มี Mini Challenge: เสียงเตือนแทนเสียงเริ่มตา
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.roundKey]);

  // ทายถูก: ดูว่ารายชื่อคนทายถูก "เพิ่ม" ใครบ้าง — ถ้ามีเราอยู่ในนั้นเป็นเสียงของเรา ไม่งั้นเสียงเบาของคนอื่น
  // เทียบกับรอบเดียวกันเท่านั้น (ตาใหม่/เข้าห้องกลางตา guessed ถูกตั้งใหม่ทั้งชุด ไม่ใช่ "มีคนทายถูกเพิ่ม")
  const guessSeen = useRef({ key: game.roundKey, n: game.guessed.length });
  useEffect(() => {
    const prev = guessSeen.current;
    if (prev.key === game.roundKey && game.guessed.length > prev.n) {
      play(game.guessed.slice(prev.n).includes(meId) ? "selfCorrect" : "otherCorrect");
    }
    guessSeen.current = { key: game.roundKey, n: game.guessed.length };
  }, [game.guessed, game.roundKey, meId]);

  // 10 วิสุดท้าย: ติ๊กทุกวินาที (เหลือ ≤3 วิเสียงสูงขึ้น)
  useEffect(() => {
    const t = game.timeLeft;
    if (drawing && t > 0 && t <= 10) play("tick", t <= 3);
  }, [game.timeLeft, drawing]);

  // จบเกม
  useEffect(() => {
    if (game.ranking) play("gameOver");
  }, [game.ranking]);

  // ── ผูกกระดานเข้ากับ useGame ──
  // useGame เป็นคนรับ event การวาดจาก socket แต่มันไม่ถือ ref ของกระดาน (กระดานอยู่ลึกกว่านี้)
  // หน้านี้จึงเป็นคนส่ง ref ให้ — effect ของลูก (useImperativeHandle ใน Canvas) ทำงานก่อน effect ของแม่
  // จึงรับประกันได้ว่า canvasRef.current มีค่าแล้วตอน effect นี้ทำงาน
  useEffect(() => {
    bindCanvas(canvasRef.current);
    return () => bindCanvas(null);
  }, [bindCanvas]);

  // ── คีย์ลัดย้อนกลับ/ทำซ้ำ (ข้อ 4) ──
  // ⌘Z ย้อน · ⌘⇧Z ทำซ้ำ (Mac) — รับ Ctrl ด้วยเพราะ Windows/Linux ใช้ Ctrl
  // เปิดใช้เฉพาะตอนเราวาดได้จริง ไม่งั้นคนทายกด ⌘Z แล้วกระดานคนอื่นจะย้อนตามไปด้วย
  useEffect(() => {
    // dont_lift_pen ปิดคีย์ลัดด้วย ไม่ใช่แค่ปุ่ม (กฎเดียวกับปุ่ม: ห้ามย้อน = ห้ามทุกทาง)
    if (!canDraw || historyLocked) return undefined;

    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      // ถ้าโฟกัสอยู่ในช่องพิมพ์ ปล่อยให้เป็นการย้อนข้อความตามปกติของเบราว์เซอร์
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) askRedo();
      else askUndo();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDraw, historyLocked, askUndo, askRedo]);

  // ปุ่มล้างจอ — ส่ง action clear_canvas เข้ากระดานทางช่องทางกลางช่องเดียวกับที่วาด
  // (ไม่ได้เรียก painter ตรงๆ เพราะต้องให้มันเก็บลงลิสต์และส่งออกให้คนอื่นด้วย
  //  และต้องให้ server เก็บเป็นการกระทำหนึ่งอัน เพื่อให้กดย้อนกลับได้)
  function handleClear() {
    canvasRef.current?.dispatch(clearBoard());
  }

  return (
    <div className="screen screen--game">
      <Sparkles className="sparkles--page" spots={PAGE_SPARKLES} />
      <header className="topbar">
        <div className="topbar__who">
          {teamMode && myTeam ? (
            // บอกตลอดว่าเราอยู่ทีมไหน ด้วยสีของทีม (และตัวอักษร ไม่พึ่งสีอย่างเดียว)
            <span className={`team-me team-me--${myTeam}`}>คุณอยู่ทีม {myTeam}</span>
          ) : (
            <span className="topbar__label">คนวาด</span>
          )}
          <span className="topbar__name">
            {teamMode && <Icon name="pen" size={16} />} {drawerName}
          </span>
        </div>

        {/* โหมดทีม: คะแนนทีม A–D (ผลรวมสมาชิก จาก room.teamScores) ทีมเราขอบหนากว่า */}
        {teamMode && (
          <div className="team-vs" aria-label="คะแนนทีม">
            {Object.keys(room.teamScores ?? { A: 0, B: 0 }).map((t, i) => (
              <span key={t} className="team-vs__item">
                {i === 1 && <span className="team-vs__sep">vs</span>}
                <span className={`team-vs__chip team-vs__chip--${t}${myTeam === t ? " team-vs__chip--mine" : ""}`}>
                  <span className="team-vs__word">ทีม </span>
                  {t} <b>{room.teamScores?.[t] ?? 0}</b>
                </span>
              </span>
            ))}
          </div>
        )}

        <div className="topbar__meta">
          <span className="topbar__round">
            รอบ {game.roundNo ?? "-"}/{game.totalRounds ?? "-"}
          </span>
          <Timer timeLeft={drawing ? game.timeLeft : null} />
        </div>

        <TopIcons
          onInfo={() => setShowInfo(true)}
          onExit={() => setShowExit(true)}
          shareCode={room.code}
          onToast={onToast}
        />
      </header>

      {/* เรียงตาม DESIGN.md: รายชื่อซ้าย · กระดานกลาง · เครื่องมือขวา
          มือขวาเอื้อมถึงเครื่องมือได้ถนัด (คนส่วนใหญ่ถนัดขวา) และกระดานได้ที่กว้างที่สุด */}
      <main className="game">
        <aside className="game__players">
          <Scoreboard
            players={players}
            drawerId={game.drawerId}
            drawerIds={game.round?.drawerIds ?? null}
            teamScores={teamMode ? room.teamScores ?? { A: 0, B: 0 } : null}
            myTeam={myTeam}
            nextDrawerId={game.round?.nextDrawerId ?? null}
            drawing={drawing}
            guessed={game.guessed}
            meId={meId}
          />
        </aside>

        <section className="game__stage">
          {/* แถบคำ: Mini Challenge (แถบเล็กซ้าย) · คำที่ต้องวาด/คำใบ้ (กลาง ตัวใหญ่) · ปุ่มให้คำใบ้ (ขวา) */}
          <div className="wordbar">
            <div className="wordbar__side">
              <ChallengeBanner challenge={game.round?.challenge} />
            </div>

            {/* คนวาดเห็นคำจริง (ได้จาก your_word) คนอื่นเห็นคำใบ้เป็นขีด */}
            <div className="wordbar__word">
              {isDrawer && game.word ? (
                <span className="topbar__real-word" title="คำที่คุณต้องวาด">
                  {game.word}
                </span>
              ) : game.options ? (
                <span className="topbar__idle">กำลังเลือกคำ...</span>
              ) : game.round ? (
                // คำใบ้ขึ้นช้า: ยังไม่เปิดก็ยังไม่โชว์ช่อง บอกก่อนว่าอีกกี่วิจะได้เห็น
                // (game.hint มาจาก server เท่านั้น — client ไม่เดาช่องเองเด็ดขาด)
                game.hint ? (
                  <HintSlots hint={game.hint} />
                ) : (
                  <span className="topbar__idle">คำใบ้จะขึ้นเมื่อเหลือ {game.hintAt ?? "?"} วิ</span>
                )
              ) : (
                <span className="topbar__idle">—</span>
              )}
            </div>

            {/* ปุ่มเปิดคำใบ้ก่อนเวลา — เห็นเฉพาะคนวาดตอนกำลังวาด และกดได้ครั้งเดียวต่อตา
                ยังไม่เปิด = กดได้ · เปิดแล้ว (game.hint มีค่า) = ปิดปุ่ม ค้างไว้ให้เห็นว่ามีปุ่มนี้อยู่ */}
            <div className="wordbar__side wordbar__side--end">
              {isDrawer && drawing && (
                <button
                  type="button"
                  className="hint-btn"
                  onClick={askHint}
                  disabled={game.hint !== null}
                  title={
                    game.hint !== null
                      ? "ตานี้เปิดคำใบ้ไปแล้ว"
                      : "ให้ทุกคนเห็นช่องคำใบ้ก่อนเวลา (ได้ครั้งเดียวต่อตา)"
                  }
                >
                  <Icon name="bulb" size={20} /> {game.hint !== null ? "เปิดแล้ว" : "คำใบ้"}
                </button>
              )}
            </div>
          </div>

          <Canvas
            ref={canvasRef}
            canDraw={canDraw}
            tool={tool}
            color={drawColor}
            size={size}
            // ทุกอย่างที่วาดบนกระดานของเราออกทางนี้ทางเดียว → useGame ยิงต่อให้ server
            // แล้ว server เป็นคนส่งให้คนอื่น (ไม่ส่งกลับมาหาเรา จึงไม่มีภาพซ้อน)
            onAction={sendAction}
            empty={boardMascot}
            overlay={game.intro ? <ChallengeIntro challenge={game.round?.challenge} /> : null}
            // โหมดทีม: ทีมเราถูกข้ามกลางตา (คนวาดหลุด) — แถบแจ้งบนกระดาน อยู่ใน .board ไม่เพิ่มความสูง
            notice={teamSkipped ? "ตานี้ทีมเราไม่มีคนวาด (คนวาดของทีมหลุด) รอตาหน้านะ" : null}
          />

          {/* แถบเวลาวิ่งลดลงใต้กระดาน (ความสูงนับรวมใน 386px ของ .board แล้ว) */}
          <TimeBar timeLeft={drawing ? game.timeLeft : null} total={game.round?.time ?? null} />

          {/* ใต้กระดาน สองกล่องข้างกัน: คำที่คนทาย กับ เรื่องที่เกิดในห้อง */}
          <div className="game__answers">
            <Chat
              messages={game.messages}
              meId={meId}
              // คนวาดพิมพ์ไม่ได้ระหว่างวาด (server ตัดทิ้งอยู่แล้ว ปิดช่องไปเลยจะได้ชัดเจน)
              disabled={isDrawer && drawing}
              onSend={sendGuess}
              focusKey={game.roundKey} // ขึ้นตาใหม่ = โฟกัสช่องพิมพ์ให้เลย
            />
            <RoomLog messages={game.messages} />
          </div>
        </section>

        {/* เครื่องมืออยู่ขวาเสมอ แม้ตอนไม่ใช่ตาของเรา — แค่จางและกดไม่ได้
            ถ้าซ่อนไปเลย กระดานจะกว้างขึ้นแล้วหดกลับทุกครั้งที่สลับคนวาด ภาพที่วาดไว้จะกระโดด */}
        <aside className="game__tools">
          <Toolbar
            tool={tool}
            color={drawColor}
            size={size}
            onTool={setToolChoice}
            onColor={setColor}
            onSize={setSize}
            onClear={handleClear}
            onUndo={askUndo}
            onRedo={askRedo}
            // ล็อกไว้ที่ 0 ระหว่าง dont_lift_pen ไม่ใช่ปล่อยตาม server
            // (canUndo ที่ค้างจาก canvas_history ตัวสุดท้ายจะยังเป็น true อยู่ ทั้งที่กดไปก็ไม่เกิดอะไร)
            canUndo={game.canUndo && !historyLocked}
            canRedo={game.canRedo && !historyLocked}
            historyLocked={historyLocked}
            lockedColor={colourFix}
            hideBucket={noLift}
            hideShapes={noLift}
            hidePen={shapesOnly}
            locked={!canDraw}
          />
        </aside>
      </main>

      {/* Modal ทั้งสามแบบ ไม่มีทางเปิดพร้อมกัน จึงเขียนเรียงกันได้ */}
      {game.options && (
        <WordChoiceModal options={game.options} secondsLeft={chooseLeft} onChoose={chooseWord} challenge={game.chooseChallenge} />
      )}
      {game.summary && <RoundSummaryModal summary={game.summary} players={players} myTeam={myTeam} meId={meId} />}
      {game.ranking && (
        <GameOverModal
          ranking={game.ranking}
          teamRanking={teamMode ? game.teamRanking : null}
          winner={game.winner}
          myTeam={myTeam}
          meId={meId}
          isHost={room.hostId === meId}
          onPlayAgain={startGame}
          onLeave={onLeave}
        />
      )}

      {/* กล่องจากแถบบน อยู่ท้ายสุดเพื่อให้ซ้อนทับ Modal อื่นได้ถ้าเปิดซ้อนกัน */}
      {showInfo && <InfoModal teamMode={teamMode} onClose={closeInfo} />}
      {showExit && <ExitModal onNo={() => setShowExit(false)} onYes={onLeave} />}
    </div>
  );
}

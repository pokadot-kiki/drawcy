import Modal from "./Modal";
import Mascot from "./Mascot";
import Confetti from "./Confetti";
import YouTag from "./YouTag";
import Avatar from "./Avatar";
import { Icon } from "./Icons";

const MEDALS = ["medal1", "medal2", "medal3"];

// จบเกม — แท่นรางวัลอันดับ 1-3
// หัวห้องมีปุ่มเล่นอีกรอบ (start_game) ทุกคนมีปุ่มกลับหน้าแรก (leave_room)
// players = รายชื่อในห้อง (ไว้หาอวตาร — ranking จาก server มีแค่ id ชื่อ คะแนน)
export default function GameOverModal({ ranking, players = [], isHost, onPlayAgain, onLeave, teamRanking = null, winner = null, myTeam = null, meId = null }) {
  const avatarOf = (id) => players.find((p) => p.id === id)?.avatar ?? 0;
  // โหมดทีม: ประกาศทีมที่ชนะ (เสมอ = winner เป็น null) พลุเล่นเหมือนเดิมเพราะอยู่ในกล่องเดียวกัน
  const teamMode = Boolean(teamRanking);
  const top3 = ranking.slice(0, 3);
  const rest = ranking.slice(3);
  // เรียงให้ที่ 1 อยู่กลาง เวลาตกแต่งด้วย CSS จะได้เหมือนแท่นรางวัลจริง
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);

  return (
    <Modal labelledBy="game-over-title">
      <Mascot mood="trophy" className="mascot--modal" />
      <h2 className="modal__title" id="game-over-title">
        จบเกมแล้ว
      </h2>

      {teamMode && (
        <div className={`team-winner${winner ? ` team-winner--${winner}` : ""}`}>
          <p className="team-winner__title">
            <Icon name={winner ? "trophy" : "users"} size={24} /> {winner ? `ทีม ${winner} ชนะ!` : "เสมอกัน!"}
            {winner && winner === myTeam ? " (ทีมคุณ)" : ""}
          </p>
          <div className="team-vs">
            {teamRanking.map((t) => (
              <span key={t.team} className={`team-vs__chip team-vs__chip--${t.team}`}>
                ทีม {t.team} <b>{t.score}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* พลุพุ่งจากแท่นรางวัล: กล่อง relative ครอบเฉพาะแท่น ให้พลุเริ่มที่แท่นไม่ใช่ที่มุมหน้าต่าง */}
      {teamMode && <p className="modal__note">คะแนนรายคน</p>}
      <div className="podium-stage">
        <Confetti />
        <ol className="podium">
          {podiumOrder.map((p) => {
            const place = top3.indexOf(p);
            return (
              <li className={`podium__item podium__item--${place + 1}${p.playerId === meId ? " podium__item--me" : ""}`} key={p.playerId}>
                <span className="podium__medal"><Icon name={MEDALS[place]} size={34} /></span>
                <Avatar index={avatarOf(p.playerId)} />
                <span className="podium__name">{p.name}</span>
                {p.playerId === meId && <YouTag />}
                <span className="podium__score">{p.score}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {rest.length > 0 && (
        <ul className="gains">
          {rest.map((p, i) => (
            <li className={p.playerId === meId ? "gains__row gains__row--me" : "gains__row"} key={p.playerId}>
              <span className="gains__who">
                {i + 4}. <Avatar index={avatarOf(p.playerId)} /> {p.name}
                {p.playerId === meId && <YouTag />}
              </span>
              <span className="gains__value">{p.score}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="modal__actions">
        {isHost ? (
          <button className="btn btn--primary" type="button" onClick={onPlayAgain}>
            เล่นอีกรอบ
          </button>
        ) : (
          <p className="modal__note">รอหัวห้องกดเล่นอีกรอบ...</p>
        )}
        <button className="btn" type="button" onClick={onLeave}>
          กลับหน้าแรก
        </button>
      </div>
    </Modal>
  );
}

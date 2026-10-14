import Modal from "./Modal";
import Mascot from "./Mascot";
import YouTag from "./YouTag";
import Avatar from "./Avatar";

// สรุปจบตา — เฉลยคำ + คะแนนที่แต่ละคนได้ในตานี้
// results จาก server มีแค่ { playerId, gained } ต้องไปหาชื่อจากรายชื่อผู้เล่นเอง
export default function RoundSummaryModal({ summary, players, myTeam = null, meId = null }) {
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? "?";
  const avatarOf = (id) => players.find((p) => p.id === id)?.avatar ?? 0; // ไม่อยู่ในห้องแล้ว = อวตารตัวแรก
  const gains = summary.results ?? [];

  return (
    <Modal labelledBy="round-end-title">
      {/* ไม่มีใครทายถูก = มาสคอตตกใจ · มีคนทายถูก = ดีใจ */}
      <Mascot mood={gains.length === 0 ? "shock" : "happy"} className="mascot--modal" />
      <h2 className="modal__title" id="round-end-title">
        เฉลยคำตอบ
      </h2>
      <p className="answer">{summary.word}</p>

      {/* โหมดทีม: ทีมไหนทายถูกก่อน (ได้โบนัส +100) และคะแนนที่แต่ละทีมได้ตานี้ */}
      {summary.teamGained && (
        <div className="team-result">
          <p className="team-result__first">
            {summary.firstTeam
              ? `ทีม ${summary.firstTeam}${summary.firstTeam === myTeam ? " (ทีมคุณ)" : ""} ทายถูกก่อน! โบนัส +100 ต่อคน`
              : "ตานี้ไม่มีทีมไหนทายถูก"}
          </p>
          <div className="team-vs">
            {Object.keys(summary.teamGained).map((t) => (
              <span key={t} className={`team-vs__chip team-vs__chip--${t}`}>
                ทีม {t} <b>+{summary.teamGained[t] ?? 0}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {gains.length === 0 ? (
        <p className="modal__note">ตานี้ไม่มีใครทายถูก</p>
      ) : (
        <ul className="gains">
          {gains.map((g) => (
            <li className={g.playerId === meId ? "gains__row gains__row--me" : "gains__row"} key={g.playerId}>
              <span className="gains__who">
                <Avatar index={avatarOf(g.playerId)} />
                {nameOf(g.playerId)}
                {g.playerId === meId && <YouTag />}
              </span>
              <span className="gains__value">+{g.gained}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="modal__note">ตาต่อไปกำลังจะเริ่ม...</p>
    </Modal>
  );
}

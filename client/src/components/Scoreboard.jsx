import Avatar from "./Avatar";
import AnimatedNumber from "./AnimatedNumber";
import YouTag from "./YouTag";
import { Icon } from "./Icons";

// แถบคะแนน — เรียงจากคะแนนมากไปน้อย
// มงกุฎ = หัวห้อง  ดินสอ = คนวาดตานี้  ติ๊ก = คนที่ทายถูกแล้ว (พื้นเขียวอ่อน)
//
// ที่มาของ guessed มีสองทาง รวมกันแล้วได้ครบทุกกรณี
//   1) อยู่ในห้องตั้งแต่ต้นตา — สะสมเองจาก event correct_guess (ผูกไว้ใน useGame)
//   2) เข้าห้องกลางตา — server แนบ guessedIds มาให้ใน round_start (ข้อ 4 แก้งานค้างของข้อ 2)
// ทางที่ 2 ส่งมาแค่ id ไม่ส่งคำตอบ จึงไม่ทำให้ใครรู้คำก่อนทายถูก
//
// ป้ายสถานะใต้ชื่อ (ข้อความล้วน ไม่ใช่แค่ไอคอน — อ่านง่ายบนจอเล็ก/ไอแพด)
//   หัวห้อง · กำลังวาด · วาดคนถัดไป
// "กำลังวาด/วาดคนถัดไป" โชว์เฉพาะตอนกำลังวาด (drawing) เพราะระหว่างพักตา drawerId ยังเป็นคนเก่าค้างอยู่
// nextDrawerId มาจาก server (round_start) client เดาไม่ได้ · เช็คว่ายังอยู่ในห้องก่อนโชว์ เพราะอาจออกไประหว่างตา
//
// โหมดทีม (teamScores มีค่า): จัดกลุ่มตามทีม A / B หัวกลุ่มบอกคะแนนทีม (ผลรวมสมาชิก) · ในทีมเรียงตามคะแนนเหมือนเดิม
// หมายเหตุ: ใน round_start ของโหมดทีม drawerId/nextDrawerId เป็นของ "ทีมเรา" เท่านั้น
//   ป้าย ✏️ ของทีมอื่นจึงอาศัย drawerIds (คนวาดของทั้งสองทีม) ซึ่ง server ส่งมาให้
export default function Scoreboard({
  players,
  drawerId,
  drawerIds = null,
  nextDrawerId = null,
  drawing = false,
  guessed = [],
  meId,
  teamScores = null,
  myTeam = null,
}) {
  const byScore = (list) => [...list].sort((a, b) => b.score - a.score);
  const drawerSet = new Set([drawerId, ...(drawerIds ? Object.values(drawerIds) : [])].filter(Boolean));

  if (teamScores) {
    return (
      <div className="score-teams">
        {Object.keys(teamScores).map((t) => (
          <section className={`score-team score-team--${t}`} key={t} aria-label={`ทีม ${t}`}>
            <h3 className="score-team__head">
              <span>
                ทีม {t}
                {myTeam === t ? " (ทีมคุณ)" : ""}
              </span>
              <span className="score-team__total">
                <AnimatedNumber value={teamScores[t] ?? 0} />
              </span>
            </h3>
            {renderList(byScore(players.filter((p) => p.team === t)))}
          </section>
        ))}
      </div>
    );
  }
  return renderList(byScore(players));

  function renderList(sorted) {
  return (
    <ul className="score-list">
      {sorted.map((p) => {
        const isDrawer = drawerSet.has(p.id);
        const hasGuessed = guessed.includes(p.id);
        const isNext = drawing && !isDrawer && nextDrawerId === p.id;
        const tags = [];
        if (p.isHost) tags.push(["host", "crown", "หัวห้อง"]);
        if (drawing && isDrawer) tags.push(["drawing", "pen", "กำลังวาด"]);
        if (isNext) tags.push(["next", "skip", "วาดคนถัดไป"]);
        const classes = ["score-row"];
        if (isDrawer) classes.push("score-row--drawer");
        if (hasGuessed) classes.push("score-row--guessed");
        if (p.id === meId) classes.push("score-row--me");
        if (p.connected === false) classes.push("score-row--away"); // หลุดอยู่ (server รอให้กลับมา 30 วิ)

        return (
          <li className={classes.join(" ")} key={p.id}>
            {/* แถวทุกแถวเรียงเหมือนกันเป๊ะ: อวตาร (ติ๊กทายถูกทับมุมอวตาร) · ชื่อ + ป้าย · คะแนนใหญ่ชิดขวา */}
            <span className="score-row__avatar">
              <Avatar index={p.avatar} large />
              {hasGuessed && (
                <span className="score-row__check" title="ทายถูกแล้ว">
                  <Icon name="check" size={12} label="ทายถูกแล้ว" />
                </span>
              )}
            </span>
            <span className="score-row__main">
              <span className="score-row__name">{p.name}</span>
              {p.connected === false && <span className="score-row__away">หลุด กำลังรอ...</span>}
              <span className="score-row__tags">
                {p.id === meId && <YouTag />}
                {tags.map(([kind, icon, text]) => (
                  // หัวห้อง/กำลังวาดโชว์แค่ไอคอน (ที่ในแถวมีจำกัด มี tooltip บอกชื่อ) ป้ายวาดคนถัดไปมีข้อความ
                  <span className={`tag tag--${kind}`} key={kind} title={text}>
                    <Icon name={icon} size={13} />
                    {kind === "next" && ` ${text}`}
                  </span>
                ))}
              </span>
            </span>
            <span className="score-row__score">
              <AnimatedNumber value={p.score} />
            </span>
          </li>
        );
      })}
    </ul>
  );
  }
}

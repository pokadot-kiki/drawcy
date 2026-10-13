// จัดทีมให้สมดุล (โหมดทีม 2–4 ทีม) — ฟังก์ชันล้วน ไม่ผูกกับ socket/ห้อง เพื่อให้ทดสอบตรง ๆ ได้ (เหมือน clean.js / leaderboard.js)
// ใช้โดย server/index.js (เหตุการณ์ balance_teams · เปิดโหมดทีม · เปลี่ยนจำนวนทีม · เล่นอีกรอบหลังจบเกม)

// ชื่อทีมทั้งหมดที่เป็นไปได้ · ห้องที่เล่น N ทีมใช้ N ตัวแรก (2 ทีม = A B · 4 ทีม = A B C D)
const TEAM_IDS = ["A", "B", "C", "D"];

// players = [{ id, score }] → คืน Map(id → "A" | "B" | ...)
// เป้าหมายสองข้อ ตามลำดับ:
//   (1) จำนวนคนทุกทีมต่างกันไม่เกิน 1 (เช่น 5 คน 2 ทีม = 3+2 · 7 คน 3 ทีม = 3+2+2) — ห้ามเกิด 2 vs 4
//   (2) คะแนนรวมของทีมใกล้กันที่สุดเท่าที่ทำได้
// วิธี: เรียงจากคะแนนมากไปน้อย แล้วจัดทีละคนเข้า "ทีมที่ตอนนี้คนน้อยที่สุด" (ข้อ 1 รับประกันเอง)
//       ถ้ามีหลายทีมคนเท่ากัน → เลือกทีมที่คะแนนรวมต่ำสุด · ยังเท่ากันอีก → สุ่ม (หรือเรียงตามชื่อทีมถ้า shuffle: false)
// shuffle: true (ค่าเริ่มต้น) = คนที่คะแนนเท่ากันสุ่มลำดับก่อน → เกมแรกที่ทุกคน 0 คะแนน = สุ่มแบ่งเท่า ๆ กัน และกดจัดใหม่ได้ผลต่างกัน
// shuffle: false = คงลำดับเดิมของผู้เล่น (ใช้ตอนเปิดโหมดทีมครั้งแรก: หัวห้องได้ทีม A, คนถัดไป B, C, A, B...)
function computeBalancedTeams(players, { teams = 2, shuffle = true, random = Math.random } = {}) {
  const ids = TEAM_IDS.slice(0, Math.min(Math.max(teams, 1), TEAM_IDS.length));
  const order = [...players];
  if (shuffle) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  order.sort((x, y) => (y.score || 0) - (x.score || 0)); // sort เสถียร → คะแนนเท่ากันยังเรียงตามลำดับที่ได้มา
  const st = Object.fromEntries(ids.map((t) => [t, { n: 0, sum: 0 }]));
  const out = new Map();
  for (const p of order) {
    const minN = Math.min(...ids.map((t) => st[t].n));
    const pool = ids.filter((t) => st[t].n === minN); // ทีมที่คนน้อยที่สุดตอนนี้
    const minSum = Math.min(...pool.map((t) => st[t].sum));
    const ties = pool.filter((t) => st[t].sum === minSum);
    const t = shuffle ? ties[Math.floor(random() * ties.length)] : ties[0];
    st[t].n++;
    st[t].sum += p.score || 0;
    out.set(p.id, t);
  }
  return out;
}

module.exports = { TEAM_IDS, computeBalancedTeams };

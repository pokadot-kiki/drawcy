// แปลรหัส error จาก server เป็นข้อความไทย ตามตารางใน DESIGN.md
// ใช้ทั้งกับ error จาก callback (create_room, join_room) และ event game_error
const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: "ไม่พบห้องนี้ ลองเช็ครหัสอีกที",
  ROOM_FULL: "ห้องเต็มแล้ว",
  TEAM_FULL: "ทีมนั้นเต็มแล้ว ย้ายเข้าไม่ได้",
  TEAMS_UNBALANCED: "ทีมจำนวนคนต่างกันเกิน 1 คน กด \"จัดทีมให้สมดุล\" ก่อนเริ่มเกม",
  NAME_TAKEN: "มีคนใช้ชื่อนี้ในห้องแล้ว",
  NAME_OWNED: "ชื่อนี้มีเจ้าของแล้ว ลองชื่ออื่นนะ",
  NAME_NOT_ALLOWED: "ชื่อนี้ไม่เหมาะสม ลองชื่ออื่นนะ",
  INVALID_NAME: "กรุณาใส่ชื่อ",
  NOT_IN_ROOM: "คุณไม่ได้อยู่ในห้องนี้แล้ว ลองเข้าห้องใหม่อีกครั้ง",
  TOO_MANY_ATTEMPTS: "ลองเข้าห้องถี่เกินไป รอสักครู่แล้วลองใหม่",
  SERVER_ERROR: "เกิดข้อผิดพลาดชั่วคราว ลองใหม่อีกครั้ง",
  NOT_HOST: "เฉพาะหัวห้องเท่านั้น",
  NOT_ENOUGH_PLAYERS: "ต้องมีผู้เล่นอย่างน้อย 2 คน",
  NOT_YOUR_TURN: "ยังไม่ถึงตาคุณวาด", // รหัสนี้อยู่ใน events.md (DESIGN.md ไม่ได้เขียนไว้) จะได้ใช้ตอนข้อ 4
  AI_UNAVAILABLE: "AI ไม่ว่าง ลองใหม่อีกครั้ง",

  // รหัสนี้ฝั่ง client ใช้เอง ไม่ได้มาจาก server (server ไม่เคยส่งรหัสนี้)
  // ใช้ตอนยิงคำขอแล้ว server ไม่ตอบ เช่น ลืมเปิด server
  CONNECT_FAILED: "ต่อ server ไม่ได้ ลองใหม่อีกครั้ง",
};

export function errorText(code) {
  return ERROR_MESSAGES[code] ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
}

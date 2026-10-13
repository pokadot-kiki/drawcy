import { useState } from "react";
import { socket } from "../socket";
import { withSuffix } from "../playerName";
import { nameOwnerKey } from "../nameOwnerKey";

// สร้างห้อง / เข้าห้อง ผ่าน socket (ใช้ร่วมกันระหว่างหน้า SET UP กับกล่องใส่รหัสห้อง)
// ฝั่งนี้แค่ช่วยให้ใช้ง่าย ของจริง server เป็นคนตรวจซ้ำเสมอ (server-authoritative)
export function useEnterRoom({ connected, onEntered, onError }) {
  const [busy, setBusy] = useState(false);

  // event = "create_room" | "join_room" · payload ตามหน้าตาใน events.md §1
  function enter(event, payload, { name, avatar }, retried = false) {
    if (!retried && (busy || !connected)) return;
    setBusy(true);

    // กันตอบซ้ำ: ถ้า server ไม่ตอบใน 6 วิ (เช่นลืมเปิด server) ให้ปลดล็อกปุ่มแล้วบอกผู้ใช้
    let answered = false;
    const finish = (fn) => {
      if (answered) return;
      answered = true;
      setBusy(false);
      fn();
    };

    const request = { ...payload, nameOwnerKey: nameOwnerKey() };
    socket.timeout(6000).emit(event, request, (err, res) => {
      if (err) return finish(() => onError("CONNECT_FAILED"));
      // ชื่อซ้ำในห้อง (เข้าห้อง): ต่อเลขสุ่มท้ายชื่อแล้วลองเข้าใหม่ให้เองหนึ่งครั้ง ผู้เล่นไม่ต้องทำอะไร
      if (res?.error === "NAME_TAKEN" && event === "join_room" && !retried) {
        answered = true;
        const next = withSuffix(request.name);
        return enter(event, { ...payload, name: next }, { name: next, avatar }, true);
      }
      if (!res?.ok) return finish(() => onError(res?.error));
      // join_room ไม่ได้ส่ง code กลับมา เราใช้รหัสที่ผู้ใช้พิมพ์เอง
      finish(() => onEntered({ playerId: res.playerId, code: res.code ?? payload.code, name, avatar }));
    });
  }

  return { busy, enter };
}

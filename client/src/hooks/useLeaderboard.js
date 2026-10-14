import { useEffect, useState } from "react";

// ดึงอันดับ "เดือนนี้" จาก GET /api/leaderboard — ใช้ร่วมกันทั้งกล่องในหน้าแรกและหน้า Leaderboard
// server เป็นคนเลือกเดือน (เวลาไทย) แล้วส่ง month กลับมา ฝั่งนี้ไม่คิดเดือนเอง (นาฬิกา/เขตเวลาเครื่องอาจไม่ตรง)
// ขอใหม่ทุกครั้งที่เปลี่ยนแท็บ หรือคอมโพเนนต์ถูกสร้างใหม่ (เช่นกลับมาหน้าแรก) จึงเห็นคะแนนล่าสุดเสมอ
// board = "solo" (แข่งกับ AI) | "multi" (เล่นกับเพื่อน) — สองกระดานแยกกันที่ server
export function useLeaderboard(board = "solo") {
  const [state, setState] = useState({ status: "loading", top: [], month: null }); // loading | ready | error
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    // สลับแท็บเร็วๆ คำขอเก่าอาจตอบมาทีหลังแล้วทับของใหม่ → ยกเลิกคำขอเก่าทิ้งทุกครั้ง
    const controller = new AbortController();
    setState((s) => ({ ...s, status: "loading" }));

    fetch(`/api/leaderboard?board=${board}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setState({
        status: "ready",
        top: Array.isArray(data?.top) ? data.top : [],
        month: typeof data?.month === "string" ? data.month : null,
      }))
      .catch((err) => {
        if (err.name !== "AbortError") setState((s) => ({ ...s, status: "error", top: [] }));
      });

    return () => controller.abort();
  }, [board, retryKey]);

  return { ...state, retry: () => setRetryKey((n) => n + 1) };
}

const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

// "2026-10" → "ตุลาคม" (ชื่อเดือนอย่างเดียว ไม่มีปี) · ค่าเพี้ยน/ยังไม่โหลด → ""
export function thaiMonthName(month) {
  const m = Number(String(month ?? "").split("-")[1]);
  return THAI_MONTHS[m - 1] ?? "";
}

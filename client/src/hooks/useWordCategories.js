import { useEffect, useState } from "react";
import { CATEGORY_FALLBACK } from "../roomOptions";

// ดึงรายการ "หมวดหมู่คำ" + จำนวนคำต่อหมวดจาก GET /api/word-categories (HTTP เหมือน leaderboard/rooms)
// bank = "room" (โหมดเล่นกับเพื่อน · words.json) | "solo" (แข่งกับ AI · ai-words.json)
// server เป็นเจ้าของรายการและตัวเลขทั้งหมด ที่นี่แค่เอามาโชว์ — ชื่อที่ server ไม่รู้จักถูกเมินตอนตั้งค่าเสมอ
// ดึงไม่สำเร็จ = ยังเลือกหมวดได้ด้วยรายการสำรอง (แต่ไม่โชว์จำนวนคำ และไม่เตือนเรื่องคำไม่พอ)
export function useWordCategories(bank = "room") {
  const [state, setState] = useState(() => fallbackState(bank));

  useEffect(() => {
    const controller = new AbortController();
    setState(fallbackState(bank));
    fetch(`/api/word-categories?bank=${bank}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) =>
        setState({
          status: "ready",
          categories: Array.isArray(data?.categories) && data.categories.length > 0 ? data.categories : fallbackState(bank).categories,
          perTurn: Number.isInteger(data?.perTurn) ? data.perTurn : 3,
        })
      )
      .catch((err) => {
        if (err.name !== "AbortError") setState(fallbackState(bank));
      });
    return () => controller.abort();
  }, [bank]);

  return state;
}

function fallbackState(bank) {
  return {
    status: "fallback",
    // ยังไม่รู้จำนวนคำ (counts/total = null) → กล่องเตือนจะไม่คิดเลขให้ผู้ใช้เห็นผิดๆ
    categories: CATEGORY_FALLBACK.map((name) => ({ name, counts: null, total: null })),
    perTurn: 3,
    bank,
  };
}

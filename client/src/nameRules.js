import rules from "../../shared/name-rules.json";

// ใช้กติกาเดียวกับ server เพื่อเตือนทันที แต่ server ยังตรวจซ้ำทุกครั้ง
export function normalizeNameForCheck(name) {
  const mapped = String(name ?? "").toLocaleLowerCase("th")
    .replace(/[0134@5$!7]/g, (char) => ({ 0: "o", 1: "i", 3: "e", 4: "a", "@": "a", 5: "s", $: "s", "!": "i", 7: "t" })[char] || char)
    .replace(/([\u0e31-\u0e4e\p{M}])\1+/gu, "$1")
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
  return [...mapped].filter((char, i, chars) => char !== chars[i - 1]).join("");
}

export function isNameAllowed(name) {
  const normalized = normalizeNameForCheck(name);
  if (!normalized || rules.safeOverlaps.includes(normalized)) return true;
  return !rules.offensive.some((word) => normalized.includes(word));
}

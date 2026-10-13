const crypto = require("crypto");

// Salt คงที่ช่วยแยก hash ชื่อเจ้าของออกจาก hash ประเภทอื่น
const OWNER_SALT = process.env.NAME_OWNER_SALT || "drawcy-name-owner-v1";
const OWNER_KEY_RE = /^[a-f0-9]{32,128}$/i;

function normalizeOwnerName(name) {
  return String(name ?? "").trim().toLocaleLowerCase("th");
}

function hashOwnerKey(key) {
  if (typeof key !== "string" || !OWNER_KEY_RE.test(key)) return null;
  return crypto.createHash("sha256").update(`${OWNER_SALT}:${key.toLowerCase()}`).digest("hex");
}

function ownerOfName(rows, name) {
  const normalized = normalizeOwnerName(name);
  return rows.find((row) => normalizeOwnerName(row?.name) === normalized && typeof row?.ownerHash === "string")?.ownerHash ?? null;
}

function canUseName(rows, name, key) {
  const ownerHash = ownerOfName(rows, name);
  return !ownerHash || (hashOwnerKey(key) !== null && hashOwnerKey(key) === ownerHash);
}

module.exports = { OWNER_KEY_RE, normalizeOwnerName, hashOwnerKey, ownerOfName, canUseName };

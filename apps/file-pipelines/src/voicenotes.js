// Helpers for the `voicenotes` method: clips are grouped by a date extracted
// from their file name. The scheme is user-defined per folder via `datePattern`
// (e.g. WhatsApp push-to-talk clips are `PTT-YYYYMMDD-WA####.<ext>` inside
// per-chat subdirectories). Same-day clips in the same directory are
// concatenated (with a short tone between them) into one merged file.

const regexCache = new Map();

export function datePatternRegex(pattern) {
  if (!pattern) return null;
  let regex = regexCache.get(pattern);
  if (!regex) {
    regex = new RegExp(pattern);
    regexCache.set(pattern, regex);
  }
  return regex;
}

// All capture groups (or the whole match when there are none) are joined and
// normalized by stripping non-digits; the result must be a YYYYMMDD date. So
// both `(\d{8})` and `(\d{4})-(\d{2})-(\d{2})` work.
export function voiceNoteDateOf(baseName, pattern) {
  const regex = datePatternRegex(pattern);
  if (!regex) return null;
  const match = regex.exec(baseName);
  if (!match) return null;
  const groups = match.slice(1).filter((part) => part !== undefined && part !== null && part !== "");
  const raw = String(groups.length > 0 ? groups.join("") : match[0]).replace(/\D+/g, "");
  return /^\d{8}$/.test(raw) ? raw : null;
}

// Splits a store key ("<chat>/<file>", chat possibly empty) into chat + date.
export function voiceNoteGroupOf(relName, pattern) {
  const posix = String(relName).split("\\").join("/");
  const slash = posix.lastIndexOf("/");
  const chat = slash === -1 ? "" : posix.slice(0, slash);
  const base = slash === -1 ? posix : posix.slice(slash + 1);
  const date = voiceNoteDateOf(base, pattern);
  if (!date) return null;
  return { chat, date };
}

export function sanitizeChat(chat) {
  const cleaned = String(chat ?? "").replace(/[^A-Za-z0-9 ._-]+/g, "_").trim();
  return cleaned;
}

// The final (standardized) name a merged group gets, with the chat id embedded
// so flat destinations can't collide across chats on the same day.
export function voiceNoteDestName(chat, date) {
  const safeChat = sanitizeChat(chat);
  const ymd = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const base = safeChat ? `${date}-merged-${safeChat}` : `${date}-merged`;
  return `${ymd}-00-00-00-(${base}).mp4`;
}

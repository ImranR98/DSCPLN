// Schedules for pipeline folders: the same shape the D$CPLN shell apps use —
// `enabled`, `days` (0 = Sunday … 6 = Saturday; empty = every day),
// `at` ("HH:MM") and `catchUp` (run a missed occurrence when the daemon
// starts after it, instead of waiting for the next one).

export const DEFAULT_SCHEDULE = { enabled: false, days: [], at: "03:00", catchUp: true };

// Windows a non-catch-up schedule may fire late (the daemon ticks every 30s;
// a missed window means the machine was off, so the run is skipped).
const CATCH_UP_WINDOW_MS = 5 * 60 * 1000;

export function normalizeSchedule(raw) {
  const schedule = { ...DEFAULT_SCHEDULE, ...(raw ?? {}) };
  schedule.enabled = Boolean(schedule.enabled);
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  schedule.days = [...new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(schedule.at ?? "").trim());
  const hours = match ? Number(match[1]) : NaN;
  const minutes = match ? Number(match[2]) : NaN;
  schedule.at =
    Number.isInteger(hours) && hours >= 0 && hours <= 23 && Number.isInteger(minutes) && minutes >= 0 && minutes <= 59
      ? `${String(hours).padStart(2, "0")}:${match[2]}`
      : DEFAULT_SCHEDULE.at;
  schedule.catchUp = schedule.catchUp !== false;
  return schedule;
}

function atTime(day, at) {
  const [hours, minutes] = at.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
}

function dayEnabled(schedule, date) {
  return schedule.days.length === 0 || schedule.days.includes(date.getDay());
}

// The most recent occurrence at or before `now`.
export function previousRunAt(schedule, now = new Date()) {
  if (!schedule.enabled) return null;
  for (let back = 0; back <= 7; back += 1) {
    const time = atTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back), schedule.at);
    if (time > now) continue;
    if (dayEnabled(schedule, time)) return time;
  }
  return null;
}

// The next occurrence after `now`.
export function nextRunAt(schedule, now = new Date()) {
  if (!schedule.enabled) return null;
  for (let ahead = 0; ahead <= 8; ahead += 1) {
    const time = atTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead), schedule.at);
    if (time <= now) continue;
    if (dayEnabled(schedule, time)) return time;
  }
  return null;
}

// Whether the schedule has an occurrence the last run has not covered yet.
export function isDue(schedule, lastRunAtMs, now = new Date()) {
  if (!schedule.enabled) return false;
  const occurrence = previousRunAt(schedule, now);
  if (!occurrence) return false;
  if (lastRunAtMs && lastRunAtMs >= occurrence.getTime()) return false;
  if (!schedule.catchUp && now.getTime() - occurrence.getTime() > CATCH_UP_WINDOW_MS) return false;
  return true;
}

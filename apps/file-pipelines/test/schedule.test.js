import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSchedule, previousRunAt, nextRunAt, isDue } from "../src/schedule.js";

const at = (year, month, day, hours, minutes) => new Date(year, month - 1, day, hours, minutes, 0, 0);

test("schedule: normalization keeps only valid days/times", () => {
  const schedule = normalizeSchedule({ enabled: true, days: [3, 1, 3, 9, -1, 1.5], at: "7:05", catchUp: false });
  assert.deepEqual(schedule, { enabled: true, days: [1, 3], at: "07:05", catchUp: false });
  assert.deepEqual(normalizeSchedule({ at: "25:99" }).at, "03:00");
  assert.deepEqual(normalizeSchedule(null), { enabled: false, days: [], at: "03:00", catchUp: true });
});

test("schedule: previous and next occurrences respect enabled days", () => {
  const everyDay = normalizeSchedule({ enabled: true, at: "03:00" });
  const wednesday = at(2026, 10, 14, 2, 0); // Wednesday
  assert.deepEqual(nextRunAt(everyDay, wednesday), at(2026, 10, 14, 3, 0));
  assert.deepEqual(previousRunAt(everyDay, wednesday), at(2026, 10, 13, 3, 0));

  const mondays = normalizeSchedule({ enabled: true, days: [1], at: "03:00" });
  assert.deepEqual(nextRunAt(mondays, wednesday), at(2026, 10, 19, 3, 0));
  assert.deepEqual(previousRunAt(mondays, wednesday), at(2026, 10, 12, 3, 0));
});

test("schedule: isDue covers catch-up behaviour", () => {
  const schedule = normalizeSchedule({ enabled: true, at: "03:00", catchUp: true });
  const now = at(2026, 10, 14, 9, 0);
  assert.equal(isDue(schedule, 0, now), true);
  assert.equal(isDue(schedule, at(2026, 10, 14, 3, 0).getTime(), now), false);
  assert.equal(isDue(schedule, at(2026, 10, 13, 3, 0).getTime(), now), true);

  const strict = normalizeSchedule({ enabled: true, at: "03:00", catchUp: false });
  assert.equal(isDue(strict, 0, now), false);
  assert.equal(isDue(strict, 0, at(2026, 10, 14, 3, 2)), true);
  assert.equal(isDue(normalizeSchedule({ enabled: false }), 0, now), false);
});

import { Scheduler } from "../src/scheduler.js";

test("scheduler: seeds first sight, then runs due schedules", async () => {
  const runs = [];
  const folder = {
    def: {
      name: "wine",
      method: "copy",
      snapshot: true,
      schedule: { enabled: true, days: [], at: "03:00", catchUp: true },
    },
  };
  const ctx = {
    config: { paused: false },
    store: { getFolder: () => folder, listFolders: () => [folder] },
    snapshot: { run: async (name, opts) => runs.push({ name, opts }), lastRunAt: () => 0 },
    log: () => {},
  };
  const scheduler = new Scheduler(ctx, { historyFile: "/tmp/does-not-exist.json" });

  await scheduler.tick(); // seeds, no run
  assert.equal(runs.length, 0);
  assert.ok(scheduler.history.wine > 0);

  scheduler.history.wine = at(2026, 10, 13, 3, 0).getTime(); // yesterday's run
  const realDate = Date;
  globalThis.Date = class extends realDate {
    constructor(...args) {
      super(...(args.length ? args : [2026, 9, 14, 9, 0, 0]));
    }
    static now() {
      return new realDate(2026, 9, 14, 9, 0, 0).getTime();
    }
  };
  try {
    await scheduler.tick();
  } finally {
    globalThis.Date = realDate;
  }
  assert.deepEqual(runs, [{ name: "wine", opts: { trigger: "schedule" } }]);
});

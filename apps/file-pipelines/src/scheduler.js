// Scheduled snapshot runs: ticks every 30s and fires snapshot copy folders
// whose schedule has an uncovered occurrence. The last-run times persist next
// to the config so catch-up works across daemon restarts.

import fsp from "node:fs/promises";
import { atomicWriteFile, pathExists } from "./util.js";
import { isDue, nextRunAt } from "./schedule.js";
import { isSnapshotFolder } from "./snapshot.js";

const TICK_MS = 30_000;

export class Scheduler {
  constructor(ctx, { historyFile }) {
    this.ctx = ctx;
    this.historyFile = historyFile;
    this.history = {};
    this.timer = null;
  }

  async init() {
    if (await pathExists(this.historyFile)) {
      try {
        this.history = JSON.parse(await fsp.readFile(this.historyFile, "utf8"));
      } catch {
        this.history = {};
      }
    }
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
    this.timer.unref?.();
    this.tick().catch(() => {});
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  lastRunAt(folderName) {
    return Math.max(this.history[folderName] ?? 0, this.ctx.snapshot?.lastRunAt(folderName) ?? 0);
  }

  nextRun(folderName) {
    const folder = this.ctx.store.getFolder(folderName);
    if (!folder || !isSnapshotFolder(folder.def)) return null;
    return nextRunAt(folder.def.schedule, new Date())?.getTime() ?? null;
  }

  async tick() {
    const now = new Date();
    for (const folder of this.ctx.store.listFolders()) {
      const def = folder.def;
      if (!isSnapshotFolder(def) || !def.schedule.enabled) continue;
      if (this.ctx.config.paused) continue;
      // Seed first sight so a fresh config (or a newly added folder) waits for
      // its next scheduled time instead of catching up from the epoch.
      if (!(def.name in this.history)) {
        this.history[def.name] = now.getTime();
        await this.#save();
        continue;
      }
      if (!isDue(def.schedule, this.lastRunAt(def.name), now)) continue;
      await this.ctx.snapshot.run(def.name, { trigger: "schedule" });
      this.history[def.name] = Date.now();
      await this.#save();
    }
  }

  async #save() {
    try {
      await atomicWriteFile(this.historyFile, JSON.stringify(this.history, null, 2) + "\n");
    } catch {
      // best-effort: the in-memory history still drives this process
    }
  }
}

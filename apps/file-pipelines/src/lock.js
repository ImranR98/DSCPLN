import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteFile, pathExists } from "./util.js";

export class SyncLock {
  constructor(config, log) {
    this.file = config.syncLockFile;
    this.heartbeatMs = config.lockHeartbeatSeconds * 1000;
    this.staleMs = config.lockStaleSeconds * 1000;
    this.host = os.hostname();
    this.log = log;
    this.timer = null;
    this.held = false;
  }

  async acquire({ force = false } = {}) {
    if (await pathExists(this.file)) {
      try {
        const data = JSON.parse(await fsp.readFile(this.file, "utf8"));
        const age = Date.now() - Number(data.at ?? 0);
        if (!force && data.host !== this.host && age < this.staleMs) {
          throw new Error(
            `another File Pipelines instance appears to be running on ${data.host} (heartbeat ${Math.round(age / 1000)}s old) — refusing to start`,
          );
        }
        if (data.host === this.host && data.pid !== process.pid && age < this.staleMs) {
          try {
            process.kill(data.pid, 0);
            throw new Error(`another File Pipelines process (pid ${data.pid}) is running on this host — refusing to start`);
          } catch (err) {
            if (err.message?.includes("refusing")) throw err;
          }
        }
      } catch (err) {
        if (err.message?.includes("refusing")) throw err;
      }
    }
    await this.#write();
    this.held = true;
    this.timer = setInterval(() => this.#write().catch(() => {}), this.heartbeatMs);
    this.timer.unref?.();
  }

  async #write() {
    await atomicWriteFile(this.file, JSON.stringify({ host: this.host, pid: process.pid, at: Date.now() }) + "\n");
  }

  async release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.held) return;
    this.held = false;
    try {
      const data = JSON.parse(await fsp.readFile(this.file, "utf8"));
      if (data.host === this.host && data.pid === process.pid) {
        await fsp.unlink(this.file);
      }
    } catch {
      // best effort
    }
  }
}

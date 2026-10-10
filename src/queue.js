import { processCopy } from "./processors/copy.js";
import { processSnapBatch } from "./processors/snapchat.js";
import { processStandardize } from "./processors/standardize.js";
import { STATUS } from "./store.js";
import { matchesPattern } from "./util.js";

const RETRYABLE = new Set(["changed", "verify", "concat", "tool"]);

function backoffMs(attempts) {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

export class Queue {
  constructor(ctx) {
    this.ctx = ctx;
    this.active = new Set();
    this.running = 0;
    this.timer = null;
    this.ticking = false;
  }

  start() {
    this.timer = setInterval(() => this.tick(), 5000);
    this.timer.unref?.();
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  #retryEligible(file, now) {
    if (!RETRYABLE.has(file.errorKind)) return false;
    if ((file.attempts ?? 0) > this.ctx.config.maxAutoRetries) return false;
    return now >= (file.nextRetryAt ?? 0);
  }

  #fileDispatchable(file, now) {
    if (file.status === STATUS.PENDING) return Boolean(file.forceNow) || now >= (file.nextRetryAt ?? 0);
    if (file.status === STATUS.ERROR) return Boolean(file.forceNow) || this.#retryEligible(file, now);
    return false;
  }

  #snapCandidates(folder, now = Date.now()) {
    const files = [];
    for (const file of folder.files.values()) {
      if (folder.def.filePattern && !matchesPattern(file.name, folder.def.filePattern)) continue;
      if (file.status === STATUS.PENDING) {
        if (file.forceNow || now >= (file.nextRetryAt ?? 0)) files.push(file);
      } else if (file.status === STATUS.ERROR) {
        if (file.forceNow || this.#retryEligible(file, now)) files.push(file);
      }
    }
    return files;
  }

  #snapReady(folder, candidates, now) {
    if (candidates.length === 0) return false;
    if (candidates.some((f) => f.forceNow)) return true;
    const settleMs = (folder.def.settleSeconds ?? 0) * 1000;
    const latest = Math.max(folder.lastEventAt, ...candidates.map((f) => f.mtimeMs));
    return now >= latest + settleMs;
  }

  async tick() {
    const { store, config } = this.ctx;
    if (this.ticking) return;
    this.ticking = true;
    try {
      const paused = config.paused;
      for (const folder of store.listFolders()) {
        if (this.running >= config.concurrency) break;
        if (this.active.has(folder.def.name)) continue;
        if (!folder.exists) continue;
        const now = Date.now();
        if (folder.def.method === "snapchat") {
          let candidates = this.#snapCandidates(folder, now);
          if (paused) candidates = candidates.filter((f) => f.forceNow);
          if (this.#snapReady(folder, candidates, now)) this.#runSnap(folder, candidates);
          continue;
        }
        for (const candidate of [...folder.files.values()]) {
          if (this.running >= config.concurrency) break;
          const file = store.fileFor(folder.def.name, candidate.name);
          if (!file) continue;
          const forced = Boolean(file.forceNow);
          if (paused && !forced) continue;
          if (!this.#fileDispatchable(file, now)) continue;
          if (!forced && file.status === STATUS.PENDING && !store.isSettled(folder, file, now)) continue;
          this.#runFile(folder, file.name);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  async processNow(folderName) {
    const { store } = this.ctx;
    const folder = store.getFolder(folderName);
    if (!folder) return { ok: false, error: "unknown folder" };
    if (folder.exists === false) return { ok: false, error: "source directory is not available" };
    if (this.active.has(folderName)) return { ok: false, busy: true, error: "another job is already running for this folder" };
    let count = 0;
    for (const file of folder.files.values()) {
      if (folder.def.filePattern && !matchesPattern(file.name, folder.def.filePattern)) continue;
      if (file.status === STATUS.PENDING || file.status === STATUS.ERROR) {
        store.updateFile(folderName, file.name, { forceNow: true, nextRetryAt: 0 });
        count++;
      }
    }
    await this.tick();
    return { ok: true, processed: count };
  }

  #reserve(folderName) {
    this.active.add(folderName);
    this.running++;
  }

  #release(folderName) {
    this.active.delete(folderName);
    this.running = Math.max(0, this.running - 1);
    setTimeout(() => this.tick(), 0).unref?.();
  }

  #runFile(folder, fileName) {
    const { store } = this.ctx;
    const file = store.fileFor(folder.def.name, fileName);
    if (!file) return;
    this.#reserve(folder.def.name);
    store.updateFile(folder.def.name, fileName, { status: STATUS.QUEUED });
    const processor = folder.def.method === "copy" ? processCopy : processStandardize;
    processor(this.ctx, folder, file)
      .then((result) => this.#applyResults(folder, [fileName], result))
      .catch((err) => this.#applyResults(folder, [fileName], { status: STATUS.ERROR, kind: "tool", message: err.message }))
      .finally(() => this.#release(folder.def.name));
  }

  #runSnap(folder, files) {
    const { store } = this.ctx;
    if (files.length === 0) return;
    this.#reserve(folder.def.name);
    for (const file of files) {
      store.updateFile(folder.def.name, file.name, { status: STATUS.QUEUED });
    }
    processSnapBatch(this.ctx, folder, files)
      .then((results) => {
        for (const { name, result } of results) {
          this.#applyResults(folder, [name], result);
        }
      })
      .catch((err) => {
        for (const file of files) {
          this.#applyResults(folder, [file.name], { status: STATUS.ERROR, kind: "tool", message: err.message });
        }
      })
      .finally(() => this.#release(folder.def.name));
  }

  #applyResults(folder, names, result) {
    const { store, config, notify, log } = this.ctx;
    for (const name of names) {
      const file = store.fileFor(folder.def.name, name);
      if (!file) continue;
      file.forceNow = false;
      const now = Date.now();
      if (result.status === STATUS.DONE || result.status === STATUS.DUPLICATE) {
        store.updateFile(folder.def.name, name, {
          status: result.status,
          destName: result.destName ?? file.destName ?? null,
          message: result.message ?? null,
          attempts: 0,
          errorKind: null,
          nextRetryAt: 0,
        });
      } else if (result.status === STATUS.CONFLICT) {
        store.updateFile(folder.def.name, name, {
          status: STATUS.CONFLICT,
          destName: result.destName ?? null,
          message: result.message ?? "conflict",
          nextRetryAt: 0,
        });
        notify.notify("error", `${folder.def.name}/${name}: ${result.message ?? "conflict"}`);
      } else if (result.status === STATUS.PENDING) {
        store.updateFile(folder.def.name, name, {
          status: STATUS.PENDING,
          message: result.message ?? null,
          errorKind: null,
          nextRetryAt: now + 300_000,
        });
      } else {
        const attempts = (file.attempts ?? 0) + 1;
        const retryable = RETRYABLE.has(result.kind) && attempts <= config.maxAutoRetries;
        store.updateFile(folder.def.name, name, {
          status: STATUS.ERROR,
          errorKind: result.kind ?? "tool",
          message: result.message ?? "processing failed",
          attempts,
          nextRetryAt: retryable ? now + backoffMs(attempts) : 0,
        });
        if (!retryable) {
          notify.notify("error", `${folder.def.name}/${name}: ${result.message ?? "processing failed"}`);
        }
        log(`error processing ${folder.def.name}/${name}: ${result.message ?? "unknown"}`);
      }
    }
  }

  async runManual(folder, names, job) {
    if (this.active.has(folder.def.name)) {
      return { ok: false, busy: true, error: "another job is already running for this folder" };
    }
    const { store } = this.ctx;
    this.#reserve(folder.def.name);
    for (const name of names) {
      store.updateFile(folder.def.name, name, { status: STATUS.PROCESSING });
    }
    try {
      const results = await job();
      for (const { name, result } of results) {
        this.#applyResults(folder, [name], result);
      }
      return { ok: true };
    } catch (err) {
      for (const name of names) {
        this.#applyResults(folder, [name], { status: STATUS.ERROR, kind: "tool", message: err.message });
      }
      return { ok: false, error: err.message };
    } finally {
      this.#release(folder.def.name);
    }
  }
}

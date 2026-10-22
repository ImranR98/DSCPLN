import fsp from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, readJsonFile } from "@dscpln/server-kit";
import { normalizeConfig, saveConfig, validateConfig, ensureRuntimeDirs, loadConfig } from "./config.js";
import { createExifTool } from "./exif.js";
import { Logger } from "./log.js";
import { Notifier } from "./notify.js";
import { Queue } from "./queue.js";
import { Store } from "./store.js";
import { SyncLock } from "./lock.js";
import { Watchers } from "./watchers.js";
import { sweepTrash } from "./cleanup.js";
import { rehydrateReview } from "./review.js";
import { ApiServer } from "./api/index.js";

export class Daemon {
  constructor(configPath, options = {}) {
    this.configPath = configPath;
    this.options = options;
    this.started = false;
  }

  async start() {
    try {
      await this.#start();
    } catch (err) {
      await this.stop().catch(() => {});
      throw err;
    }
  }

  async #start() {
    this.config = await loadConfig(this.configPath);
    if (this.options.port) this.config.port = Number(this.options.port);
    if (this.options.bind) this.config.bindHost = this.options.bind;
    validateConfig(this.config);
    // Runtime toggles live beside the logs, not in the declarative config.
    this.runtimeFile = path.join(path.dirname(this.config.logDir), "state.json");
    const runtime = await readJsonFile(this.runtimeFile, null);
    if (runtime && typeof runtime.paused === "boolean") this.config.paused = runtime.paused;
    if (runtime && typeof runtime.dryRun === "boolean") this.config.dryRun = runtime.dryRun;

    this.log = new Logger(this.config.logDir);
    await this.log.init();
    await ensureRuntimeDirs(this.config, (message) => this.log.log(`WARN: ${message}`));
    this.log.log(`File Pipelines starting (config: ${this.configPath})`);

    this.exiftool = createExifTool();
    this.store = new Store(this.config, this.exiftool);
    this.notify = new Notifier(this.config, this.log);
    const logFn = (...args) => this.log.log(...args);
    this.ctx = {
      config: this.config,
      store: this.store,
      exiftool: this.exiftool,
      log: logFn,
      logger: this.log,
      notify: this.notify,
    };

    this.lock = new SyncLock(this.config, this.log);
    await this.lock.acquire({ force: this.options.force });

    this.queue = new Queue(this.ctx);
    this.ctx.queue = this.queue;
    this.watchers = new Watchers(this.store, this.log);

    await this.#cleanStaleStaging();
    for (const folder of this.store.listFolders()) {
      await this.store.scanFolder(folder.def.name);
    }
    await rehydrateReview(this.ctx);
    this.watchers.rebuild(this.config);
    await this.watchers.whenReady();
    // One more scan once the watchers are live: files created during startup
    // (after chokidar's initial traversal but before its watch was active)
    // would otherwise wait for the periodic rescan.
    for (const folder of this.store.listFolders()) {
      await this.store.scanFolder(folder.def.name);
    }

    this.queue.start();
    this.rescanTimer = setInterval(() => this.#rescan(), 60_000);
    this.rescanTimer.unref?.();
    this.sweepTimer = setInterval(() => sweepTrash(this.ctx).catch(() => {}), 3600_000);
    this.sweepTimer.unref?.();
    await sweepTrash(this.ctx);

    this.api = new ApiServer(this);
    await this.api.start();
    this.started = true;
    this.log.log(`File Pipelines running on http://${this.config.bindHost}:${this.config.port}`);
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
    try {
      this.queue?.stop();
    } catch {
      // ignore
    }
    clearInterval(this.rescanTimer);
    clearInterval(this.sweepTimer);
    await this.api?.close().catch(() => {});
    await this.watchers?.close().catch(() => {});
    await this.lock?.release().catch(() => {});
    this.log?.log("File Pipelines stopped");
    this.log?.close();
    await this.exiftool?.end().catch(() => {});
  }

  async #rescan() {
    try {
      for (const folder of this.store.listFolders()) {
        await this.store.scanFolder(folder.def.name);
      }
      this.store.pruneCleaned();
    } catch (err) {
      this.log.log(`rescan failed: ${err.message}`);
    }
  }

  async #cleanStaleStaging() {
    const jobsDir = path.join(this.config.stagingDir, "jobs");
    const entries = await fsp.readdir(jobsDir).catch(() => []);
    for (const entry of entries) {
      const full = path.join(jobsDir, entry);
      const stat = await fsp.stat(full).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 24 * 3600 * 1000) {
        await fsp.rm(full, { recursive: true, force: true });
      }
    }
  }

  async applyConfig(raw) {
    const paused = this.config.paused;
    const dryRun = this.config.dryRun;
    const incoming = { ...raw, folders: raw.folders ?? [] };
    const next = normalizeConfig(incoming);
    validateConfig(next);
    await ensureRuntimeDirs(next, (message) => this.log.log(`WARN: ${message}`));
    await saveConfig(this.configPath, next);
    this.config = { ...next, paused, dryRun };
    this.ctx.config = this.config;
    this.store.setConfig(this.config);
    this.notify.setConfig(this.config);
    this.watchers.rebuild(this.config);
    for (const folder of this.store.listFolders()) {
      await this.store.scanFolder(folder.def.name);
    }
    await rehydrateReview(this.ctx);
    this.watchers.whenReady().then(() => {
      for (const folder of this.store.listFolders()) {
        this.store.scanFolder(folder.def.name).catch(() => {});
      }
    }).catch(() => {});
    this.log.log("config updated");
    this.queue.tick();
    return this.config;
  }

  async #saveRuntime() {
    await atomicWriteJson(this.runtimeFile, {
      paused: Boolean(this.config.paused),
      dryRun: Boolean(this.config.dryRun),
    });
  }

  async setPaused(paused) {
    this.config.paused = Boolean(paused);
    this.ctx.config = this.config;
    this.store.config = this.config;
    await this.#saveRuntime();
    this.log.log(paused ? "processing paused" : "processing resumed");
    if (!paused) this.queue.tick();
  }

  async setDryRun(dryRun) {
    this.config.dryRun = Boolean(dryRun);
    this.ctx.config = this.config;
    this.store.config = this.config;
    await this.#saveRuntime();
    this.log.log(dryRun ? "dry-run enabled" : "dry-run disabled");
    this.queue.tick();
  }
}

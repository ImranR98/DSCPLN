import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import path from "node:path";
import { findRealExifDate, standardNameFor } from "./exif.js";
import { DirCache, classifyDestMatch, findExpectedDestName, mapSnapInputs, readSnapOutputs, statSize } from "./verify.js";
import { isHiddenName, isSyncConflictName, isTempName, matchesPattern, statOrNull } from "./util.js";

export const STATUS = {
  PENDING: "pending",
  QUEUED: "queued",
  PROCESSING: "processing",
  DONE: "done",
  DUPLICATE: "duplicate",
  ERROR: "error",
  CONFLICT: "conflict",
  IGNORED: "ignored",
  CLEANED: "cleaned",
};

const AUTO_RESETTABLE = new Set([STATUS.ERROR, STATUS.CONFLICT]);

export class Store extends EventEmitter {
  constructor(config, exiftool) {
    super();
    this.config = config;
    this.exiftool = exiftool;
    this.cache = new DirCache();
    this.folders = new Map();
    this.syncFolders();
  }

  setConfig(config) {
    this.config = config;
    this.syncFolders();
  }

  syncFolders() {
    const wanted = new Map(this.config.folders.map((f) => [f.name, f]));
    for (const name of [...this.folders.keys()]) {
      if (!wanted.has(name)) this.folders.delete(name);
    }
    for (const [name, def] of wanted) {
      const existing = this.folders.get(name);
      if (existing) {
        existing.def = def;
      } else {
        this.folders.set(name, {
          def,
          files: new Map(),
          exists: false,
          lastEventAt: 0,
          snapOutputsAt: 0,
          snapInputMap: new Map(),
        });
      }
    }
  }

  getFolder(name) {
    return this.folders.get(name) ?? null;
  }

  listFolders() {
    return [...this.folders.values()];
  }

  fileFor(folderName, fileName) {
    return this.folders.get(folderName)?.files.get(fileName) ?? null;
  }

  updateFile(folderName, fileName, patch, { emit = true } = {}) {
    const folder = this.folders.get(folderName);
    if (!folder) return null;
    const file = folder.files.get(fileName);
    if (!file) return null;
    Object.assign(file, patch);
    file.updatedAt = Date.now();
    if (emit) this.emit("update");
    return file;
  }

  async scanFolder(folderName) {
    const folder = this.folders.get(folderName);
    if (!folder) return;
    const { def } = folder;
    const names = await fsp.readdir(def.source).catch(() => null);
    if (names === null) {
      if (folder.exists) {
        folder.exists = false;
        this.emit("update");
      }
      return;
    }
    if (!folder.exists) {
      folder.exists = true;
      this.emit("update");
    }
    const seen = new Set();
    for (const name of names) {
      if (isHiddenName(name) || isTempName(name)) continue;
      seen.add(name);
      const stat = statOrNull(path.join(def.source, name));
      if (!stat || !stat.isFile()) continue;
      this.addOrUpdate(folderName, name, stat);
    }
    for (const [name, file] of folder.files) {
      if (!seen.has(name)) {
        folder.files.delete(name);
      }
    }
    await this.deriveProcessed(folderName);
  }

  addOrUpdate(folderName, name, stat) {
    const folder = this.folders.get(folderName);
    if (!folder) return;
    const matches = matchesPattern(name, folder.def.filePattern);
    const existing = folder.files.get(name);
    if (!existing) {
      const file = {
        name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        status: !matches
          ? STATUS.IGNORED
          : isSyncConflictName(name)
            ? STATUS.CONFLICT
            : STATUS.PENDING,
        message: !matches
          ? `does not match ${folder.def.filePattern}`
          : isSyncConflictName(name)
            ? "Syncthing conflict copy — review before processing"
            : null,
        destName: null,
        attempts: 0,
        errorKind: null,
        nextRetryAt: 0,
        firstSeenAt: Date.now(),
        updatedAt: Date.now(),
        expected: null,
        expectFor: null,
      };
      folder.files.set(name, file);
      folder.lastEventAt = Date.now();
      this.emit("update");
      return file;
    }
    const changed = existing.size !== stat.size || existing.mtimeMs !== stat.mtimeMs;
    existing.size = stat.size;
    existing.mtimeMs = stat.mtimeMs;
    if (!matches) {
      if (existing.status !== STATUS.IGNORED) {
        existing.status = STATUS.IGNORED;
        existing.message = `does not match ${folder.def.filePattern}`;
        existing.destName = null;
        this.emit("update");
      }
      return existing;
    }
    if (existing.status === STATUS.IGNORED) {
      existing.status = STATUS.PENDING;
      existing.message = null;
      this.emit("update");
    }
    if (changed) {
      folder.lastEventAt = Date.now();
      if (existing.status === STATUS.PENDING || AUTO_RESETTABLE.has(existing.status)) {
        existing.status = STATUS.PENDING;
        existing.message = null;
        existing.errorKind = null;
        existing.nextRetryAt = 0;
        existing.destName = null;
      } else if ([STATUS.DONE, STATUS.DUPLICATE].includes(existing.status)) {
        existing.status = STATUS.PENDING;
        existing.message = "source changed after processing; will re-process";
        existing.destName = null;
      }
      this.emit("update");
    }
    return existing;
  }

  removeFile(folderName, name, status = STATUS.CLEANED) {
    const folder = this.folders.get(folderName);
    if (!folder) return;
    const file = folder.files.get(name);
    if (!file) return;
    if (file.status === STATUS.CLEANED && status !== STATUS.CLEANED) return;
    if (status === STATUS.CLEANED) {
      file.status = STATUS.CLEANED;
      file.destName = null;
    } else {
      folder.files.delete(name);
    }
    folder.lastEventAt = Date.now();
    this.emit("update");
  }

  pruneCleaned(maxAgeMs = 24 * 3600 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const folder of this.folders.values()) {
      for (const [name, file] of folder.files) {
        if (file.status === STATUS.CLEANED && (file.updatedAt ?? 0) < cutoff) folder.files.delete(name);
      }
    }
  }

  async expectedDestName(folder, file) {
    const key = `${file.size}:${Math.round(file.mtimeMs)}`;
    if (file.expectFor === key) return file.expected ?? null;
    const sourcePath = path.join(folder.def.source, file.name);
    let date = null;
    try {
      date = await findRealExifDate(this.exiftool, sourcePath);
    } catch {
      date = null;
    }
    const expected = date ? standardNameFor(file.name, date) : null;
    file.expectFor = key;
    file.expected = expected;
    return expected;
  }

  async deriveProcessed(folderName) {
    const folder = this.folders.get(folderName);
    if (!folder) return;
    const { def } = folder;
    if (def.method === "snapchat") {
      await this.deriveSnapProcessed(folder);
      return;
    }
    const names = await this.cache.list(def.destination).catch(() => []);
    for (const file of folder.files.values()) {
      if (file.status !== STATUS.PENDING) continue;
      let match = names.includes(file.name) ? file.name : null;
      if (!match) {
        const expected = await this.expectedDestName(folder, file);
        if (!expected) continue;
        match = findExpectedDestName(names, expected);
      }
      if (!match) continue;
      const destPath = path.join(def.destination, match);
      const destSize = await statSize(destPath);
      const verdict = classifyDestMatch({ method: def.method, sourceSize: file.size, destSize });
      if (verdict === "duplicate") {
        file.status = STATUS.DUPLICATE;
        file.destName = match;
        file.message = match === file.name ? null : "matched its standardized destination file";
        file.updatedAt = Date.now();
      } else if (verdict === "conflict") {
        file.status = STATUS.CONFLICT;
        file.destName = match;
        file.message = `destination ${match} exists with very different size (${destSize} vs ${file.size}) — review`;
        file.updatedAt = Date.now();
      }
    }
    this.emit("update");
  }

  async refreshSnapOutputs(folder, { force = false } = {}) {
    const now = Date.now();
    if (!force && now - folder.snapOutputsAt < 60_000) return;
    const outputs = await readSnapOutputs(this.cache, this.exiftool, folder.def.destination);
    folder.snapOutputsAt = now;
    folder.snapInputMap = mapSnapInputs(outputs);
  }

  async deriveSnapProcessed(folder) {
    await this.refreshSnapOutputs(folder);
    for (const file of folder.files.values()) {
      if (file.status !== STATUS.PENDING) continue;
      const output = folder.snapInputMap.get(file.name);
      if (!output) continue;
      file.status = STATUS.DUPLICATE;
      file.destName = output.name;
      file.message = "already part of a concatenated destination file";
      file.updatedAt = Date.now();
    }
    this.emit("update");
  }

  async deriveAll() {
    for (const folder of this.folders.values()) {
      await this.deriveProcessed(folder.def.name);
    }
  }

  invalidateDest(folderName) {
    const folder = this.folders.get(folderName);
    if (!folder) return;
    this.cache.invalidate(folder.def.destination);
    folder.snapOutputsAt = 0;
  }

  isSettled(folder, file, now = Date.now()) {
    const settleMs = (folder.def.settleSeconds ?? 0) * 1000;
    return now >= Math.max(file.mtimeMs, file.firstSeenAt) + settleMs;
  }

  snapshot({ includeCleaned = false } = {}) {
    const now = Date.now();
    const folders = this.listFolders().map((folder) => {
      const files = [...folder.files.values()]
        .filter((f) => includeCleaned || f.status !== STATUS.CLEANED)
        .map((f) => ({
          name: f.name,
          size: f.size,
          mtimeMs: f.mtimeMs,
          status: f.status,
          message: f.message,
          destName: f.destName,
          attempts: f.attempts,
          settleAt: Math.max(f.mtimeMs, f.firstSeenAt) + (folder.def.settleSeconds ?? 0) * 1000,
          updatedAt: f.updatedAt,
        }));
      const counts = {};
      for (const f of files) counts[f.status] = (counts[f.status] ?? 0) + 1;
      return {
        name: folder.def.name,
        source: folder.def.source,
        destination: folder.def.destination,
        method: folder.def.method,
        filePattern: folder.def.filePattern,
        settleSeconds: folder.def.settleSeconds,
        groupWindowSeconds: folder.def.groupWindowSeconds,
        exists: folder.exists,
        lastEventAt: folder.lastEventAt,
        counts,
        files,
      };
    });
    return {
      now,
      paused: this.config.paused,
      dryRun: this.config.dryRun,
      concurrency: this.config.concurrency,
      trashRetentionDays: this.config.trashRetentionDays,
      folders,
    };
  }
}

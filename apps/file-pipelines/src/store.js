import fsp from "node:fs/promises";
import path from "node:path";
import { findRealExifDate, standardNameFor } from "./exif.js";
import { reviewedAudioGroupOf } from "./reviewed-audio.js";
import { DirCache, classifyDestMatch, findExpectedDestName, mapSnapInputs, readSnapOutputs, statSize } from "./verify.js";
import { statOrNull } from "@dscpln/server-kit";
import { shouldSkipName, isSyncConflictName, matchesPattern } from "./util.js";

export const STATUS = {
  PENDING: "pending",
  QUEUED: "queued",
  PROCESSING: "processing",
  DONE: "done",
  DUPLICATE: "duplicate",
  ERROR: "error",
  CONFLICT: "conflict",
  IGNORED: "ignored",
  REVIEW: "review",
  DISCARDED: "discarded",
  CLEANED: "cleaned",
};

const AUTO_RESETTABLE = new Set([STATUS.ERROR, STATUS.CONFLICT, STATUS.DISCARDED]);
const RESETTABLE_WHEN_CHANGED = new Set([STATUS.DONE, STATUS.DUPLICATE, STATUS.REVIEW]);

export class Store {
  constructor(config, exiftool) {
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

  updateFile(folderName, fileName, patch) {
    const folder = this.folders.get(folderName);
    if (!folder) return null;
    const file = folder.files.get(fileName);
    if (!file) return null;
    Object.assign(file, patch);
    file.updatedAt = Date.now();
    return file;
  }

  async scanFolder(folderName) {
    const folder = this.folders.get(folderName);
    if (!folder) return;
    const { def } = folder;
    const names = await this.#listFiles(def);
    if (names === null) {
      if (folder.exists) {
        folder.exists = false;
      }
      return;
    }
    if (!folder.exists) {
      folder.exists = true;
    }
    const seen = new Set();
    for (const name of names) {
      seen.add(name);
      const stat = statOrNull(path.join(def.source, ...name.split("/")));
      if (!stat || !stat.isFile()) continue;
      this.addOrUpdate(folderName, name, stat);
    }
    for (const name of folder.files.keys()) {
      if (!seen.has(name)) {
        folder.files.delete(name);
      }
    }
    await this.deriveProcessed(folderName);
  }

  // Returns store keys (relative POSIX paths for recursive folders) or null
  // when the source directory is unavailable.
  async #listFiles(def) {
    let entries;
    try {
      entries = await fsp.readdir(def.source, { withFileTypes: true });
    } catch {
      return null;
    }
    const out = [];
    const collect = async (dir, rel) => {
      const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const item of items) {
        if (item.isSymbolicLink()) continue;
        if (shouldSkipName(item.name, def.includeHidden)) continue;
        if (item.isDirectory()) {
          if (def.recursive) await collect(path.join(dir, item.name), rel ? `${rel}/${item.name}` : item.name);
          continue;
        }
        if (item.isFile()) out.push(rel ? `${rel}/${item.name}` : item.name);
      }
    };
    for (const item of entries) {
      if (item.isSymbolicLink()) continue;
      if (shouldSkipName(item.name, def.includeHidden)) continue;
      if (item.isDirectory()) {
        if (def.recursive) await collect(path.join(def.source, item.name), item.name);
        continue;
      }
      if (item.isFile()) out.push(item.name);
    }
    return out;
  }

  addOrUpdate(folderName, name, stat) {
    const folder = this.folders.get(folderName);
    if (!folder) return;
    const base = path.basename(name);
    const patternOk = matchesPattern(base, folder.def.filePattern);
    const dateOk = folder.def.method !== "reviewed-audio"
      || !folder.def.datePattern
      || reviewedAudioGroupOf(name, folder.def.datePattern) !== null;
    const matches = patternOk && dateOk;
    const mismatchMessage = !patternOk
      ? `does not match ${folder.def.filePattern}`
      : "no date matched datePattern";
    const existing = folder.files.get(name);
    if (!existing) {
      const syncConflict = isSyncConflictName(base);
      const file = {
        name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        status: !matches ? STATUS.IGNORED : syncConflict ? STATUS.CONFLICT : STATUS.PENDING,
        message: !matches
          ? mismatchMessage
          : syncConflict
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
      return file;
    }
    const changed = existing.size !== stat.size || existing.mtimeMs !== stat.mtimeMs;
    existing.size = stat.size;
    existing.mtimeMs = stat.mtimeMs;
    if (!matches) {
      if (existing.status !== STATUS.IGNORED) {
        existing.status = STATUS.IGNORED;
        existing.message = mismatchMessage;
        existing.destName = null;
      }
      return existing;
    }
    if (existing.status === STATUS.IGNORED) {
      existing.status = STATUS.PENDING;
      existing.message = null;
    }
    if (changed) {
      folder.lastEventAt = Date.now();
      if (existing.status === STATUS.PENDING || AUTO_RESETTABLE.has(existing.status)) {
        existing.status = STATUS.PENDING;
        existing.message = null;
        existing.errorKind = null;
        existing.nextRetryAt = 0;
        existing.destName = null;
      } else if (RESETTABLE_WHEN_CHANGED.has(existing.status)) {
        existing.message = existing.status === STATUS.REVIEW
          ? "source changed while awaiting review; will re-process"
          : "source changed after processing; will re-process";
        existing.status = STATUS.PENDING;
        existing.destName = null;
      }
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
    let date;
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
    if (def.method === "copy") {
      await this.deriveCopyProcessed(folder);
      return;
    }
    if (def.method === "reviewed-audio") {
      // Approval-only: the source files are the queue, so there is no derived
      // processed/duplicate state to recompute.
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
  }

  // Copy folders are adopted without traversing or hashing the destination:
  // each pending source file is stat'ed at its exact destination path, and a
  // size+second-precision-mtime match means it is already mirrored. Anything
  // else is left pending: the queue copies (or the destination is flagged in
  // `conflict` mode).
  async deriveCopyProcessed(folder) {
    const { def } = folder;
    for (const file of folder.files.values()) {
      if (file.status !== STATUS.PENDING) continue;
      const destPath = path.join(def.destination, ...file.name.split("/"));
      const stat = await fsp.stat(destPath).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      const sameSize = stat.size === file.size;
      const sameMtime = Math.floor(stat.mtimeMs / 1000) === Math.floor(file.mtimeMs / 1000);
      if (sameSize && sameMtime) {
        file.status = STATUS.DUPLICATE;
        file.destName = file.name;
        file.message = "already mirrored in destination";
      } else if (def.onChanged === "conflict") {
        file.status = STATUS.CONFLICT;
        file.destName = file.name;
        file.message = "destination exists with a different size or timestamp — review";
      }
      file.updatedAt = Date.now();
    }
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
        datePattern: folder.def.datePattern,
        concat: folder.def.concat !== false,
        settleSeconds: folder.def.settleSeconds,
        groupWindowSeconds: folder.def.groupWindowSeconds,
        recursive: folder.def.recursive,
        includeHidden: folder.def.includeHidden,
        onChanged: folder.def.onChanged,
        cleanup: folder.def.cleanup,
        placement: folder.def.placement,
        autoProcess: folder.def.autoProcess,
        notify: folder.def.notify,
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

import chokidar from "chokidar";
import path from "node:path";
import { statOrNull } from "@dscpln/server-kit";
import { shouldSkipName } from "./util.js";

export class Watchers {
  constructor(store, log) {
    this.store = store;
    this.log = log;
    this.map = new Map();
  }

  rebuild(config) {
    const wanted = new Map(config.folders.map((f) => [f.name, f]));
    for (const [name, entry] of [...this.map.entries()]) {
      const def = wanted.get(name);
      if (!def || entry.source !== def.source || entry.recursive !== def.recursive) {
        entry.watcher.close().catch(() => {});
        this.map.delete(name);
      }
    }
    for (const [name, def] of wanted) {
      if (this.map.has(name)) continue;
      const root = path.resolve(def.source);
      const watcher = chokidar.watch(root, {
        depth: def.recursive ? undefined : 0,
        ignoreInitial: false,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 500 },
        ignored: (p) => {
          if (path.resolve(p) === root) return false;
          return shouldSkipName(path.basename(p), def.includeHidden);
        },
      });
      watcher.on("add", (p) => this.#handle(name, p));
      watcher.on("change", (p) => this.#handle(name, p));
      watcher.on("unlink", (p) => {
        this.store.removeFile(name, this.#keyFor(name, p), null);
      });
      watcher.on("error", (err) => this.log.log(`watcher error for ${def.source}: ${err.message}`));
      this.map.set(name, { watcher, source: def.source, recursive: def.recursive, ready: false });
    }
  }

  // Resolves when every watcher has completed its initial traversal. Until
  // then there is a window where a file created after the traversal's readdir
  // but before the OS watch is active could be missed; callers re-scan after
  // this resolves to close that gap.
  whenReady(timeoutMs = 15_000) {
    const waits = [];
    for (const entry of this.map.values()) {
      if (entry.ready) continue;
      waits.push(new Promise((resolve) => {
        const done = () => {
          entry.ready = true;
          resolve();
        };
        entry.watcher.once("ready", done);
        const timer = setTimeout(done, timeoutMs);
        timer.unref?.();
      }));
    }
    return Promise.all(waits);
  }

  #def(folderName) {
    return this.store.getFolder(folderName)?.def ?? null;
  }

  #keyFor(folderName, filePath) {
    const def = this.#def(folderName);
    if (!def) return path.basename(filePath);
    if (!def.recursive) return path.basename(filePath);
    return path.relative(def.source, filePath).split(path.sep).join("/");
  }

  #handle(folderName, filePath) {
    const def = this.#def(folderName);
    if (!def) return;
    const base = path.basename(filePath);
    if (shouldSkipName(base, def.includeHidden)) return;
    const stat = statOrNull(filePath);
    if (!stat || !stat.isFile()) return;
    this.store.addOrUpdate(folderName, this.#keyFor(folderName, filePath), stat);
  }

  async close() {
    for (const entry of this.map.values()) {
      await entry.watcher.close().catch(() => {});
    }
    this.map.clear();
  }
}

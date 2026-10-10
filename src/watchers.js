import chokidar from "chokidar";
import path from "node:path";
import { isHiddenName, isTempName, statOrNull } from "./util.js";

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
      if (!def || entry.source !== def.source) {
        entry.watcher.close().catch(() => {});
        this.map.delete(name);
      }
    }
    for (const [name, def] of wanted) {
      if (this.map.has(name)) continue;
      const root = path.resolve(def.source);
      const watcher = chokidar.watch(root, {
        depth: 0,
        ignoreInitial: false,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 500 },
        ignored: (p) => {
          const base = path.basename(p);
          if (base === path.basename(root)) return false;
          return isHiddenName(base) || isTempName(base);
        },
      });
      watcher.on("add", (p) => this.#handle(name, p));
      watcher.on("change", (p) => this.#handle(name, p));
      watcher.on("unlink", (p) => {
        this.store.removeFile(name, path.basename(p), null);
      });
      watcher.on("error", (err) => this.log.log(`watcher error for ${def.source}: ${err.message}`));
      this.map.set(name, { watcher, source: def.source });
    }
  }

  #handle(folderName, filePath) {
    const name = path.basename(filePath);
    if (isHiddenName(name) || isTempName(name)) return;
    const stat = statOrNull(filePath);
    if (!stat || !stat.isFile()) return;
    this.store.addOrUpdate(folderName, name, stat);
  }

  async close() {
    for (const entry of this.map.values()) {
      await entry.watcher.close().catch(() => {});
    }
    this.map.clear();
  }
}

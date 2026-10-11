import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export class Logger {
  constructor(logDir) {
    this.logDir = logDir;
    this.buffer = [];
    this.max = 1000;
    this.stream = null;
    this.streamDay = null;
  }

  async init() {
    try {
      await fsp.mkdir(this.logDir, { recursive: true });
      this.#openStream();
    } catch {
      this.logDir = null;
    }
  }

  #openStream() {
    if (!this.logDir) return;
    const day = new Date().toISOString().slice(0, 10);
    if (this.stream && this.streamDay === day) return;
    this.stream?.end();
    try {
      const file = path.join(this.logDir, `media-sync-${day}.log`);
      const stream = fs.createWriteStream(file, { flags: "a" });
      stream.on("error", () => {
        if (this.stream === stream) this.stream = null;
      });
      this.stream = stream;
      this.streamDay = day;
    } catch {
      this.stream = null;
    }
  }

  log(...args) {
    const line = `${new Date().toISOString()} ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}`;
    console.log(line);
    this.buffer.push(line);
    if (this.buffer.length > this.max) this.buffer.splice(0, this.buffer.length - this.max);
    try {
      this.#openStream();
      this.stream?.write(line + "\n");
    } catch {
      // logging must never throw
    }
  }

  recent(limit = 200) {
    return this.buffer.slice(-limit);
  }

  close() {
    this.stream?.end();
  }
}

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupFiles, cleanupPreview, emptyTrash, listTrash, restoreTrashFiles } from "./cleanup.js";
import { runAction } from "./actions.js";
import { Notifier } from "./notify.js";
import { parkPathFor } from "./park.js";
import { discardAllReview, discardReview, listReview, placeAllReview, placeReview } from "./review.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(data);
}

async function readBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export class ApiServer {
  constructor(daemon) {
    this.daemon = daemon;
    this.clients = new Set();
    this.server = null;
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.#handle(req, res).catch((err) => {
        this.daemon.log.log(`api error: ${err.stack ?? err.message}`);
        if (!res.headersSent) json(res, 500, { error: err.message });
        else res.end();
      });
    });
    this.daemon.store.on("update", () => this.#broadcast({ type: "update" }));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.daemon.config.port, this.daemon.config.bindHost, resolve);
    });
  }

  async close() {
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
  }

  #broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  #checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const host = new URL(origin).host;
      return host === req.headers.host;
    } catch {
      return false;
    }
  }

  async #handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const { pathname } = url;
    const method = req.method ?? "GET";

    if (method === "GET" && !pathname.startsWith("/api/")) {
      const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = path.resolve(PUBLIC_DIR, rel);
      if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
        return json(res, 404, { error: "not found" });
      }
      try {
        const data = await fsp.readFile(filePath);
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
          "Cache-Control": pathname.startsWith("/vendor/") ? "public, max-age=86400" : "no-cache",
        });
        res.end(data);
      } catch {
        return json(res, 404, { error: "not found" });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/health") return json(res, 200, { ok: true });

    if (method === "GET" && pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      res.write("data: {\"type\":\"hello\"}\n\n");
      this.clients.add(res);
      req.on("close", () => this.clients.delete(res));
      return;
    }

    if (method !== "GET" && !this.#checkOrigin(req)) return json(res, 403, { error: "cross-origin request rejected" });

    if (method === "GET" && pathname === "/api/state") {
      return json(res, 200, {
        ...this.daemon.store.snapshot(),
        config: this.daemon.config,
        lock: { file: this.daemon.config.syncLockFile },
      });
    }

    if (method === "GET" && pathname === "/api/config") {
      return json(res, 200, this.daemon.config);
    }

    if (method === "PUT" && pathname === "/api/config") {
      const body = await readBody(req);
      const next = await this.daemon.applyConfig(body);
      return json(res, 200, next);
    }

    if (method === "GET" && pathname === "/api/log") {
      const limit = Number(url.searchParams.get("limit") ?? 200);
      return json(res, 200, { lines: this.daemon.log.recent(limit) });
    }

    if (method === "POST" && pathname === "/api/pause") {
      const body = await readBody(req);
      await this.daemon.setPaused(body.paused);
      return json(res, 200, { paused: this.daemon.config.paused });
    }

    if (method === "POST" && pathname === "/api/dry-run") {
      const body = await readBody(req);
      await this.daemon.setDryRun(body.dryRun);
      return json(res, 200, { dryRun: this.daemon.config.dryRun });
    }

    if (method === "POST" && pathname === "/api/ntfy-test") {
      const body = await readBody(req);
      const url = String(body.url ?? "").trim() || this.daemon.config.ntfy?.url || "";
      const token = String(body.token ?? "").trim() || this.daemon.config.ntfy?.token || "";
      if (!url) return json(res, 400, { error: "set an ntfy URL first" });
      if (!/^https?:\/\//i.test(url)) return json(res, 400, { error: "ntfy URL must start with http:// or https://" });
      const tester = new Notifier({ ntfy: { url, token } }, this.daemon.log);
      const result = await tester.notify("low", "Media Sync test notification");
      return json(res, result.ok ? 200 : 502, result.ok ? { ok: true } : { error: result.error });
    }

    if (method === "POST" && pathname.startsWith("/api/process/")) {
      const folderName = decodeURIComponent(pathname.slice("/api/process/".length));
      const body = await readBody(req).catch(() => ({}));
      const result = await this.daemon.queue.processNow(folderName, { files: body.files });
      return json(res, result.ok ? 200 : 409, result);
    }

    if (method === "GET" && pathname === "/api/review") {
      const entries = await listReview(this.daemon.ctx);
      return json(res, 200, { entries });
    }

    if (method === "GET" && pathname.startsWith("/api/review/file/")) {
      const rest = pathname.slice("/api/review/file/".length).split("/");
      const folderName = decodeURIComponent(rest[0] ?? "");
      const id = decodeURIComponent(rest.slice(1).join("/"));
      const folder = this.daemon.store.getFolder(folderName);
      if (!folder) return json(res, 404, { error: "unknown folder" });
      const filePath = parkPathFor(this.daemon.config, folderName, id);
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) return json(res, 404, { error: "not found" });
      const ext = path.extname(filePath).toLowerCase();
      const type = ext === ".mp4" || ext === ".m4a" ? "video/mp4" : ext === ".opus" ? "audio/ogg" : "application/octet-stream";
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      let start = 0;
      let end = stat.size - 1;
      if (range) {
        start = range[1] === "" ? Math.max(0, stat.size - Number(range[2])) : Number(range[1]);
        end = range[2] === "" ? stat.size - 1 : Math.min(Number(range[2]), stat.size - 1);
        if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
          return res.end();
        }
      }
      res.writeHead(range ? 206 : 200, {
        "Content-Type": type,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
        "Cache-Control": "no-store",
      });
      fs.createReadStream(filePath, { start, end }).on("error", () => res.end()).pipe(res);
      return;
    }

    if (method === "POST" && (pathname === "/api/review/place" || pathname === "/api/review/discard")) {
      const body = await readBody(req);
      const folder = this.daemon.store.getFolder(String(body.folder ?? ""));
      if (!folder) return json(res, 404, { error: "unknown folder" });
      const place = pathname.endsWith("/place");
      const ids = body.ids ?? (body.id ? [body.id] : []);
      if (!Array.isArray(ids) || ids.length === 0) return json(res, 400, { error: "id or ids required" });
      const results = [];
      for (const id of ids) {
        results.push({
          id: String(id),
          ...(place
            ? await placeReview(this.daemon.ctx, folder, String(id))
            : await discardReview(this.daemon.ctx, folder, String(id))),
        });
      }
      return json(res, 200, { results });
    }

    if (method === "POST" && (pathname === "/api/review/place-all" || pathname === "/api/review/discard-all")) {
      const body = await readBody(req);
      const folder = this.daemon.store.getFolder(String(body.folder ?? ""));
      if (!folder) return json(res, 404, { error: "unknown folder" });
      const place = pathname.endsWith("/place-all");
      const results = place
        ? await placeAllReview(this.daemon.ctx, folder)
        : await discardAllReview(this.daemon.ctx, folder);
      return json(res, 200, { results });
    }

    if (method === "POST" && pathname.startsWith("/api/actions/")) {
      const rest = pathname.slice("/api/actions/".length).split("/");
      const folderName = decodeURIComponent(rest[0] ?? "");
      const fileName = decodeURIComponent(rest.slice(1).join("/"));
      const body = await readBody(req);
      const result = await runAction(this.daemon.ctx, this.daemon.queue, folderName, fileName, body.action, body);
      const status = result && result.ok === false ? (result.busy ? 409 : 500) : 200;
      return json(res, status, result ?? { ok: true });
    }

    if (pathname.startsWith("/api/cleanup")) {
      if (method === "GET" && pathname.startsWith("/api/cleanup/")) {
        const folderName = decodeURIComponent(pathname.slice("/api/cleanup/".length));
        const folder = this.daemon.store.getFolder(folderName);
        if (!folder) return json(res, 404, { error: "unknown folder" });
        const files = folder.def.cleanup === false ? [] : cleanupPreview(folder);
        return json(res, 200, {
          folder: folderName,
          disabled: folder.def.cleanup === false,
          files,
          totalBytes: files.reduce((s, f) => s + (f.size ?? 0), 0),
        });
      }
      if (method === "POST" && pathname === "/api/cleanup-all") {
        const results = {};
        for (const folder of this.daemon.store.listFolders()) {
          const names = cleanupPreview(folder).map((f) => f.name);
          results[folder.def.name] = names.length > 0 ? await cleanupFiles(this.daemon.ctx, folder, names) : [];
        }
        return json(res, 200, { results });
      }
      if (method === "POST" && pathname.startsWith("/api/cleanup/")) {
        const folderName = decodeURIComponent(pathname.slice("/api/cleanup/".length));
        const folder = this.daemon.store.getFolder(folderName);
        if (!folder) return json(res, 404, { error: "unknown folder" });
        const body = await readBody(req);
        const names = body.names ?? cleanupPreview(folder).map((f) => f.name);
        const results = await cleanupFiles(this.daemon.ctx, folder, names);
        return json(res, 200, { results });
      }
    }

    if (method === "GET" && pathname === "/api/trash") {
      return json(res, 200, { entries: await listTrash(this.daemon.ctx) });
    }

    if (method === "POST" && pathname === "/api/trash/restore") {
      const body = await readBody(req);
      const targetDir = body.targetDir ? String(body.targetDir).trim() : null;
      const results = await restoreTrashFiles(this.daemon.ctx, body.files, { targetDir });
      return json(res, 200, { results });
    }

    if (method === "POST" && pathname === "/api/trash/empty") {
      await emptyTrash(this.daemon.ctx);
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && pathname === "/api/counts") {
      const counts = {};
      for (const folder of this.daemon.store.listFolders()) {
        const c = {};
        for (const file of folder.files.values()) c[file.status] = (c[file.status] ?? 0) + 1;
        counts[folder.def.name] = c;
      }
      return json(res, 200, counts);
    }

    return json(res, 404, { error: "not found" });
  }
}


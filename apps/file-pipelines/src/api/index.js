// The HTTP API: server setup (base-path mounting, HTML injection for the UI,
// CSRF origin check), the /events stream, and dispatch to the route modules in
// this directory (state, folders, review, cleanup, trash).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "@dscpln/server-kit";
import { handleCleanup } from "./cleanup.js";
import { handleFolders } from "./folders.js";
import { json } from "./http.js";
import { handleReview } from "./review.js";
import { handleState } from "./state.js";
import { handleTrash } from "./trash.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "static");

const ROUTE_HANDLERS = [handleState, handleFolders, handleReview, handleCleanup, handleTrash];

export class ApiServer {
  constructor(daemon) {
    this.daemon = daemon;
    this.clients = new Set();
    this.server = null;
  }

  async start() {
    const basePath = this.daemon.options.basePath ?? process.env.BASE_PATH ?? "";
    const app = createApp({
      title: "File Pipelines",
      pageTitle: null, // the page carries its own <title>
      basePath,
      staticDir: PUBLIC_DIR,
      jsonBody: false, // the API reads its own bodies (and /events streams)
      routes: (router) => {
        router.use("/api", (req, res) => {
          this.#handleApi(req, res).catch((err) => {
            this.daemon.log.log(`api error: ${err.stack ?? err.message}`);
            if (!res.headersSent) json(res, 500, { error: err.message });
            else res.end();
          });
        });
      },
    });
    this.daemon.store.on("update", () => this.#broadcast({ type: "update" }));
    await new Promise((resolve, reject) => {
      this.server = app.listen(this.daemon.config.port, this.daemon.config.bindHost, resolve);
      this.server.once("error", reject);
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

  async #handleApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`;
    const method = req.method ?? "GET";

    if (method === "GET" && pathname === "/health") return json(res, 200, { ok: true });

    if (method === "GET" && pathname === "/events") {
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

    const ctx = { req, res, url, daemon: this.daemon };
    for (const handler of ROUTE_HANDLERS) {
      if (await handler(ctx, method, pathname, url)) return;
    }

    return json(res, 404, { error: "not found" });
  }
}

// The HTTP API: server setup (base-path mounting, HTML injection, the kit's
// CSRF guard) and dispatch to the route modules in this directory.

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
    this.server = null;
  }

  async start() {
    const basePath = this.daemon.options.basePath ?? process.env.BASE_PATH ?? "";
    const app = createApp({
      title: "File Pipelines",
      pageTitle: null, // the page carries its own <title>
      basePath,
      staticDir: PUBLIC_DIR,
      jsonBody: false, // the API reads its own bodies
      routes: (router) => {
        router.use("/api", (req, res) => {
          this.#handleApi(req, res).catch((err) => {
            const statusCode = Number.isInteger(err.statusCode) ? err.statusCode : 500;
            if (statusCode >= 500) this.daemon.log.log(`api error: ${err.stack ?? err.message}`);
            if (!res.headersSent) json(res, statusCode, { error: err.message });
            else res.end();
          });
        });
      },
    });
    await new Promise((resolve, reject) => {
      this.server = app.listen(this.daemon.config.port, this.daemon.config.bindHost, resolve);
      this.server.once("error", reject);
    });
  }

  async close() {
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
  }

  async #handleApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`;
    const method = req.method ?? "GET";

    if (method === "GET" && pathname === "/health") return json(res, 200, { ok: true });

    const ctx = { req, res, url, daemon: this.daemon };
    for (const handler of ROUTE_HANDLERS) {
      if (await handler(ctx, method, pathname, url)) return;
    }

    return json(res, 404, { error: "not found" });
  }
}

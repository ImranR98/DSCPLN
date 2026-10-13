// App-level endpoints: health, state snapshot, config, log, pause/dry-run,
// ntfy test and per-folder status counts.

import { maskConfig, SECRET_MASK } from "../config.js";
import { Notifier } from "../notify.js";
import { isSnapshotFolder } from "../snapshot.js";
import { isPrivateHost, json, readBody } from "./http.js";

export async function handleState(ctx, method, pathname, url) {
  const { daemon, res } = ctx;

  if (method === "GET" && pathname === "/health") {
    json(res, 200, { ok: true });
    return true;
  }

  if (method === "GET" && pathname === "/state") {
    const runs = {};
    const status = daemon.snapshot?.status() ?? {};
    for (const folder of daemon.store.listFolders()) {
      if (!isSnapshotFolder(folder.def)) continue;
      runs[folder.def.name] = {
        ...(status[folder.def.name] ?? { running: false, ok: null, summary: "" }),
        lastRunAt: daemon.scheduler?.lastRunAt(folder.def.name) ?? 0,
        nextRun: daemon.scheduler?.nextRun(folder.def.name) ?? null,
      };
    }
    json(res, 200, {
      ...daemon.store.snapshot(),
      config: maskConfig(daemon.config),
      lock: { file: daemon.config.syncLockFile },
      runs,
    });
    return true;
  }

  if (method === "GET" && pathname === "/config") {
    json(res, 200, maskConfig(daemon.config));
    return true;
  }

  if (method === "PUT" && pathname === "/config") {
    const body = await readBody(ctx.req);
    const next = await daemon.applyConfig(body);
    json(res, 200, maskConfig(next));
    return true;
  }

  if (method === "GET" && pathname === "/log") {
    const limit = Number(url.searchParams.get("limit") ?? 200);
    json(res, 200, { lines: daemon.log.recent(limit) });
    return true;
  }

  if (method === "POST" && pathname === "/pause") {
    const body = await readBody(ctx.req);
    await daemon.setPaused(body.paused);
    json(res, 200, { paused: daemon.config.paused });
    return true;
  }

  if (method === "POST" && pathname === "/dry-run") {
    const body = await readBody(ctx.req);
    await daemon.setDryRun(body.dryRun);
    json(res, 200, { dryRun: daemon.config.dryRun });
    return true;
  }

  if (method === "POST" && pathname === "/ntfy-test") {
    const body = await readBody(ctx.req);
    const url_ = String(body.url ?? "").trim() || daemon.config.ntfy?.url || "";
    let token = String(body.token ?? "").trim() || daemon.config.ntfy?.token || "";
    if (token === SECRET_MASK) token = daemon.config.ntfy?.token ?? "";
    if (!url_) {
      json(res, 400, { error: "set an ntfy URL first" });
      return true;
    }
    if (!/^https?:\/\//i.test(url_)) {
      json(res, 400, { error: "ntfy URL must start with http:// or https://" });
      return true;
    }
    // The test may target a draft URL, but the stored server is the only
    // legitimate private/LAN destination; anything else private is an SSRF probe.
    let hostname;
    try {
      hostname = new URL(url_).hostname;
    } catch {
      json(res, 400, { error: "ntfy URL is not a valid URL" });
      return true;
    }
    let configuredHost;
    try {
      configuredHost = new URL(daemon.config.ntfy?.url ?? "").hostname;
    } catch {
      configuredHost = "";
    }
    if (isPrivateHost(hostname) && hostname !== configuredHost) {
      json(res, 400, { error: "ntfy URL must not target a private address" });
      return true;
    }
    const tester = new Notifier({ ntfy: { url: url_, token } }, daemon.log);
    const result = await tester.notify("low", "File Pipelines test notification");
    json(res, result.ok ? 200 : 502, result.ok ? { ok: true } : { error: result.error });
    return true;
  }

  if (method === "GET" && pathname === "/counts") {
    const counts = {};
    for (const folder of daemon.store.listFolders()) {
      const c = {};
      for (const file of folder.files.values()) c[file.status] = (c[file.status] ?? 0) + 1;
      counts[folder.def.name] = c;
    }
    json(res, 200, counts);
    return true;
  }

  return false;
}

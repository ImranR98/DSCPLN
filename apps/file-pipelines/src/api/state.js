// App-level endpoints: health, state snapshot, config, log, pause/dry-run
// and per-folder status counts.

import { isSnapshotFolder } from "../snapshot.js";
import { json, readBody } from "./http.js";

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
      config: daemon.config,
      lock: { file: daemon.config.syncLockFile },
      runs,
    });
    return true;
  }

  if (method === "GET" && pathname === "/config") {
    json(res, 200, daemon.config);
    return true;
  }

  if (method === "PUT" && pathname === "/config") {
    const body = await readBody(ctx.req);
    const next = await daemon.applyConfig(body);
    json(res, 200, next);
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

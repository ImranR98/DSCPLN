// Per-folder actions: run the watched queue now, run a snapshot Job, and the
// per-file actions (retry/repair/import/setDate).

import { isSnapshotFolder } from "../snapshot.js";
import { runAction } from "../actions.js";
import { json, readBody } from "./http.js";

export async function handleFolders(ctx, method, pathname) {
  const { daemon, res } = ctx;

  if (method === "POST" && pathname.startsWith("/process/")) {
    const folderName = decodeURIComponent(pathname.slice("/process/".length));
    const folder = daemon.store.getFolder(folderName);
    if (!folder) {
      json(res, 404, { error: "unknown folder" });
      return true;
    }
    if (isSnapshotFolder(folder.def)) {
      json(res, 409, { error: "snapshot copies run via /api/snapshot" });
      return true;
    }
    const body = await readBody(ctx.req).catch(() => ({}));
    const result = await daemon.queue.processNow(folderName, { files: body.files });
    json(res, result.ok ? 200 : 409, result);
    return true;
  }

  if (method === "POST" && pathname.startsWith("/snapshot/")) {
    const folderName = decodeURIComponent(pathname.slice("/snapshot/".length));
    const result = await daemon.snapshot.run(folderName, { trigger: "manual" });
    json(res, result.ok ? 200 : result.busy ? 409 : 400, result);
    return true;
  }

  if (method === "POST" && pathname.startsWith("/actions/")) {
    const rest = pathname.slice("/actions/".length).split("/");
    const folderName = decodeURIComponent(rest[0] ?? "");
    const fileName = decodeURIComponent(rest.slice(1).join("/"));
    const body = await readBody(ctx.req);
    const result = await runAction(daemon.ctx, daemon.queue, folderName, fileName, body.action, body);
    const status = result && result.ok === false ? (result.busy ? 409 : 500) : 200;
    json(res, status, result ?? { ok: true });
    return true;
  }

  return false;
}

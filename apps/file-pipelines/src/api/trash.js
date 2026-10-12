// Trash: list, restore (to the recorded origin or a chosen directory) and
// permanently empty.

import { emptyTrash, listTrash, restoreTrashFiles } from "../cleanup.js";
import { json, readBody } from "./http.js";

export async function handleTrash(ctx, method, pathname) {
  const { daemon, res } = ctx;

  if (method === "GET" && pathname === "/trash") {
    json(res, 200, { entries: await listTrash(daemon.ctx) });
    return true;
  }

  if (method === "POST" && pathname === "/trash/restore") {
    const body = await readBody(ctx.req);
    const targetDir = body.targetDir ? String(body.targetDir).trim() : null;
    const results = await restoreTrashFiles(daemon.ctx, body.files, { targetDir });
    json(res, 200, { results });
    return true;
  }

  if (method === "POST" && pathname === "/trash/empty") {
    await emptyTrash(daemon.ctx);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

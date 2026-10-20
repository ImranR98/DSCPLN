// Trash: list, restore (to the recorded origin or a chosen directory) and
// permanently empty.

import path from "node:path";
import { emptyTrash, listTrash, restoreTrashFiles } from "../cleanup.js";
import { expandPath } from "@dscpln/server-kit";
import { json, readBody } from "./http.js";

// Restores may only target a directory inside a configured source or
// destination tree (the body is client-supplied, so it must not be able to
// drop files anywhere the daemon can write).
function restoreRoots(daemon) {
  const roots = [];
  for (const folder of daemon.store.listFolders()) {
    const def = folder.def;
    for (const root of [def.destination, ...(def.sources ?? [])]) {
      if (root) roots.push(path.resolve(root));
    }
  }
  return roots;
}

function insideRoots(target, roots) {
  const resolved = path.resolve(target);
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

export async function handleTrash(ctx, method, pathname) {
  const { daemon, res } = ctx;

  if (method === "GET" && pathname === "/trash") {
    json(res, 200, { entries: await listTrash(daemon.ctx) });
    return true;
  }

  if (method === "POST" && pathname === "/trash/restore") {
    const body = await readBody(ctx.req);
    let targetDir = null;
    if (body.targetDir) {
      targetDir = expandPath(String(body.targetDir).trim());
      if (!insideRoots(targetDir, restoreRoots(daemon))) {
        json(res, 400, { error: "restore directory must be inside a configured source or destination" });
        return true;
      }
    }
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

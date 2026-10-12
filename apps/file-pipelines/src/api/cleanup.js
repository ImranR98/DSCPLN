// Cleanup of processed originals: preview, per-folder, and cleanup-all.
// Folders with `cleanup: false` (forever archives) are skipped entirely.

import { cleanupFiles, cleanupPreview } from "../cleanup.js";
import { json, readBody } from "./http.js";

export async function handleCleanup(ctx, method, pathname) {
  const { daemon, res } = ctx;
  if (!pathname.startsWith("/cleanup")) return false;

  if (method === "GET" && pathname.startsWith("/cleanup/")) {
    const folderName = decodeURIComponent(pathname.slice("/cleanup/".length));
    const folder = daemon.store.getFolder(folderName);
    if (!folder) {
      json(res, 404, { error: "unknown folder" });
      return true;
    }
    const files = folder.def.cleanup === false ? [] : cleanupPreview(folder);
    json(res, 200, {
      folder: folderName,
      disabled: folder.def.cleanup === false,
      files,
      totalBytes: files.reduce((s, f) => s + (f.size ?? 0), 0),
    });
    return true;
  }

  if (method === "POST" && pathname === "/cleanup-all") {
    const results = {};
    for (const folder of daemon.store.listFolders()) {
      if (folder.def.cleanup === false) continue; // archives opt out entirely
      const names = cleanupPreview(folder).map((f) => f.name);
      results[folder.def.name] = names.length > 0 ? await cleanupFiles(daemon.ctx, folder, names) : [];
    }
    json(res, 200, { results });
    return true;
  }

  if (method === "POST" && pathname.startsWith("/cleanup/")) {
    const folderName = decodeURIComponent(pathname.slice("/cleanup/".length));
    const folder = daemon.store.getFolder(folderName);
    if (!folder) {
      json(res, 404, { error: "unknown folder" });
      return true;
    }
    const body = await readBody(ctx.req);
    const names = body.names ?? cleanupPreview(folder).map((f) => f.name);
    const results = await cleanupFiles(daemon.ctx, folder, names);
    json(res, 200, { results });
    return true;
  }

  return false;
}

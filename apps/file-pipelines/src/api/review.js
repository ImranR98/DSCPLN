// Manual-placement review: list parked items and clip groups, stream parked
// audio/video with range requests, and place/discard items.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { parkPathFor } from "../park.js";
import { discardAllReview, discardReview, listReview, placeAllReview, placeReview } from "../review.js";
import { approveVoiceNoteGroup, deleteVoiceNoteGroup, listVoiceNoteGroups } from "../voicenotes-flow.js";
import { json, readBody } from "./http.js";

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4" || ext === ".m4a") return "video/mp4";
  if (ext === ".opus") return "audio/ogg";
  return "application/octet-stream";
}

export async function handleReview(ctx, method, pathname) {
  const { daemon, req, res } = ctx;

  if (method === "GET" && pathname === "/review") {
    const entries = await listReview(daemon.ctx);
    const voicenotes = await listVoiceNoteGroups(daemon.ctx);
    json(res, 200, { entries, voicenotes });
    return true;
  }

  if (method === "GET" && pathname.startsWith("/review/file/")) {
    const rest = pathname.slice("/review/file/".length).split("/");
    const folderName = decodeURIComponent(rest[0] ?? "");
    const id = decodeURIComponent(rest.slice(1).join("/"));
    const folder = daemon.store.getFolder(folderName);
    if (!folder) {
      json(res, 404, { error: "unknown folder" });
      return true;
    }
    let filePath;
    try {
      filePath = parkPathFor(daemon.config, folderName, id);
    } catch {
      json(res, 404, { error: "not found" });
      return true;
    }
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      json(res, 404, { error: "not found" });
      return true;
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    let start = 0;
    let end = stat.size - 1;
    if (range) {
      start = range[1] === "" ? Math.max(0, stat.size - Number(range[2])) : Number(range[1]);
      end = range[2] === "" ? stat.size - 1 : Math.min(Number(range[2]), stat.size - 1);
      if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return true;
      }
    }
    res.writeHead(range ? 206 : 200, {
      "Content-Type": contentTypeFor(filePath),
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath, { start, end }).on("error", () => res.end()).pipe(res);
    return true;
  }

  if (method === "POST" && (pathname === "/review/voicenotes/approve" || pathname === "/review/voicenotes/delete")) {
    const body = await readBody(req);
    const folder = daemon.store.getFolder(String(body.folder ?? ""));
    if (!folder) {
      json(res, 404, { error: "unknown folder" });
      return true;
    }
    const action = pathname.endsWith("/approve") ? approveVoiceNoteGroup : deleteVoiceNoteGroup;
    const result = await action(daemon.ctx, folder, {
      chat: String(body.chat ?? ""),
      date: String(body.date ?? ""),
      file: body.file == null ? undefined : String(body.file),
    });
    if (result?.ok === false && result.busy) {
      json(res, 409, result);
      return true;
    }
    json(res, 200, result);
    return true;
  }

  if (method === "POST" && (pathname === "/review/place" || pathname === "/review/discard")) {
    const body = await readBody(req);
    const folder = daemon.store.getFolder(String(body.folder ?? ""));
    if (!folder) {
      json(res, 404, { error: "unknown folder" });
      return true;
    }
    const place = pathname.endsWith("/place");
    const ids = body.ids ?? (body.id ? [body.id] : []);
    if (!Array.isArray(ids) || ids.length === 0) {
      json(res, 400, { error: "id or ids required" });
      return true;
    }
    const results = [];
    for (const id of ids) {
      results.push({
        id: String(id),
        ...(place
          ? await placeReview(daemon.ctx, folder, String(id), { replace: body.replace === true })
          : await discardReview(daemon.ctx, folder, String(id))),
      });
    }
    json(res, 200, { results });
    return true;
  }

  if (method === "POST" && (pathname === "/review/place-all" || pathname === "/review/discard-all")) {
    const body = await readBody(req);
    const folder = daemon.store.getFolder(String(body.folder ?? ""));
    if (!folder) {
      json(res, 404, { error: "unknown folder" });
      return true;
    }
    const place = pathname.endsWith("/place-all");
    const results = place
      ? await placeAllReview(daemon.ctx, folder)
      : await discardAllReview(daemon.ctx, folder);
    json(res, 200, { results });
    return true;
  }

  return false;
}

import fsp from "node:fs/promises";
import path from "node:path";
import { listParked, parkPathFor, readParkManifest, removeParked, writeParkManifest } from "./park.js";
import { STATUS } from "./store.js";
import { DestExistsError, moveIntoPlace } from "./processors/place.js";
import { sha256File } from "./util.js";

// "Manual placement" flow: the daemon processes files into the review park
// instead of writing to the destination; the user approves each item from the
// UI. Placing is an atomic same-filesystem rename with the destination's
// never-overwrite rules intact.

export async function parkOutput(ctx, folder, meta, stagedPath) {
  const { config, store } = ctx;
  const dir = path.dirname(parkPathFor(config, folder.def.name, meta.destName));
  await fsp.mkdir(dir, { recursive: true });
  const parkPath = parkPathFor(config, folder.def.name, meta.destName);
  // A re-processed group replaces its previous (still unplaced) park entry.
  if (await exists(parkPath)) {
    await removeParked(config, folder.def.name, meta.destName);
  }
  await moveIntoPlace(stagedPath, parkPath);
  const stat = await fsp.stat(parkPath);
  const manifest = {
    folder: folder.def.name,
    destName: meta.destName,
    chat: meta.chat ?? null,
    date: meta.date ?? null,
    inputs: meta.inputs ?? [],
    expectedDuration: meta.expectedDuration ?? null,
    size: stat.size,
    sha256: await sha256File(parkPath),
    createdAt: new Date().toISOString(),
  };
  await writeParkManifest(config, folder.def.name, manifest);
  for (const input of manifest.inputs) {
    store.updateFile(folder.def.name, input, {
      status: STATUS.REVIEW,
      destName: meta.destName,
      message: "awaiting review",
      attempts: 0,
      errorKind: null,
      nextRetryAt: 0,
    });
  }
  return manifest;
}

// Re-marks inputs of parked entries after a restart/config reload.
export async function rehydrateReview(ctx) {
  const { config, store } = ctx;
  for (const folder of store.listFolders()) {
    const parked = await listParked(config, folder.def.name).catch(() => []);
    for (const entry of parked) {
      for (const input of entry.inputs) {
        const file = store.fileFor(folder.def.name, input);
        if (!file) continue;
        store.updateFile(folder.def.name, input, {
          status: STATUS.REVIEW,
          destName: entry.destName,
          message: "awaiting review",
        });
      }
    }
  }
}

export async function listReview(ctx) {
  const { config, store } = ctx;
  const entries = [];
  for (const folder of store.listFolders()) {
    const parked = await listParked(config, folder.def.name).catch(() => []);
    for (const entry of parked) {
      const missing = entry.inputs.filter((input) => !store.fileFor(folder.def.name, input));
      entries.push({ ...entry, missingInputs: missing });
    }
  }
  return entries;
}

async function markInputs(ctx, folder, manifest, status, message) {
  const { store } = ctx;
  for (const input of manifest.inputs ?? []) {
    store.updateFile(folder.def.name, input, {
      status,
      destName: status === STATUS.DONE ? manifest.destName : null,
      message,
    });
  }
}

export async function placeReview(ctx, folder, id) {
  const { config, store } = ctx;
  const manifest = await readParkManifest(config, folder.def.name, id);
  if (!manifest) return { ok: false, reason: "review entry not found" };
  const parkPath = parkPathFor(config, folder.def.name, id);
  const stat = await fsp.stat(parkPath).catch(() => null);
  if (!stat || !stat.isFile()) return { ok: false, reason: "parked file is missing" };
  if (stat.size !== manifest.size) return { ok: false, reason: "parked file changed since it was prepared" };

  const destPath = path.join(folder.def.destination, ...manifest.destName.split("/"));
  const existing = await fsp.stat(destPath).catch(() => null);
  if (existing && existing.isFile()) {
    const destHash = await sha256File(destPath).catch(() => null);
    if (destHash === manifest.sha256) {
      await removeParked(config, folder.def.name, id);
      await markInputs(ctx, folder, manifest, STATUS.DONE, "placed (destination already had an identical file)");
      return { ok: true, alreadyPlaced: true, destName: manifest.destName };
    }
    return { ok: false, reason: `destination already has a different file named ${manifest.destName}` };
  }

  try {
    await moveIntoPlace(parkPath, destPath);
  } catch (err) {
    if (err instanceof DestExistsError) {
      return { ok: false, reason: `destination already has a file named ${manifest.destName}` };
    }
    throw err;
  }
  await removeParked(config, folder.def.name, id);
  await markInputs(ctx, folder, manifest, STATUS.DONE, "placed after review");
  store.invalidateDest(folder.def.name);
  ctx.log(`placed reviewed ${manifest.destName} in ${folder.def.name}`);
  return { ok: true, destName: manifest.destName };
}

export async function discardReview(ctx, folder, id) {
  const { config } = ctx;
  const manifest = await readParkManifest(config, folder.def.name, id);
  if (!manifest) return { ok: false, reason: "review entry not found" };
  await removeParked(config, folder.def.name, id);
  await markInputs(ctx, folder, manifest, STATUS.DISCARDED, "discarded after review");
  ctx.log(`discarded reviewed ${manifest.destName} in ${folder.def.name}`);
  return { ok: true };
}

export async function placeAllReview(ctx, folder) {
  const entries = await listParked(ctx.config, folder.def.name).catch(() => []);
  const results = [];
  for (const entry of entries) {
    results.push({ id: entry.id, ...(await placeReview(ctx, folder, entry.id)) });
  }
  return results;
}

export async function discardAllReview(ctx, folder) {
  const entries = await listParked(ctx.config, folder.def.name).catch(() => []);
  const results = [];
  for (const entry of entries) {
    results.push({ id: entry.id, ...(await discardReview(ctx, folder, entry.id)) });
  }
  return results;
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

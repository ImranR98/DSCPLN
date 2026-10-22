// Small HTTP helpers shared by the API route modules. The raw body reader
// and JSON response live in server-kit; file-pipelines parses JSON bodies.

import { readBody as readText, sendJson } from "@dscpln/server-kit";

export function json(res, code, body) {
  res.setHeader("Cache-Control", "no-store");
  sendJson(res, code, body);
}

export async function readBody(req, limit = 1024 * 1024) {
  const text = (await readText(req, limit)).trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 });
  }
}

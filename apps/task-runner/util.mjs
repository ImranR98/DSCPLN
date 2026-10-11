// Pure helpers: quoting, redaction, line splitting and small formatters.

import fs from 'node:fs';

export const DAY_SECONDS = 86400;

export function shellQuote(arg) {
  const s = String(arg);
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function redactText(text, secrets) {
  for (const secret of secrets) text = text.replaceAll(secret, '***');
  return text;
}

export function splitLines(text) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export function humanAgo(ts) {
  const delta = Date.now() / 1000 - ts;
  if (delta < 3600) return `${Math.floor(delta / 60)} min ago`;
  if (delta < DAY_SECONDS) return `${Math.floor(delta / 3600)} hr ago`;
  if (delta < 30 * DAY_SECONDS) return `${Math.floor(delta / DAY_SECONDS)} days ago`;
  if (delta < 365 * DAY_SECONDS) return `${Math.floor(delta / (30 * DAY_SECONDS))} months ago`;
  return `${Math.floor(delta / (365 * DAY_SECONDS))} years ago`;
}

/* Does a path pattern exist? Glob-aware, drives the availability badge. */
export function pathFound(pattern) {
  if (/[*?\[]/.test(pattern)) {
    try {
      return fs.globSync(pattern).length > 0;
    } catch {
      return false;
    }
  }
  try {
    return fs.statSync(pattern).isDirectory();
  } catch {
    return false;
  }
}

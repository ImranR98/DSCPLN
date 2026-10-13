// {{token}} templating for task configs: ~ and $VAR expansion plus
// recursive {{a.b.c}} lookup. A template that is exactly one token resolves
// to its typed value (dict/list/int); embedded tokens are stringified.
//
// Per-run `extra` values (typed prompts, uploads) are inserted as opaque,
// shell-quoted literals: they are never re-scanned for {{tokens}} and cannot
// break out of the command line. Config `local` values stay raw (trusted;
// they may reference other tokens) and keep their ~/$VAR handling.

import os from 'node:os';
import { shellQuote } from './util.mjs';

const TILDE_RE = /^~(?=[/]|$)/;

function tilde(value) {
  return String(value).replace(TILDE_RE, os.homedir());
}

export function expand(p) {
  return tilde(p).replace(/\$(\w+)|\$\{([^}]+)\}/g, (m, a, b) => process.env[a || b] ?? '');
}

const TOKEN_RE = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

function lookup(key, local, extra) {
  if (extra && key in extra) return extra[key];
  let node = local;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node) node = node[part];
    else return undefined;
  }
  return node;
}

/* Marks a value that is already safe shell text (e.g. pre-quoted upload
 * paths) so resolve() inserts it verbatim. */
export class ShellSafe {
  constructor(value) {
    this.value = String(value);
  }
}

export function shellSafe(value) {
  return new ShellSafe(value);
}

/* Replace {{a.b.c}} tokens from local (and per-run extra). Local values may
 * reference other tokens, so resolution loops until stable. A template that
 * is exactly one token resolves to its typed value (dict/list/int); embedded
 * tokens are stringified. Extra values are shell-quoted literals. */
export function resolve(template, local, extra = {}) {
  if (typeof template !== 'string') return template;
  // Extra values are parked behind placeholders so later passes cannot
  // re-scan them for tokens or expand parts of them; local values stay raw
  // and re-resolve until stable (config values may reference tokens).
  // Private-use sentinels: printable, so they never trip control-char checks
  // and cannot appear in a normal command line.
  const literals = [];
  const protect = (literal) => {
    literals.push(literal);
    return `\uE000${literals.length - 1}\uE001`;
  };
  let result = template;
  for (let i = 0; i < 10; i++) {
    const next = result.replace(TOKEN_RE, (match, key) => {
      if (extra && key in extra) {
        const value = extra[key];
        return protect(value instanceof ShellSafe ? value.value : shellQuote(String(value)));
      }
      const value = lookup(key, local, extra);
      if (value === undefined) return match;
      return typeof value === 'string' ? tilde(value) : String(value);
    });
    if (next === result) break;
    result = next;
  }
  const full = /^\{\{([a-zA-Z0-9_.]+)\}\}$/.exec(template);
  if (full) {
    if (extra && full[1] in extra) {
      const value = extra[full[1]];
      return value instanceof ShellSafe ? value.value : shellQuote(String(value));
    }
    const value = lookup(full[1], local, extra);
    if (value === undefined) return result; // unresolved token: leave the literal template
    if (typeof value !== 'string') return value; // typed value (dict/list/int)
  }
  return result.replace(/\uE000(\d+)\uE001/g, (m, index) => literals[Number(index)]);
}

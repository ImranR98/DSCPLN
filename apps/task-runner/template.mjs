// {{token}} templating for task configs: ~ and $VAR expansion plus
// recursive {{a.b.c}} lookup. A template that is exactly one token resolves
// to its typed value (dict/list/int); embedded tokens are stringified.

import os from 'node:os';

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

/* Replace {{a.b.c}} tokens from local (and per-run extra). Values may
 * reference other tokens, so resolution loops until stable. A template that
 * is exactly one token resolves to its typed value (dict/list/int);
 * embedded tokens are stringified. */
export function resolve(template, local, extra = {}) {
  if (typeof template !== 'string') return template;
  let result = template;
  for (let i = 0; i < 10; i++) {
    const next = result.replace(TOKEN_RE, (m, key) => {
      const value = lookup(key, local, extra);
      if (value === undefined) return m;
      const s = typeof value === 'string' ? tilde(value) : String(value);
      return s;
    });
    if (next === result) break;
    result = next;
  }
  const full = /^\{\{([a-zA-Z0-9_.]+)\}\}$/.exec(template);
  if (full) {
    const value = lookup(full[1], local, extra);
    if (value === undefined) return result; // unresolved token: leave the literal template
    if (typeof value !== 'string') return value;
    return result;
  }
  return result;
}

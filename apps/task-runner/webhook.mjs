// Generic webhook action for Task Runner.
//
// With `tokenFile`, the client generates the bearer token on first use (0600),
// sends it to `enrollUrl` when configured, and then to the webhook endpoint.
// The agent stores only a hash; no manual token setup is required.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, shellSafe } from './template.mjs';
import { redactText } from './util.mjs';

const TOKEN_MIN_LENGTH = 32;
const JSON_MAX_BYTES = 1024 * 1024;
const DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;

function validToken(value) {
  return value.length >= TOKEN_MIN_LENGTH && value.length <= 512 && !/\s/.test(value);
}

export function ensureTokenFile(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (!validToken(existing)) {
      throw new Error(`${file} does not contain a valid token (delete it to generate a new one)`);
    }
    fs.chmodSync(file, 0o600);
    return { token: existing, generated: false };
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  try {
    fs.writeFileSync(file, `${token}\n`, { flag: 'wx', mode: 0o600 });
    return { token, generated: true };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (!validToken(existing)) throw new Error(`${file} does not contain a valid token`, { cause: e });
    fs.chmodSync(file, 0o600);
    return { token: existing, generated: false };
  }
}

function valueExtra(token, extra) {
  const values = {};
  for (const [key, value] of Object.entries(extra ?? {})) {
    // Upload paths are already shell-quoted for commands; they are not useful
    // in HTTP fields, so leave them out.
    if (key === 'uploads') continue;
    values[key] = shellSafe(String(value));
  }
  if (token) values.token = shellSafe(token);
  return values;
}

function resolveValue(value, local, token, extra) {
  if (typeof value === 'string') return resolve(value, local, valueExtra(token, extra));
  if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, local, token, extra));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, local, token, extra)]));
  }
  return value;
}

function normalizeHeaders(value, local, token, extra) {
  const resolved = resolveValue(value ?? {}, local, token, extra);
  const headers = {};
  for (const [key, entry] of Object.entries(resolved)) {
    if (entry === undefined || entry === null) continue;
    headers[key] = String(entry);
  }
  return headers;
}

function tlsOptions(webhook, cwd) {
  const out = {};
  for (const [field, key] of [['caFile', 'ca'], ['certFile', 'cert'], ['keyFile', 'key']]) {
    if (webhook[field]) out[key] = fs.readFileSync(path.resolve(cwd, webhook[field]));
  }
  return out;
}

function expectStatus(webhook, status) {
  if (Array.isArray(webhook.expectStatus)) return webhook.expectStatus.includes(status);
  if (Number.isInteger(webhook.expectStatus)) return webhook.expectStatus === status;
  return status >= 200 && status < 300;
}

function openRequest({ url, method, headers, body, timeoutMs, signal, tls }) {
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? https : http;
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error(`unsupported URL protocol: ${target.protocol}`);
  }
  return new Promise((resolvePromise, reject) => {
    const req = transport.request(target, {
      method,
      headers,
      signal,
      ...(target.protocol === 'https:' ? tls : {}),
    }, (res) => resolvePromise(res));
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs} ms`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function readBody(res, maxBytes) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of res) {
      size += chunk.length;
      if (size > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
      chunks.push(chunk);
    }
  } catch (e) {
    res.destroy();
    throw e;
  }
  return Buffer.concat(chunks);
}

async function downloadBody(res, destination, maxBytes, signal) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.part-${process.pid}-${Date.now()}`;
  let size = 0;
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) callback(new Error(`download exceeds ${maxBytes} bytes`));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(res, counter, fs.createWriteStream(temp, { mode: 0o600 }), { signal });
    await fsp.rename(temp, destination);
    await fsp.chmod(destination, 0o600);
    return size;
  } catch (e) {
    await fsp.rm(temp, { force: true });
    throw e;
  }
}

function summaryFrom(webhook, res, body) {
  if (webhook.summaryHeader) {
    const value = res.headers[String(webhook.summaryHeader).toLowerCase()];
    if (value) return String(Array.isArray(value) ? value[0] : value).slice(0, 500);
  }
  let parsed = null;
  const contentType = String(res.headers['content-type'] ?? '');
  if (body?.length && (contentType.includes('json') || webhook.summaryJson)) {
    try { parsed = JSON.parse(body.toString('utf8')); } catch { /* not JSON */ }
  }
  if (webhook.summaryJson && parsed) {
    let node = parsed;
    for (const part of String(webhook.summaryJson).split('.')) {
      node = node?.[part];
    }
    if (node !== undefined) return String(node).slice(0, 500);
  }
  if (parsed && typeof parsed.summary === 'string') return parsed.summary.slice(0, 500);
  if (parsed && typeof parsed.error === 'string') return parsed.error.slice(0, 500);
  const text = body?.toString('utf8').trim().split(/\r?\n/).find(Boolean);
  return text ? text.slice(0, 500) : `HTTP ${res.statusCode}`;
}

function isRedirect(status) {
  return status >= 300 && status < 400;
}

export async function runWebhook({ webhook, local, log, redact, cwd, runAs, signal, extra }) {
  const safe = (text) => redactText(String(text), redact);
  let token = '';
  try {
    if (webhook.tokenFile) {
      const tokenPath = path.resolve(cwd, String(resolve(webhook.tokenFile, local)));
      const ensured = ensureTokenFile(tokenPath);
      token = ensured.token;
      redact.push(token);
      if (ensured.generated) log(safe(`generated webhook token at ${tokenPath}`));
    }

    const tls = tlsOptions(webhook, cwd);
    if (webhook.enrollUrl) {
      if (!token) throw new Error('enrollUrl requires tokenFile');
      const enrollUrl = String(resolve(webhook.enrollUrl, local));
      const response = await openRequest({
        url: enrollUrl,
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: undefined,
        timeoutMs: Math.min(Number(webhook.timeoutMs ?? 300_000), 60_000),
        signal,
        tls,
      });
      const body = await readBody(response, JSON_MAX_BYTES);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`enrollment failed: HTTP ${response.statusCode} ${body.toString('utf8').trim().slice(0, 300)}`);
      }
    }

    const url = String(resolve(webhook.url, local, valueExtra(token, extra)));
    const method = String(webhook.method ?? 'POST').toUpperCase();
    const headers = normalizeHeaders(webhook.headers, local, token, extra);
    if (token && !Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')) {
      headers.Authorization = `Bearer ${token}`;
    }
    let body;
    if (webhook.body !== undefined && webhook.body !== null) {
      const resolved = resolveValue(webhook.body, local, token, extra);
      body = typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }

    log(safe(`webhook ${method} ${url}`));
    const response = await openRequest({
      url,
      method,
      headers,
      body,
      timeoutMs: Number(webhook.timeoutMs ?? 300_000),
      signal,
      tls,
    });

    if (isRedirect(response.statusCode) && response.headers.location) {
      const redirect = new URL(response.headers.location, url).toString();
      response.resume();
      throw new Error(`webhook redirected to ${redirect}; set the final URL in config`);
    }
    if (!expectStatus(webhook, response.statusCode)) {
      const errorBody = await readBody(response, JSON_MAX_BYTES);
      throw new Error(`webhook failed: HTTP ${response.statusCode} ${errorBody.toString('utf8').trim().slice(0, 300)}`);
    }

    if (webhook.downloadTo) {
      const destination = path.resolve(cwd, String(resolve(webhook.downloadTo, local)));
      const size = await downloadBody(response, destination, Number(webhook.maxBytes ?? DOWNLOAD_MAX_BYTES), signal);
      if (runAs?.uid !== undefined) {
        fs.chownSync(destination, runAs.uid, runAs.gid ?? runAs.uid);
      }
      const summary = `downloaded ${size} bytes to ${destination}`;
      log(safe(summary));
      return { ok: true, summary };
    }

    const responseBody = await readBody(response, JSON_MAX_BYTES);
    const summary = summaryFrom(webhook, response, responseBody);
    log(safe(summary));
    return { ok: true, summary };
  } catch (e) {
    const message = signal?.aborted ? 'cancelled' : String(e.message ?? e);
    log(safe(`webhook ERROR: ${message}`));
    return { ok: false, summary: message };
  }
}

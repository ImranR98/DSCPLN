// Token handling for the archive agent.
//
// The Task Runner client generates the token on first use and stores it
// locally (0600). The agent stores only a SHA-256 hash in its state directory.
// The first enrollment is trust-on-first-use, restricted by source CIDR and an
// optional startup window; deploy the agent on a private network and firewall
// it to the Task Runner.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_MIN_LENGTH = 32;
const HASH_RE = /^[0-9a-f]{64}$/;

export function tokenHashFile(stateDir) {
  return path.join(stateDir, 'token.sha256');
}

export function normalizeAddress(address) {
  const value = String(address ?? '').split('%')[0];
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

export function isToken(value) {
  const token = String(value ?? '');
  return token.length >= TOKEN_MIN_LENGTH && token.length <= 512 && !/\s/.test(token);
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function ipv4ToInt(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value * 256) + octet;
  }
  return value >>> 0;
}

function ipv4InCidr(address, cidr) {
  const [network, bitsRaw] = String(cidr).split('/');
  const ip = ipv4ToInt(address);
  const base = ipv4ToInt(network);
  if (ip === null || base === null) return false;
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

export function ipAllowed(address, allowFrom) {
  const value = normalizeAddress(address);
  for (const entryRaw of allowFrom ?? []) {
    const entry = String(entryRaw).trim();
    if (!entry) continue;
    if (value === entry) return true;
    if (value === '::1' && (entry === '::1' || entry === '::1/128')) return true;
    if (ipv4InCidr(value, entry)) return true;
  }
  return false;
}

export function readTokenHash(stateDir) {
  try {
    const value = fs.readFileSync(tokenHashFile(stateDir), 'utf8').trim().toLowerCase();
    return HASH_RE.test(value) ? value : null;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function matchHash(hash, token) {
  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function storeHash(stateDir, token) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(tokenHashFile(stateDir), `${hashToken(token)}\n`, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return false;
  }
}

export function enroll({ stateDir, token, remoteAddress, enrollment, startedAt, now = Date.now() }) {
  if (!isToken(token)) return { ok: false, status: 401, reason: 'invalid token' };
  const existing = readTokenHash(stateDir);
  if (existing) {
    return matchHash(existing, token)
      ? { ok: true, enrolled: false }
      : { ok: false, status: 401, reason: 'invalid token' };
  }
  if (!enrollment?.enabled) {
    return { ok: false, status: 403, reason: 'enrollment is disabled' };
  }
  const windowMs = Number(enrollment.windowSeconds ?? 0) * 1000;
  if (windowMs > 0 && now - startedAt > windowMs) {
    return { ok: false, status: 403, reason: 'enrollment window has closed' };
  }
  if (!ipAllowed(remoteAddress, enrollment.allowFrom)) {
    return { ok: false, status: 403, reason: 'source address is not allowed to enroll' };
  }
  try {
    if (storeHash(stateDir, token)) return { ok: true, enrolled: true };
  } catch (e) {
    return { ok: false, status: 500, reason: `could not store token hash: ${e.message}` };
  }
  // Another request won the race; only the matching token is accepted.
  const raced = readTokenHash(stateDir);
  return raced && matchHash(raced, token)
    ? { ok: true, enrolled: false }
    : { ok: false, status: 401, reason: 'invalid token' };
}

export function verify({ stateDir, token }) {
  if (!isToken(token)) return { ok: false, reason: 'invalid token' };
  const existing = readTokenHash(stateDir);
  if (!existing) return { ok: false, reason: 'agent is not enrolled' };
  return matchHash(existing, token)
    ? { ok: true }
    : { ok: false, reason: 'invalid token' };
}

// Agent configuration: JSON, small and intentionally explicit. The public
// example uses generic /data paths; deployments mount their own config.

import fs from 'node:fs';
import path from 'node:path';

export class ConfigError extends Error {}

const DEFAULT_WINDOW_SECONDS = 0;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 30 * 60;
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value, label, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new ConfigError(`${label} must be a positive integer`);
  }
  return number;
}

export function loadConfig(configPath) {
  const file = path.resolve(configPath);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ConfigError(`Cannot read ${file}: ${e.message}`);
  }
  if (!isPlainObject(raw)) throw new ConfigError('Config must be a JSON object');

  const listen = String(raw.listen ?? '0.0.0.0');
  const port = positiveInteger(raw.port, 'port', 8788);
  if (port > 65535) throw new ConfigError('port must be <= 65535');

  const stateDir = path.resolve(String(raw.stateDir ?? '/state'));

  const enrollmentRaw = raw.enrollment ?? {};
  if (!isPlainObject(enrollmentRaw)) throw new ConfigError('enrollment must be an object');
  const allowFrom = enrollmentRaw.allowFrom ?? [
    '127.0.0.1/32',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
  ];
  if (!Array.isArray(allowFrom) || allowFrom.length === 0 || allowFrom.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new ConfigError('enrollment.allowFrom must be a non-empty list of CIDRs');
  }
  const windowSeconds = enrollmentRaw.windowSeconds === undefined
    ? DEFAULT_WINDOW_SECONDS
    : Number(enrollmentRaw.windowSeconds);
  if (!Number.isInteger(windowSeconds) || windowSeconds < 0) {
    throw new ConfigError('enrollment.windowSeconds must be a non-negative integer');
  }
  const enrollment = {
    enabled: enrollmentRaw.enabled !== false,
    allowFrom: allowFrom.map((entry) => entry.trim()),
    windowSeconds,
  };

  const jobsRaw = raw.jobs;
  if (!isPlainObject(jobsRaw) || Object.keys(jobsRaw).length === 0) {
    throw new ConfigError('jobs must be a non-empty object');
  }
  const jobs = {};
  for (const [id, jobRaw] of Object.entries(jobsRaw)) {
    if (!JOB_ID_RE.test(id)) throw new ConfigError(`Invalid job id '${id}'`);
    if (!isPlainObject(jobRaw)) throw new ConfigError(`Job '${id}' must be an object`);
    const type = String(jobRaw.type ?? 'archive');
    if (type !== 'archive') throw new ConfigError(`Job '${id}': unsupported type '${type}'`);
    const root = String(jobRaw.root ?? '').trim();
    if (!root || !path.isAbsolute(root)) {
      throw new ConfigError(`Job '${id}': root must be an absolute path`);
    }
    const format = String(jobRaw.format ?? 'tar.gz');
    if (format !== 'tar.gz') throw new ConfigError(`Job '${id}': only tar.gz is supported`);
    const exclude = jobRaw.exclude ?? [];
    if (!Array.isArray(exclude) || exclude.some((entry) => typeof entry !== 'string' || !entry)) {
      throw new ConfigError(`Job '${id}': exclude must be a list of non-empty strings`);
    }
    const include = jobRaw.include ?? [];
    if (!Array.isArray(include) || include.some((entry) => typeof entry !== 'string' || !entry)) {
      throw new ConfigError(`Job '${id}': include must be a list of non-empty relative patterns`);
    }
    for (const pattern of include) {
      if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..') || pattern.includes('\0') || /[\r\n]/.test(pattern)) {
        throw new ConfigError(`Job '${id}': include pattern must be relative and contain no '..': ${pattern}`);
      }
    }
    jobs[id] = {
      id,
      type,
      root,
      include: [...include],
      exclude: [...exclude],
      format,
      maxBytes: positiveInteger(jobRaw.maxBytes, `Job '${id}': maxBytes`, DEFAULT_MAX_BYTES),
      timeoutSeconds: positiveInteger(jobRaw.timeoutSeconds, `Job '${id}': timeoutSeconds`, DEFAULT_TIMEOUT_SECONDS),
    };
  }

  let tls = null;
  if (raw.tls !== undefined) {
    if (!isPlainObject(raw.tls)) throw new ConfigError('tls must be an object');
    const certFile = String(raw.tls.certFile ?? '').trim();
    const keyFile = String(raw.tls.keyFile ?? '').trim();
    if (!certFile || !keyFile) throw new ConfigError('tls needs certFile and keyFile');
    tls = { certFile: path.resolve(certFile), keyFile: path.resolve(keyFile) };
  }

  return { listen, port, stateDir, enrollment, jobs, tls };
}

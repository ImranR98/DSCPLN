// Agent configuration: JSON, small and intentionally explicit. The public
// example uses generic /data paths; deployments mount their own config.

import fs from 'node:fs';
import path from 'node:path';

export class ConfigError extends Error {}

const DEFAULT_WINDOW_SECONDS = 0;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 30 * 60;
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESULT_PATH_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

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

function absolutePath(value, label, { required = true } = {}) {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!raw) {
    if (required) throw new ConfigError(`${label} must be an absolute path`);
    return undefined;
  }
  if (!path.isAbsolute(raw)) throw new ConfigError(`${label} must be an absolute path`);
  return path.resolve(raw);
}

function stringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ConfigError(`${label} must be a list of strings`);
  }
  return [...value];
}

function validateResult(value, id) {
  if (value === undefined) return null;
  const label = `Job '${id}': result`;
  if (!isPlainObject(value)) throw new ConfigError(`${label} must be an object`);
  const json = value.json === undefined ? '' : String(value.json).trim();
  if (json && !RESULT_PATH_RE.test(json)) {
    throw new ConfigError(`${label}.json must be a dot-separated JSON path`);
  }
  const summary = value.summary === undefined ? '' : String(value.summary);
  const requireRaw = value.require ?? {};
  if (!isPlainObject(requireRaw)) throw new ConfigError(`${label}.require must be an object`);
  const require = {};
  for (const [key, minimum] of Object.entries(requireRaw)) {
    if (!RESULT_PATH_RE.test(key)) {
      throw new ConfigError(`${label}.require.${key} must be a dot-separated JSON path`);
    }
    if (typeof minimum !== 'number' || !Number.isFinite(minimum)) {
      throw new ConfigError(`${label}.require.${key} must be a number`);
    }
    require[key] = minimum;
  }
  return { json, summary, require };
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
    const timeoutSeconds = positiveInteger(
      jobRaw.timeoutSeconds,
      `Job '${id}': timeoutSeconds`,
      DEFAULT_TIMEOUT_SECONDS
    );

    if (type === 'archive') {
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
        ignoreReadErrors: jobRaw.ignoreReadErrors === true,
        format,
        maxBytes: positiveInteger(jobRaw.maxBytes, `Job '${id}': maxBytes`, DEFAULT_MAX_BYTES),
        timeoutSeconds,
      };
      continue;
    }

    if (type === 'process') {
      const binary = absolutePath(jobRaw.binary, `Job '${id}': binary`);
      const configDir = absolutePath(jobRaw.configDir, `Job '${id}': configDir`);
      const outputDir = absolutePath(jobRaw.outputDir, `Job '${id}': outputDir`, { required: false });
      const home = absolutePath(jobRaw.home, `Job '${id}': home`, { required: false });
      const configFileRaw = jobRaw.configFile;
      const configFile = configFileRaw === undefined || configFileRaw === null
        ? null
        : String(configFileRaw).trim();
      if (configFile !== null && (
        !configFile
        || configFile === '.'
        || configFile === '..'
        || configFile.includes('/')
        || configFile.includes('\\')
        || configFile.includes('\0')
        || /[\r\n]/.test(configFile)
      )) {
        throw new ConfigError(`Job '${id}': configFile must be a file name`);
      }
      const args = stringList(jobRaw.args, `Job '${id}': args`);
      if (args.some((arg) => arg.includes('{configFile}') && !configFile)) {
        throw new ConfigError(`Job '${id}': args use {configFile} but configFile is not set`);
      }
      if (args.some((arg) => arg.includes('{outputDir}') && !outputDir)) {
        throw new ConfigError(`Job '${id}': args use {outputDir} but outputDir is not set`);
      }
      jobs[id] = {
        id,
        type,
        binary,
        args,
        configDir,
        configFile,
        outputDir,
        home,
        timeoutSeconds,
        maxStdoutBytes: positiveInteger(
          jobRaw.maxStdoutBytes,
          `Job '${id}': maxStdoutBytes`,
          DEFAULT_MAX_STDOUT_BYTES
        ),
        result: validateResult(jobRaw.result, id),
      };
      continue;
    }

    throw new ConfigError(`Job '${id}': unsupported type '${type}'`);
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

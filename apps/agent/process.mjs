// Process job execution: a deployment-configured binary with fixed args, an
// optional request-supplied config file, and an optional output directory.
// The request never supplies a command or a path; all of that comes from the
// agent config.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class ProcessError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

const MAX_STDERR_BYTES = 64 * 1024;
const SUMMARY_MAX = 500;

function getPath(node, dotted) {
  if (!dotted) return node;
  let current = node;
  for (const part of dotted.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function formatSummary(template, node) {
  return String(template).replace(/\{([A-Za-z0-9_.]+)\}/g, (_, key) => {
    const value = getPath(node, key);
    return value === undefined || value === null ? '' : String(value);
  });
}

function lastLine(text) {
  const lines = String(text).trim().split(/\r?\n/).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function summarize(job, stdout) {
  const result = job.result;
  if (!result) return lastLine(stdout) || `process ${job.id} exited 0`;

  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Not JSON: the require check below still fails when one is configured.
  }
  const node = parsed && result.json ? getPath(parsed, result.json) : parsed;

  for (const [key, minimum] of Object.entries(result.require)) {
    const value = node === undefined || node === null ? undefined : getPath(node, key);
    if (typeof value !== 'number' || value < minimum) {
      throw new ProcessError(
        `result check failed: ${key}=${value === undefined ? 'missing' : value} (minimum ${minimum})`,
        500
      );
    }
  }

  if (result.summary) {
    const formatted = formatSummary(result.summary, node).trim();
    if (formatted) return formatted.slice(0, SUMMARY_MAX);
  }
  if (parsed && typeof parsed.summary === 'string') return parsed.summary.slice(0, SUMMARY_MAX);
  return (lastLine(stdout) || `process ${job.id} exited 0`).slice(0, SUMMARY_MAX);
}

function resolveArgs(job) {
  const replacements = {
    '{configDir}': job.configDir,
    '{configFile}': job.configFile ? path.join(job.configDir, job.configFile) : '',
    '{outputDir}': job.outputDir ?? '',
  };
  return job.args.map((arg) => {
    let value = arg;
    for (const [token, replacement] of Object.entries(replacements)) {
      value = value.split(token).join(replacement);
    }
    return value;
  });
}

function writeConfig(job, body) {
  const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '');
  if (job.configFile && bodyBuffer.length === 0) {
    throw new ProcessError('request body is required for this job', 400);
  }
  if (!job.configFile && bodyBuffer.length > 0) {
    throw new ProcessError('job does not accept a request body', 400);
  }
  if (!job.configFile) return;

  fs.mkdirSync(job.configDir, { recursive: true, mode: 0o700 });
  const configPath = path.join(job.configDir, job.configFile);
  const temp = `${configPath}.new-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temp, bodyBuffer, { mode: 0o600 });
    fs.renameSync(temp, configPath);
  } catch (e) {
    fs.rmSync(temp, { force: true });
    throw new ProcessError(`could not write ${configPath}: ${e.message}`, 500);
  }
}

export async function runProcess(job, workDir, { body, signal } = {}) {
  if (signal?.aborted) throw new ProcessError('process cancelled', 499);
  try {
    fs.accessSync(job.binary, fs.constants.X_OK);
  } catch (e) {
    throw new ProcessError(`binary is not executable: ${job.binary} (${e.message})`, 500);
  }
  if (job.home) {
    let homeOk;
    try {
      homeOk = fs.statSync(job.home).isDirectory();
    } catch {
      homeOk = false;
    }
    if (!homeOk) throw new ProcessError(`home is not a directory: ${job.home}`, 500);
  }

  writeConfig(job, body);
  fs.mkdirSync(path.join(job.configDir, '.cache'), { recursive: true, mode: 0o700 });
  if (job.outputDir) fs.mkdirSync(job.outputDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(workDir, `${job.id}-`));
  const started = Date.now();

  try {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stdoutExceeded = false;
    let timedOut = false;

    const child = spawn(job.binary, resolveArgs(job), {
      cwd: dir,
      env: {
        ...process.env,
        LC_ALL: 'C',
        ...(job.home ? { HOME: job.home } : {}),
        XDG_CACHE_HOME: path.join(job.configDir, '.cache'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, job.timeoutSeconds * 1000);
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > job.maxStdoutBytes) {
        stdoutExceeded = true;
        child.kill('SIGKILL');
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString('utf8');
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve();
      };
      child.on('error', (e) => {
        finish(new ProcessError(`could not start ${job.binary}: ${e.message}`, 500));
      });
      child.on('close', (code, sig) => {
        if (signal?.aborted) {
          finish(new ProcessError('process cancelled', 499));
        } else if (timedOut) {
          finish(new ProcessError('process timed out', 504));
        } else if (stdoutExceeded) {
          finish(new ProcessError(`stdout exceeds ${job.maxStdoutBytes} bytes`, 500));
        } else if (code !== 0) {
          const detail = stderr.trim().slice(0, 500);
          finish(new ProcessError(
            `process failed (exit ${code ?? sig})${detail ? `: ${detail}` : ''}`,
            500
          ));
        } else {
          finish();
        }
      });
    });

    return {
      summary: summarize(job, stdout),
      durationMs: Date.now() - started,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

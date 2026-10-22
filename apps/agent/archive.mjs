// Archive job execution: fixed tar/gzip invocation, no shell, no
// request-supplied paths. The configured root is resolved once per run.

import crypto from 'node:crypto';
import fs, { globSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class ArchiveError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function createArchive(job, workDir, { signal, timeoutSeconds = job.timeoutSeconds } = {}) {
  let root;
  try {
    root = fs.realpathSync(job.root);
    if (!fs.statSync(root).isDirectory()) throw new Error('root is not a directory');
  } catch (e) {
    throw new ArchiveError(`job root is not readable: ${e.message}`, 500);
  }

  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(workDir, `${job.id}-`));
  const archive = path.join(dir, 'archive.tar.gz');
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    const args = ['-czf', archive, '-C', root];
    if (job.ignoreReadErrors) args.push('--ignore-failed-read', '--warning=no-file-removed');
    for (const pattern of job.exclude ?? []) args.push(`--exclude=${pattern}`);
    if (job.include?.length) {
      const matches = new Set();
      for (const pattern of job.include) {
        for (const match of globSync(pattern, { cwd: root })) {
          if (path.isAbsolute(match) || match.split(path.sep).includes('..')) {
            throw new ArchiveError(`include pattern resolved outside the root: ${match}`, 500);
          }
          matches.add(match);
        }
      }
      const list = [...matches].sort();
      if (!list.length) {
        throw new ArchiveError('no files matched the include patterns', 404);
      }
      const listFile = path.join(dir, 'files.list');
      fs.writeFileSync(listFile, `${list.join('\0')}\0`, { mode: 0o600 });
      args.push('--null', '--files-from', listFile);
    } else {
      args.push('.');
    }

    await new Promise((resolve, reject) => {
      const child = spawn('tar', args, {
        env: { ...process.env, LC_ALL: 'C' },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      let settled = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, Math.max(1, Number(timeoutSeconds ?? 1800)) * 1000);
      const abort = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', abort, { once: true });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 64 * 1024) stderr += chunk.toString();
      });
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(new ArchiveError(`could not start tar: ${e.message}`, 500));
      });
      child.on('close', (code, sig) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) {
          reject(new ArchiveError('archive cancelled', 499));
        } else if (timedOut) {
          reject(new ArchiveError('archive timed out', 504));
        } else if (code !== 0) {
          reject(new ArchiveError(`tar failed (exit ${code ?? sig}): ${stderr.trim().slice(0, 500)}`, 500));
        } else {
          resolve();
        }
      });
    });

    const size = fs.statSync(archive).size;
    if (size > job.maxBytes) {
      throw new ArchiveError(`archive exceeds maxBytes (${size} > ${job.maxBytes})`, 413);
    }
    const sha256 = await hashFile(archive);
    return { archive, size, sha256, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

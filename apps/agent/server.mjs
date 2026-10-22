#!/usr/bin/env node
// Generic archive agent for D$CPLN Task Runner.
//
// The agent exposes only configured archive jobs. It never accepts a path or a
// command from the request. The Task Runner generates the bearer token on first
// use and enrolls it here; the agent stores only a SHA-256 hash.

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ArchiveError, createArchive } from './archive.mjs';
import { enroll, verify } from './auth.mjs';
import { ConfigError, loadConfig } from './config.mjs';

export const SERVICE_NAME = 'dscpln-agent';

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  return match?.[1]?.trim() ?? '';
}

function hasBody(req) {
  return Number(req.headers['content-length'] ?? 0) > 0 || Boolean(req.headers['transfer-encoding']);
}

function jobFromPath(pathname) {
  const match = /^\/v1\/jobs\/([^/]+)\/archive$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function createAgentServer(config) {
  fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const workDir = path.join(config.stateDir, 'work');
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const startedAt = Date.now();
  let busy = false;

  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://agent.local');
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true, service: SERVICE_NAME });
      }

      if (req.method === 'POST' && url.pathname === '/v1/enroll') {
        if (hasBody(req)) {
          req.resume();
          return json(res, 400, { error: 'enrollment takes no body' });
        }
        const result = enroll({
          stateDir: config.stateDir,
          token: bearer(req),
          remoteAddress: req.socket.remoteAddress,
          enrollment: config.enrollment,
          startedAt,
        });
        if (!result.ok) {
          return json(res, result.status ?? 401, { error: result.reason ?? 'enrollment failed' });
        }
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        return res.end();
      }

      const jobId = jobFromPath(url.pathname);
      if (req.method === 'POST' && jobId) {
        if (hasBody(req)) {
          req.resume();
          return json(res, 400, { error: 'archive requests take no body' });
        }
        const token = bearer(req);
        const auth = verify({ stateDir: config.stateDir, token });
        if (!auth.ok) {
          res.setHeader('WWW-Authenticate', 'Bearer');
          return json(res, 401, { error: auth.reason ?? 'unauthorized' });
        }
        const job = Object.prototype.hasOwnProperty.call(config.jobs, jobId) ? config.jobs[jobId] : null;
        if (!job) return json(res, 404, { error: 'unknown job' });
        if (job.type !== 'archive') return json(res, 400, { error: 'job is not an archive job' });
        if (busy) return json(res, 429, { error: 'agent is busy' });

        busy = true;
        let result;
        try {
          const controller = new AbortController();
          req.on('aborted', () => controller.abort());
          result = await createArchive(job, workDir, { signal: controller.signal });
          if (res.destroyed || controller.signal.aborted) return;

          res.writeHead(200, {
            'Content-Type': 'application/gzip',
            'Content-Length': result.size,
            'Content-Disposition': `attachment; filename="${jobId}.tar.gz"`,
            'Cache-Control': 'no-store',
            'X-DSCPLN-SHA256': result.sha256,
            'X-DSCPLN-Summary': `archive ${jobId} ${result.size} bytes`,
          });
          await new Promise((resolve, reject) => {
            const stream = fs.createReadStream(result.archive);
            stream.on('error', reject);
            stream.on('end', resolve);
            res.on('close', resolve);
            stream.pipe(res);
          });
        } finally {
          result?.cleanup?.();
          busy = false;
        }
        return;
      }

      return json(res, 404, { error: 'not found' });
    } catch (e) {
      const status = e instanceof ArchiveError ? e.status : 500;
      const message = e instanceof ArchiveError ? e.message : 'internal error';
      if (!(e instanceof ArchiveError)) console.error(`agent error: ${e.stack ?? e.message}`);
      if (res.headersSent) {
        res.destroy();
      } else {
        json(res, status === 499 ? 499 : status, { error: message });
      }
    }
  };

  const server = config.tls
    ? https.createServer({
      cert: fs.readFileSync(config.tls.certFile),
      key: fs.readFileSync(config.tls.keyFile),
    }, handler)
    : http.createServer(handler);
  // Archives can legitimately take longer than Node's 5 minute request limit.
  server.requestTimeout = 0;
  return server;
}

export function startAgent(config) {
  const server = createAgentServer(config);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.listen, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

async function main() {
  const configPath = process.env.DSCPLN_AGENT_CONFIG ?? '/config/agent.json';
  let config;
  try {
    config = loadConfig(configPath);
  } catch (e) {
    console.error(`config error: ${e instanceof ConfigError ? e.message : e.stack ?? e.message}`);
    process.exit(2);
  }
  const server = await startAgent(config);
  const address = server.address();
  const where = typeof address === 'object' && address ? `${address.address}:${address.port}` : String(address);
  console.log(`dscpln-agent listening on ${where} (${Object.keys(config.jobs).length} job(s))`);
  const stop = () => server.close(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((e) => {
    console.error(e.stack ?? e.message);
    process.exit(1);
  });
}

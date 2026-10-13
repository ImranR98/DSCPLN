/* Login-browser proxy: serves the noVNC viewer of the Selenium sidecar
 * (BROWSER_REMOTE, e.g. http://127.0.0.1:7900) at <basePath>/browser/ so the
 * task cards can embed it behind the same origin (and auth) as the app.
 * HTTP is passed through with the prefix stripped; WebSocket upgrades
 * (noVNC's websockify) are bridged the same way. */

import http from 'node:http';
import { URL } from 'node:url';

export function browserPrefix(basePath = '') {
  return `${basePath}/browser`;
}

export function browserEnabled() {
  return Boolean(process.env.BROWSER_REMOTE);
}

export function browserViewerUrl(basePath = '') {
  return browserEnabled() ? `${basePath}/browser/` : null;
}

function upstreamTarget(raw) {
  const url = new URL(raw);
  return { hostname: url.hostname, port: Number(url.port || 80), host: url.host };
}

export function createBrowserHttpHandler(raw) {
  const target = upstreamTarget(raw);
  return (req, res) => {
    const path = req.url === '' ? '/' : req.url;
    const headers = { ...req.headers, host: target.host };
    // Let the upstream compress only if the client asked; stripping keeps
    // the proxy from having to re-encode anything.
    delete headers['accept-encoding'];
    const up = http.request(
      { hostname: target.hostname, port: target.port, path, method: req.method, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('login browser unavailable');
    });
    req.pipe(up);
  };
}

export function attachBrowserWebSocket(server, basePath, raw, { isAuthorized = null } = {}) {
  const prefix = browserPrefix(basePath);
  const target = upstreamTarget(raw);
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== prefix && !req.url.startsWith(`${prefix}/`)) return;
    // Upgrades bypass express entirely, so the app's auth guard must run here.
    if (isAuthorized && !isAuthorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const path = req.url.slice(prefix.length) || '/';
    const up = http.request({
      hostname: target.hostname,
      port: target.port,
      path,
      method: req.method ?? 'GET',
      headers: { ...req.headers, host: target.host },
    });
    up.on('upgrade', (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage ?? 'Switching Protocols'}`];
      for (const [key, value] of Object.entries(upRes.headers)) lines.push(`${key}: ${value}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upHead?.length) upSocket.unshift(upHead);
      const destroy = () => {
        socket.destroy();
        upSocket.destroy();
      };
      socket.on('error', destroy);
      upSocket.on('error', destroy);
      socket.on('close', destroy);
      upSocket.on('close', destroy);
      // Upgraded sockets are half-open: a peer FIN only emits 'end', so send
      // the matching FIN to let both sides close (and then clean up).
      socket.on('end', () => {
        upSocket.end();
        socket.end();
      });
      upSocket.on('end', () => {
        socket.end();
        upSocket.end();
      });
      socket.pipe(upSocket).pipe(socket);
      // Bytes the client pipelined behind its handshake (Node removed them
      // from the socket stream into `head`).
      if (head?.length) upSocket.write(head);
    });
    up.on('response', (upRes) => {
      socket.write(`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage ?? ''}\r\n\r\n`);
      socket.destroy();
    });
    up.on('error', () => socket.destroy());
    up.end();
  });
}

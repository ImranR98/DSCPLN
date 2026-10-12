import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Notifier } from "../src/notify.js";

async function withFakeNtfy(fn) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ method: req.method, priority: req.headers.priority, body });
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/topic`;
  try {
    await fn(url, received);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const log = { log: () => {} };

test("success notifications are sent by default and can be turned off", async () => {
  await withFakeNtfy(async (url, received) => {
    const notifier = new Notifier({ ntfy: { url } }, log);
    await notifier.notify("info", "Processed photo.jpg");
    await notifier.notify("error", "Failed photo2.jpg");
    assert.equal(received.length, 2);
    assert.equal(received[0].priority, "low");
    assert.equal(received[1].priority, "high");

    const quiet = new Notifier({ ntfy: { url, notifySuccess: false } }, log);
    const skipped = await quiet.notify("info", "Processed photo3.jpg");
    assert.equal(skipped.skipped, true);
    const sent = await quiet.notify("error", "Failed photo4.jpg");
    assert.equal(sent.ok, true);
    assert.equal(received.length, 3);
    assert.match(received[2].body, /photo4/);
  });
});

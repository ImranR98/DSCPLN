import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Notifier } from "../src/notify.js";

async function withFakeRelay(fn) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ url: req.url, method: req.method, body: JSON.parse(body) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = process.env.DSCPLN_PORTAL_URL;
  process.env.DSCPLN_PORTAL_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(received);
  } finally {
    if (previous === undefined) delete process.env.DSCPLN_PORTAL_URL;
    else process.env.DSCPLN_PORTAL_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
}

const log = { log: () => {} };

test("success notifications relay through the portal and can be turned off", async () => {
  await withFakeRelay(async (received) => {
    const notifier = new Notifier({ notifySuccess: true }, log);
    await notifier.notify("info", "Processed photo.jpg");
    await notifier.notify("error", "Failed photo2.jpg");
    assert.equal(received.length, 2);
    assert.equal(received[0].method, "POST");
    assert.equal(received[0].url, "/api/notify");
    assert.equal(received[0].body.priority, "low");
    assert.equal(received[0].body.title, "D$CPLN - File Pipelines");
    assert.deepEqual(received[0].body.tags, ["white_check_mark"]);
    assert.equal(received[1].body.priority, "high");
    assert.deepEqual(received[1].body.tags, ["warning"]);

    const quiet = new Notifier({ notifySuccess: false }, log);
    const skipped = await quiet.notify("info", "Processed photo3.jpg");
    assert.equal(skipped.skipped, true);
    const sent = await quiet.notify("error", "Failed photo4.jpg");
    assert.equal(sent.ok, true);
    assert.equal(received.length, 3);
    assert.match(received[2].body.message, /photo4/);
  });
});

test("notification taps link to the app's real base path, not the old /media name", async () => {
  await withFakeRelay(async (received) => {
    const previousOrigin = process.env.DSCPLN_ORIGIN;
    const previousBase = process.env.BASE_PATH;
    process.env.DSCPLN_ORIGIN = "https://dscpln.example/";
    process.env.BASE_PATH = "/pipelines";
    try {
      const notifier = new Notifier({ notifySuccess: true }, log);
      await notifier.notify("info", "Processed photo.jpg");
      assert.equal(received[0].body.click, "https://dscpln.example/pipelines");
    } finally {
      if (previousOrigin === undefined) delete process.env.DSCPLN_ORIGIN;
      else process.env.DSCPLN_ORIGIN = previousOrigin;
      if (previousBase === undefined) delete process.env.BASE_PATH;
      else process.env.BASE_PATH = previousBase;
    }
  });
});

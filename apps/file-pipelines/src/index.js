#!/usr/bin/env node
import path from "node:path";
import { Daemon } from "./daemon.js";

function parseArgs(argv) {
  const options = { config: path.resolve("config.json"), force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") options.config = path.resolve(argv[++i]);
    else if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--bind") options.bind = argv[++i];
    else if (arg === "--force") options.force = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: file-pipelines [--config FILE] [--port N] [--bind HOST] [--force]");
      process.exit(0);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const daemon = new Daemon(options.config, options);

try {
  await daemon.start();
} catch (err) {
  console.error(`File Pipelines failed to start: ${err.message}`);
  process.exit(1);
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`received ${signal}, shutting down...`);
  try {
    await daemon.stop();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

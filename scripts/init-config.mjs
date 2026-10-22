#!/usr/bin/env node
// Copy the dscpln-config starter to a directory and initialize a git repo.
//
//   npm run init-config -- [target]
//
// The default target is ./config. Refuses to overwrite a non-empty directory.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(ROOT, 'config-template');
const target = path.resolve(process.argv[2] ?? 'config');

if (!fs.existsSync(TEMPLATE)) {
  console.error(`Error: template not found at ${TEMPLATE}`);
  process.exit(1);
}
if (fs.existsSync(target) && fs.readdirSync(target).length) {
  console.error(`Error: ${target} is not empty; choose an empty directory`);
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });
fs.cpSync(TEMPLATE, target, { recursive: true });
if (!fs.existsSync(path.join(target, '.git'))) {
  const git = spawnSync('git', ['init', '-q'], { cwd: target, stdio: 'inherit' });
  if (git.status !== 0) console.warn('warning: git init failed; initialize the repo manually');
}
console.log(`Created ${target}`);
console.log('Next:');
console.log('  1. cp secrets.example.json secrets.json   (inside the new repo)');
console.log('  2. edit config.mjs and apps/*/config.json for your machine');
console.log('  3. keep the repo private and commit the non-secret files');

// Task Runner config — the starter for your own private dscpln-config repo.
//
// Copy this folder somewhere private, keep secrets.json out of git, and point
// the Task Runner at this file (BACKUPCTL_CONFIG_FILE=/config-src/config.mjs).
// The per-app config files under apps/ are mounted into the other D$CPLN apps;
// see README.md for the full layout and environment variables.
//
// Everything here is optional: run the apps with their built-in defaults if
// you do not need central configuration.

import fs from 'node:fs';

const secrets = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('./secrets.json', import.meta.url), 'utf8'));
  } catch {
    return {};
  }
})();

export default {
  // Root of the data tree your tasks operate on.
  maindir: '~/Backups',
  manual_dir: '{{maindir}}/Manual',

  // The bundled examples ship inside the task-runner image and work without a
  // separate tools mount. Point this at '/config-src/tools' (or your mount)
  // once you add your own helper scripts.
  scriptroot: '{{repo_dir}}/apps/task-runner/examples',

  // Balance XLSX external API (Settings page shows the base URL and token).
  // The token is read from secrets.json so it never lands in this file.
  balance_url: 'http://balance-xlsx:3300/balance',
  balance_token: secrets.balance_token ?? '',
  portal_url: process.env.DSCPLN_PORTAL_URL ?? 'http://portal:8080',

  // Config tokens listed here are redacted from logged commands and output.
  secrets: ['balance_token'],

  groups: [
    {
      name: 'Everyday',
      defaults: { state_dir: '{{maindir}}/.tasks' },
      tasks: [
        {
          name: 'Disk usage',
          note: 'Writes a df snapshot next to your backups.',
          script: `
            mkdir -p '{{maindir}}'
            df -h > '{{maindir}}/disk-usage.txt'
            echo "wrote {{maindir}}/disk-usage.txt"
          `,
          summary_last_line: true,
        },
        {
          name: 'Filed downloads',
          note: 'Drop a file here to file it under Manual/ (fixed name).',
          uploads: true,
          glob: '*',
          move: { dest: '{{manual_dir}}' },
        },
        {
          name: 'Manifest dropped files',
          note: 'Drop files to write a manifest next to them.',
          uploads: true,
          glob: '*',
          script: `bash '{{scriptroot}}/hello-tool.sh' '{{manual_dir}}' {{uploads}}`,
          summary_last_line: true,
        },
      ],
    },

    {
      name: 'Imports',
      defaults: { state_dir: '{{maindir}}/.tasks', uploads: true },
      tasks: [
        {
          name: 'App exports',
          note: 'Drop an app export (.zip).',
          glob: '*.zip',
          ingest: { suffix: 'basename "$PWD"', dest: '{{maindir}}/Imports' },
        },
      ],
    },

    {
      name: 'Scheduled examples',
      defaults: { state_dir: '{{maindir}}/.tasks' },
      tasks: [
        // Scheduled tasks run unattended; they cannot use uploads/prompts.
        // Enable this once you have checked the paths on your machine.
        {
          name: 'Nightly disk usage',
          note: 'A tiny scheduled task; enable it in config.mjs.',
          schedule: { enabled: false, days: [], at: '02:00', catchUp: true },
          commands: [`df -h > '{{maindir}}/disk-usage.txt'`, 'echo "wrote disk-usage.txt"'],
          summary_last_line: true,
          notify: 'errors',
        },
      ],
    },
  ],
};

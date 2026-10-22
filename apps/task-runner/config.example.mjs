// Task Runner config — copy to config.mjs (gitignored) and edit.
//
// Top-level values become {{tokens}} inside commands, uploads and paths, so
// machine-specific details stay in one place. Groups and their tasks render in
// array order; a group's `defaults` merge under every task in it.
//
// Optional per-task fields beyond the examples below: `schedule` (unattended
// cron-like runs), `secrets` (config tokens to redact from logs) and `env`
// (environment variables for the command, e.g. tokens/non-argv secrets).
//
//   cp config.example.mjs config.mjs
//
// See README.md for the full field reference.

export default {
  // Where your data lives. "~" expands to the app user's home (in the
  // container that is $HOME, e.g. /home/node).
  maindir: '~/Backups',
  manual_dir: '{{maindir}}/Manual',

  // Folder holding your helper scripts, referenced as {{scriptroot}}/name.
  // This default points at the bundled examples (shipped inside the image, so
  // it works locally and in a container). Point it at your own folder, e.g.
  // scriptroot: '/config-src/tools'.
  scriptroot: '{{repo_dir}}/apps/task-runner/examples',

  // Balance XLSX external API (its Settings page shows the base path and the
  // token to copy) plus the portal relay used for import warnings. Leave
  // portal_url blank to skip the push notification.
  balance_url: 'http://balance-xlsx:3300/balance',
  balance_token: '',
  portal_url: '',

  // Optional remote machines; pin a task with `host: 'desktop'` and run the
  // same config on several instances (BACKUPCTL_HOST names the instance).
  hosts: {
    desktop: { user: 'you', host: 'desktop.local', port: 22, ssh: '{{hosts.desktop.user}}@{{hosts.desktop.host}}' },
  },

  groups: [
    {
      name: 'Everyday',
      defaults: { state_dir: '{{maindir}}/.tasks' },
      tasks: [
        // A plain script task: runs the given bash and treats the last log
        // line as the summary.
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

        // A drop task: the card gets a drop zone; staged files are moved into
        // the destination (and git-committed) when you press Run.
        {
          name: 'Filed downloads',
          note: 'Drop a file here to file it under Manual/ (fixed name).',
          uploads: true,
          glob: '*',
          move: { dest: '{{manual_dir}}' },
        },

        // A drop task that calls a helper script from {{scriptroot}} (the
        // bundled examples/hello-tool.sh writes a manifest of the files).
        {
          name: 'Manifest dropped files',
          note: 'Drop files to write a manifest next to them.',
          uploads: true,
          glob: '*',
          script: `bash '{{scriptroot}}/hello-tool.sh' '{{manual_dir}}' {{uploads}}`,
          summary_last_line: true,
        },

        // Capture the output into a paste dialog instead of a log line, and
        // serialise runs with other tasks that share the key.
        {
          name: 'List git remotes',
          serial_key: 'git',
          capture: true,
          commands: [
            `if [ -d '{{maindir}}' ]; then git -C '{{maindir}}' remote -v || true; fi`,
            'echo Copy this output wherever you need it.',
          ],
        },
      ],
    },

    {
      name: 'Imports',
      defaults: { state_dir: '{{maindir}}/.tasks', uploads: true },
      tasks: [
        // Ingest archives: each .zip is extracted, labelled by SUFFIX_CMD
        // (run inside the extracted directory), and synced under
        // dest/<label>, then git-committed.
        {
          name: 'App exports',
          note: 'Drop an app export (.zip).',
          glob: '*.zip',
          ingest: { suffix: 'basename "$PWD"', dest: '{{maindir}}/Imports' },
        },

        // Prompts: rendered generically; secret values are redacted from the
        // command display and the run output.
        {
          name: 'Encrypt a file',
          note: 'Drop one file and provide a passphrase.',
          glob: '*',
          prompts: [
            { key: 'passphrase', label: 'Passphrase', type: 'secret' },
            { key: 'overwrite', label: 'Overwrite if it exists?', type: 'confirm' },
          ],
          script: `
            name=$(basename {{uploads}})
            dest='{{manual_dir}}/'"\${name}.age"
            mkdir -p '{{manual_dir}}'
            if [ -e "$dest" ] && [ '{{overwrite}}' != 'true' ]; then echo "already exists: $dest"; exit 1; fi
            AGE_PASSPHRASE='{{passphrase}}' bash '{{lib}}' encrypt '{{manual_dir}}' "\${name}.age" {{uploads}}
          `,
        },
      ],
    },

    {
      name: 'Finance',
      defaults: { state_dir: '{{maindir}}/.tasks' },
      tasks: [
        // Scrape a bank/credit-card site, then import only the transactions
        // the Balance XLSX workbook does not already have. When nothing
        // matches the workbook the summary warns that the scrape may not
        // reach back far enough (and the portal relay pushes that warning,
        // if configured).
        {
          name: 'Balance import',
          note: 'Run your scraper and import new transactions into Balance XLSX.',
          serial_key: 'balance-import',
          browser: true,
          // `secrets` keeps config values out of the logged command/output.
          secrets: ['balance_token'],
          env: { BALANCE_TOKEN: '{{balance_token}}' },
          commands: [
            // Replace with your scraper invocation — its stdout is the input.
            `your-scraper > "$TMPDIR/transactions.txt"`,
            `node '{{scriptroot}}/balance-import.mjs' --input "$TMPDIR/transactions.txt" ` +
              `--balance-url '{{balance_url}}' --balance-token "$BALANCE_TOKEN" ` +
              `--notify-url '{{portal_url}}'`,
          ],
          summary_last_line: true,
        },
        // Scheduled tasks run unattended with the same bash engine. They may
        // not use uploads/prompts/browser/commit_dir; see README.md.
        {
          name: 'Nightly disk usage',
          state_dir: '{{maindir}}/.tasks',
          schedule: { enabled: false, days: [], at: '02:00', catchUp: true },
          commands: [`df -h > '{{maindir}}/disk-usage.txt'`, 'echo "wrote disk-usage.txt"'],
          summary_last_line: true,
          notify: 'errors',
        },
      ],
    },

    // A generic HTTP task. With tokenFile set, the app generates the bearer
    // token on first use (0600), enrolls it at enrollUrl, and sends it to the
    // webhook. The downloaded file is available to the commands that follow.
    {
      name: 'Remote services',
      defaults: { state_dir: '{{maindir}}/.tasks' },
      tasks: [
        {
          name: 'Remote archive',
          note: 'Download an archive from a remote D$CPLN agent.',
          webhook: {
            url: 'https://agent.example/v1/jobs/example-archive/archive',
            method: 'POST',
            enrollUrl: 'https://agent.example/v1/enroll',
            tokenFile: '{{maindir}}/.tasks/example-agent.token',
            downloadTo: '{{maindir}}/example-archive.tar.gz',
            timeoutMs: 1800000,
            summaryHeader: 'X-DSCPLN-Summary',
          },
          commands: [`echo "Downloaded to {{maindir}}/example-archive.tar.gz"`],
          summary_last_line: true,
        },
      ],
    },

    // Pinned to another machine: only runs on the instance named in
    // BACKUPCTL_HOST; shows as "Pinned to desktop" everywhere else.
    {
      name: 'Remote',
      defaults: { state_dir: '{{maindir}}/.tasks', host: 'desktop' },
      tasks: [
        {
          name: 'Desktop uptime',
          commands: [`ssh {{hosts.desktop.ssh}} 'uptime'`],
          summary_last_line: true,
        },
      ],
    },
  ],
}

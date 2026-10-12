// Pipeline folders: a configurable `command` that runs either in the daemon
// (spawned as bash) or as a Kubernetes Job on another node (`runner.node`).
//
// Remote runs mount the source directory from the target node read-only at
// /source, write into a shared RWX staging claim mounted at /staging, and the
// daemon then moves the staging output into the folder's destination. Commands
// are self-contained bash; `{{source}}`, `{{destination}}` and `{{staging}}`
// resolve per run (for remote runs `{{destination}}` is the staging output).

import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

export const isPipelineFolder = (def) => def && def.method === "command";

const slugify = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "pipeline";

const runId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Copies a tree over an existing destination, preserving symlinks the way
// `rsync -a` does. fsp.cp({ recursive, force }) cannot be used here: with an
// existing destination it stats source symlinks (ENOENT on dangling links),
// and Wine prefixes in particular are full of absolute home-dir symlinks.
export async function copyTree(src, dest) {
  const st = await fsp.lstat(src).catch(() => null);
  if (!st) return; // entry vanished mid-copy
  if (st.isSymbolicLink()) {
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.symlink(await fsp.readlink(src), dest);
    return;
  }
  if (st.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    for (const entry of await fsp.readdir(src)) {
      await copyTree(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

export function resolveCommand(command, tokens) {
  return String(command ?? "").replace(/\{\{(source|destination|staging)\}\}/g, (_, key) => tokens[key] ?? "");
}

// The Job a remote pipeline run creates. Pure so it can be unit-tested.
export function buildJobManifest({
  name,
  node,
  image,
  sourcePath,
  command,
  stagingClaim,
  stagingMount = "/staging",
  stagingSubPath = name,
  uid = 1000,
  seLinuxType = null,
  seLinuxLevel = null,
}) {
  const securityContext = { runAsUser: uid, runAsGroup: uid, fsGroup: uid };
  if (seLinuxType) {
    // Host sources can carry labels containers may not read (e.g. user_home_t
    // on SELinux-enforcing nodes); spc_t reads them without relabeling, and
    // level s0 keeps files the job writes category-free for the host.
    securityContext.seLinuxOptions = { type: seLinuxType, ...(seLinuxLevel ? { level: seLinuxLevel } : {}) };
  }
  const labels = { app: "file-pipelines", "fp-run": name };
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name, labels },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 600,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          nodeSelector: { "kubernetes.io/hostname": node },
          // The shared staging claim is written as the deployment's UID.
          securityContext,
          containers: [
            {
              name: "pipeline",
              image,
              command: ["bash", "-lc", command],
              env: [
                { name: "PIPELINE_FOLDER", value: name },
                { name: "PIPELINE_SOURCE", value: "/source" },
                { name: "PIPELINE_DESTINATION", value: `${stagingMount}/out` },
                { name: "PIPELINE_STAGING", value: `${stagingMount}/out` },
              ],
              volumeMounts: [
                { name: "source", mountPath: "/source", readOnly: true },
                { name: "staging", mountPath: stagingMount, subPath: stagingSubPath },
              ],
            },
          ],
          volumes: [
            { name: "source", hostPath: { path: sourcePath, type: "Directory" } },
            { name: "staging", persistentVolumeClaim: { claimName: stagingClaim } },
          ],
        },
      },
    },
  };
}

export class PipelineRunner {
  constructor(ctx, { spawnImpl = spawn, kubectl = "kubectl" } = {}) {
    this.ctx = ctx;
    this.spawnImpl = spawnImpl;
    this.kubectl = kubectl;
    this.active = new Set();
    this.runs = new Map();
  }

  // Last-run state per folder for the API/UI.
  status() {
    return Object.fromEntries(this.runs);
  }

  lastRunAt(folderName) {
    return this.runs.get(folderName)?.startedAt ?? 0;
  }

  async run(folderName, { trigger = "manual" } = {}) {
    const folder = this.ctx.store.getFolder(folderName);
    if (!folder) return { ok: false, error: "unknown folder" };
    const def = folder.def;
    if (!isPipelineFolder(def)) return { ok: false, error: "not a pipeline folder" };
    if (this.active.has(folderName)) return { ok: false, busy: true, error: "a pipeline is already running for this folder" };
    if (this.ctx.config.dryRun) return { ok: false, error: "dry run is enabled" };

    this.active.add(folderName);
    const state = { folder: folderName, trigger, running: true, ok: null, startedAt: Date.now(), endedAt: null, summary: "" };
    this.runs.set(folderName, state);
    this.ctx.log(`pipeline ${folderName}: starting (${trigger}${def.runner.node ? `, node ${def.runner.node}` : ""})`);
    try {
      const result = def.runner.node ? await this.#runRemote(def, state) : await this.#runLocal(def, state);
      state.ok = result.ok;
      state.summary = result.summary ?? result.error ?? "";
      if (result.ok) this.ctx.log(`pipeline ${folderName}: done${state.summary ? ` — ${state.summary}` : ""}`);
      else this.ctx.log(`pipeline ${folderName}: failed — ${result.error}`);
      return result;
    } catch (err) {
      state.ok = false;
      state.summary = err.message;
      this.ctx.log(`pipeline ${folderName}: failed — ${err.message}`);
      return { ok: false, error: err.message };
    } finally {
      state.running = false;
      state.endedAt = Date.now();
      this.active.delete(folderName);
      this.ctx.pipelineChanged?.();
    }
  }

  async #runLocal(def, state) {
    const staging = this.#stagingDir(`local-${slugify(def.name)}-${runId()}`);
    await fsp.mkdir(staging, { recursive: true });
    const tokens = { source: def.source, destination: def.destination, staging };
    const command = resolveCommand(def.command, tokens);
    const result = await this.#exec(command, {
      env: {
        PIPELINE_FOLDER: def.name,
        PIPELINE_SOURCE: def.source,
        PIPELINE_DESTINATION: def.destination,
        PIPELINE_STAGING: staging,
      },
    });
    state.summary = result.summary;
    return result.code === 0 ? { ok: true, summary: result.summary } : { ok: false, error: `command exited with ${result.code}` };
  }

  async #runRemote(def, state) {
    const jobName = `fp-${slugify(def.name)}-${runId()}`.toLowerCase().slice(0, 52);
    const stagingRoot = this.#stagingDir(jobName);
    const outputDir = path.join(stagingRoot, "out");
    await fsp.mkdir(outputDir, { recursive: true });

    const manifest = buildJobManifest({
      name: jobName,
      node: def.runner.node,
      image: this.ctx.config.pipelineImage,
      sourcePath: def.source,
      command: resolveCommand(def.command, { source: "/source", destination: null, staging: null }),
      stagingClaim: this.ctx.config.pipelineStagingClaim,
      stagingMount: this.#stagingMount(),
      uid: this.ctx.config.pipelineUid,
      seLinuxType: this.ctx.config.pipelineSeLinuxType,
      seLinuxLevel: this.ctx.config.pipelineSeLinuxLevel,
    });
    // The manifest command still contains the remote-side tokens.
    manifest.spec.template.spec.containers[0].command[2] = resolveCommand(def.command, {
      source: "/source",
      destination: `${this.#stagingMount()}/out`,
      staging: `${this.#stagingMount()}/out`,
    });

    try {
      await this.#kubectl(["apply", "-f", "-"], { input: JSON.stringify(manifest) });
      this.#kubectl(["logs", "-f", `job/${jobName}`, "--ignore-errors"], { stream: true }).catch(() => {});
      const waited = await this.#kubectl(["wait", "--for=condition=complete", `job/${jobName}`, `--timeout=${this.ctx.config.pipelineTimeoutSeconds}s`], { stream: true });
      if (waited.code !== 0) {
        return { ok: false, error: `job ${jobName} did not complete (is ${def.runner.node} up?)` };
      }
      const moved = await this.#ingest(outputDir, def.destination);
      state.summary = moved === 1 ? "1 item placed" : `${moved} items placed`;
      return { ok: true, summary: `job ${jobName}: ${state.summary}` };
    } finally {
      await this.#kubectl(["delete", "job", jobName, "--ignore-not-found", "--wait=false"]).catch(() => {});
      await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Moves the staging output into the destination, preserving the tree.
  async #ingest(sourceDir, destination) {
    const entries = await fsp.readdir(sourceDir).catch(() => []);
    await fsp.mkdir(destination, { recursive: true });
    let moved = 0;
    for (const entry of entries) {
      await copyTree(path.join(sourceDir, entry), path.join(destination, entry));
      moved += 1;
    }
    return moved;
  }

  #stagingDir(name) {
    return path.join(this.ctx.config.pipelineStagingDir, name);
  }

  #stagingMount() {
    return "/staging";
  }

  // Streams a command's stdout/stderr into the app log and resolves with the
  // exit code and the last non-empty line as the summary.
  #exec(command, { cwd = undefined, env = {}, input = null } = {}) {
    return new Promise((resolve) => {
      const child = this.spawnImpl("bash", ["-lc", command], {
        cwd,
        env: { ...process.env, ...env },
        stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"],
      });
      let summary = "";
      const onLine = (line) => {
        const text = line.trimEnd();
        if (!text) return;
        summary = text;
        this.ctx.log(text);
      };
      const consume = (stream) => {
        let buffer = "";
        stream.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) onLine(line);
        });
        stream.on("end", () => {
          if (buffer) onLine(buffer);
        });
      };
      consume(child.stdout);
      consume(child.stderr);
      child.on("error", (err) => resolve({ code: 127, summary: err.message }));
      child.on("close", (code) => resolve({ code: code ?? 0, summary }));
      if (input != null) {
        child.stdin.end(input);
      }
    });
  }

  #kubectl(args, { input = null, stream = false } = {}) {
    return new Promise((resolve) => {
      const child = this.spawnImpl(this.kubectl, args, {
        stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"],
      });
      let summary = "";
      const consume = (source) => {
        let buffer = "";
        source.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) {
            if (line.trim()) {
              summary = line.trim();
              this.ctx.log(`kubectl: ${line.trim()}`);
            }
          }
        });
      };
      if (stream) {
        consume(child.stdout);
        consume(child.stderr);
      }
      child.on("error", (err) => resolve({ code: 127, summary: err.message }));
      child.on("close", (code) => resolve({ code: code ?? 0, summary }));
      if (input != null) child.stdin.end(input);
    });
  }
}

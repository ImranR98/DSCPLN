import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SnapshotRunner,
  buildJobManifest,
  buildSnapshotCommand,
  copyTree,
  isSnapshotFolder,
  resolveCommand,
  snapshotMountPaths,
} from "../src/snapshot.js";

const makeCtx = (folder, overrides = {}) => {
  const logs = [];
  const ctx = {
    config: {
      dryRun: false,
      pipelineStagingDir: overrides.stagingDir,
      pipelineStagingClaim: "file-pipelines-staging",
      pipelineImage: "imranrdev/dscpln-file-pipelines:latest",
      pipelineTimeoutSeconds: 60,
      ...overrides.config,
    },
    store: {
      getFolder: (name) => (name === folder.name ? { def: folder } : null),
      emit: () => {},
    },
    log: (line) => logs.push(String(line)),
  };
  return { ctx, logs };
};

const snapshotFolder = (overrides = {}) => ({
  name: "wine-sync",
  method: "copy",
  snapshot: true,
  source: "/srv/games",
  sources: ["/srv/games"],
  destination: "/backup/games",
  subdir: null,
  nameSuffix: "",
  touch: null,
  command: null,
  runner: { node: null },
  schedule: { enabled: false, days: [], at: "03:00", catchUp: true },
  ...overrides,
});

test("snapshot: token resolution, folder detection and mount paths", () => {
  assert.equal(
    resolveCommand("cp {{source}}/a {{destination}}/b {{staging}}/c", { source: "/s", destination: "/d", staging: "/t" }),
    "cp /s/a /d/b /t/c",
  );
  assert.equal(resolveCommand("echo {{unknown}}", { source: "/s" }), "echo {{unknown}}");
  assert.equal(isSnapshotFolder({ method: "copy", snapshot: true }), true);
  assert.equal(isSnapshotFolder({ method: "copy" }), false);
  assert.equal(isSnapshotFolder({ method: "command" }), false);
  assert.deepEqual(snapshotMountPaths(["/a"]), ["/source"]);
  assert.deepEqual(snapshotMountPaths(["/a", "/b"]), ["/source-0", "/source-1"]);
});

test("snapshot: the generated command copies entries with subdir/suffix/marker", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "fp-snapshot-"));
  const source = path.join(root, "source");
  const dest = path.join(root, "dest");
  await fsp.mkdir(path.join(source, "Game A", "drive_c", "users", "steamuser"), { recursive: true });
  await fsp.mkdir(path.join(source, "Not APrefix"), { recursive: true });
  await fsp.writeFile(path.join(source, "Game A", "drive_c", "users", "steamuser", "save.dat"), "saved");
  await fsp.writeFile(path.join(source, "Not APrefix", "other.txt"), "x");

  const folder = snapshotFolder({
    sources: [source],
    destination: dest,
    subdir: "drive_c/users/steamuser",
    nameSuffix: " (Wine prefix home dir)",
    touch: "lastBackedUp.txt",
  });
  const { ctx } = makeCtx(folder, { stagingDir: path.join(root, "staging") });
  const runner = new SnapshotRunner(ctx);
  const result = await runner.run(folder.name, { trigger: "manual" });
  assert.equal(result.ok, true, JSON.stringify(result));

  const backedUp = path.join(dest, "Game A (Wine prefix home dir)");
  assert.equal(await fsp.readFile(path.join(backedUp, "save.dat"), "utf8"), "saved");
  assert.ok((await fsp.readFile(path.join(backedUp, "lastBackedUp.txt"), "utf8")).trim().length > 0);
  assert.deepEqual(await fsp.readdir(dest), ["Game A (Wine prefix home dir)"]);
  await fsp.rm(root, { recursive: true, force: true });
});

test("snapshot: several sources become one Job with per-source mounts", () => {
  const manifest = buildJobManifest({
    name: "fp-wine-sync-abc",
    node: "desktop",
    image: "img:latest",
    sourcePaths: ["/srv/synced", "/srv/unsynced"],
    command: buildSnapshotCommand(snapshotFolder(), { sourcePaths: ["/source-0", "/source-1"], destination: "/staging/out" }),
    stagingClaim: "file-pipelines-staging",
    uid: 1000,
  });
  const pod = manifest.spec.template.spec;
  assert.equal(pod.volumes[0].hostPath.path, "/srv/synced");
  assert.equal(pod.volumes[1].hostPath.path, "/srv/unsynced");
  assert.equal(pod.containers[0].volumeMounts[0].mountPath, "/source-0");
  assert.equal(pod.containers[0].volumeMounts[1].mountPath, "/source-1");
  assert.equal(pod.containers[0].env.find((e) => e.name === "PIPELINE_SOURCES").value, "/source-0,/source-1");
  assert.match(pod.containers[0].command[2], /copy_tree '\/source-0'/);
  assert.match(pod.containers[0].command[2], /copy_tree '\/source-1'/);
});

test("snapshot: single source still mounts at /source and a command override wins", () => {
  const manifest = buildJobManifest({
    name: "fp-abc",
    node: "desktop",
    image: "img",
    sourcePath: "/srv/games",
    command: "bash /source/run.sh",
    stagingClaim: "file-pipelines-staging",
    uid: 1000,
  });
  const pod = manifest.spec.template.spec;
  assert.equal(pod.containers[0].volumeMounts[0].mountPath, "/source");
  assert.equal(pod.containers[0].command[2], "bash /source/run.sh");
  assert.equal(pod.containers[0].env.find((e) => e.name === "PIPELINE_DESTINATION").value, "/staging/out");
});

test("snapshot: local runs execute a command override and record state", async () => {
  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), "fp-snapshot-"));
  const folder = snapshotFolder({
    command: 'mkdir -p "{{staging}}/out" && echo hi > "{{staging}}/out/file.txt"',
  });
  const { ctx } = makeCtx(folder, { stagingDir });
  const runner = new SnapshotRunner(ctx);
  const result = await runner.run(folder.name, { trigger: "manual" });
  assert.equal(result.ok, true, JSON.stringify(result));
  const runs = runner.status();
  assert.equal(runs[folder.name].ok, true);
  assert.equal(runs[folder.name].running, false);

  const created = await fsp.readdir(stagingDir);
  assert.equal(created.length, 1);
  const output = path.join(stagingDir, created[0], "out", "file.txt");
  assert.equal((await fsp.readFile(output, "utf8")).trim(), "hi");
  await fsp.rm(stagingDir, { recursive: true, force: true });
});

test("snapshot: guard rails (dry run, unknown folder, non-snapshot)", async () => {
  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), "fp-snapshot-"));
  const folder = snapshotFolder();
  const { ctx } = makeCtx(folder, { stagingDir });
  const runner = new SnapshotRunner(ctx);
  assert.equal((await runner.run("missing")).ok, false);

  const dryCtx = { ...ctx, config: { ...ctx.config, dryRun: true } };
  assert.match((await new SnapshotRunner(dryCtx).run(folder.name)).error, /dry run/);

  const watchedCtx = makeCtx(snapshotFolder({ snapshot: false }), { stagingDir }).ctx;
  const watchedRunner = new SnapshotRunner(watchedCtx);
  assert.equal((await watchedRunner.run(folder.name)).ok, false);
  await fsp.rm(stagingDir, { recursive: true, force: true });
});

test("buildJobManifest: optional SELinux options land on the Job pod", () => {
  const manifest = buildJobManifest({
    name: "fp-wine-sync-abc",
    node: "desktop",
    image: "img",
    sourcePath: "/home/me/Games/Synced",
    command: "true",
    stagingClaim: "file-pipelines-staging",
    uid: 1000,
    seLinuxType: "spc_t",
    seLinuxLevel: "s0",
  });
  assert.deepEqual(manifest.spec.template.spec.securityContext.seLinuxOptions, { type: "spc_t", level: "s0" });
});

test("copyTree: merges over an existing tree and preserves symlinks", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "fp-copy-"));
  const src = path.join(root, "src");
  const dst = path.join(root, "dst");
  await fsp.mkdir(path.join(src, "Prefix"), { recursive: true });
  await fsp.mkdir(path.join(dst, "Prefix"), { recursive: true });
  await fsp.writeFile(path.join(src, "Prefix", "save.dat"), "new");
  await fsp.writeFile(path.join(dst, "Prefix", "old.dat"), "keep");
  await fsp.symlink("/home/user/Music", path.join(src, "Prefix", "Music"));
  await fsp.symlink("/home/user/Music", path.join(dst, "Prefix", "Music"));
  await copyTree(src, dst);
  assert.equal(await fsp.readFile(path.join(dst, "Prefix", "save.dat"), "utf8"), "new");
  assert.equal(await fsp.readFile(path.join(dst, "Prefix", "old.dat"), "utf8"), "keep");
  assert.equal(await fsp.readlink(path.join(dst, "Prefix", "Music")), "/home/user/Music");
  await fsp.rm(root, { recursive: true, force: true });
});

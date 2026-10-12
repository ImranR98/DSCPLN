import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PipelineRunner, buildJobManifest, isPipelineFolder, resolveCommand } from "../src/pipeline.js";

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

const pipelineFolder = (overrides = {}) => ({
  name: "wine-sync",
  method: "command",
  source: "/srv/games",
  destination: "/backup/games",
  command: 'mkdir -p "{{staging}}/out" && echo hi > "{{staging}}/out/file.txt"',
  runner: { node: null },
  ...overrides,
});

test("pipeline: token resolution", () => {
  assert.equal(
    resolveCommand("cp {{source}}/a {{destination}}/b {{staging}}/c", { source: "/s", destination: "/d", staging: "/t" }),
    "cp /s/a /d/b /t/c",
  );
  assert.equal(resolveCommand("echo {{unknown}}", { source: "/s" }), "echo {{unknown}}");
  assert.equal(isPipelineFolder({ method: "command" }), true);
  assert.equal(isPipelineFolder({ method: "copy" }), false);
});

test("pipeline: the Job manifest mounts the node source and staging claim", () => {
  const manifest = buildJobManifest({
    name: "fp-wine-sync-abc",
    node: "bigpc",
    image: "img:latest",
    sourcePath: "/srv/games",
    command: "bash /source/run.sh",
    stagingClaim: "file-pipelines-staging",
    uid: 1000,
  });
  const pod = manifest.spec.template.spec;
  assert.equal(pod.nodeSelector["kubernetes.io/hostname"], "bigpc");
  assert.equal(pod.securityContext.fsGroup, 1000);
  assert.equal(pod.containers[0].command[2], "bash /source/run.sh");
  assert.equal(pod.volumes[0].hostPath.path, "/srv/games");
  assert.equal(pod.volumes[1].persistentVolumeClaim.claimName, "file-pipelines-staging");
  assert.equal(pod.containers[0].volumeMounts[1].subPath, "fp-wine-sync-abc");
  assert.equal(pod.containers[0].env.find((e) => e.name === "PIPELINE_DESTINATION").value, "/staging/out");
});

test("pipeline: local runs execute the command and record state", async () => {
  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), "fp-pipe-"));
  const folder = pipelineFolder();
  const { ctx } = makeCtx(folder, { stagingDir });
  const runner = new PipelineRunner(ctx);
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

test("pipeline: guard rails (dry run, unknown folder, busy, non-pipeline)", async () => {
  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), "fp-pipe-"));
  const folder = pipelineFolder();
  const { ctx } = makeCtx(folder, { stagingDir });
  const runner = new PipelineRunner(ctx);
  assert.equal((await runner.run("missing")).ok, false);

  const dryCtx = { ...ctx, config: { ...ctx.config, dryRun: true } };
  assert.match((await new PipelineRunner(dryCtx).run(folder.name)).error, /dry run/);

  const copyCtx = makeCtx(pipelineFolder({ method: "copy" }), { stagingDir }).ctx;
  const copyRunner = new PipelineRunner(copyCtx);
  assert.equal((await copyRunner.run(folder.name)).ok, false);
  await fsp.rm(stagingDir, { recursive: true, force: true });
});

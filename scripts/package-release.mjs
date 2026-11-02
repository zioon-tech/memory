import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const component = process.argv[2];
const stage = resolve(".release-stage", component);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
if (component === "service") {
  execFileSync("bash", ["-e", "-o", "pipefail", "-c", 'git archive HEAD | tar -x -C "$1"', "_", stage]);
  const upstream = resolve(process.env.AGENT_FS_UPSTREAM_DIR || ".vendor/agent-fs");
  const vendor = resolve(stage, ".vendor/agent-fs");
  mkdirSync(resolve(stage, ".vendor"), { recursive: true });
  execFileSync("git", ["clone", "--no-hardlinks", upstream, vendor], { stdio: "inherit" });
  execFileSync("git", ["-C", vendor, "switch", "--detach", "aecd4c83606f45325daece46b01f0c38ad2cc0ed"], { stdio: "inherit" });
  for (const cwd of [vendor, stage, resolve(stage, "apps/memory-service")]) {
    execFileSync(process.env.ZION_BUN_BINARY || "bun",
      ["install", "--production", "--frozen-lockfile"], { cwd, stdio: "inherit" });
  }
  // The production target is Linux x64 without GPUs. Preserve CPU/native
  // database support while excluding binaries for other platforms and GPUs.
  const store = resolve(vendor, "node_modules/.bun");
  const gpu = readdirSync(store).filter(name => /^@node-llama-cpp\+linux-x64-(cuda|cuda-ext|vulkan)@/.test(name))
    .map(name => resolve(store, name));
  function removeGpuAliases(directory) {
    for (const entry of readdirSync(directory)) {
      const path = resolve(directory, entry);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) {
        let target;
        try { target = realpathSync(path); } catch { continue; }
        if (gpu.some(root => target === root || target.startsWith(root + "/"))) rmSync(path);
      } else if (metadata.isDirectory()) removeGpuAliases(path);
    }
  }
  removeGpuAliases(vendor);
  for (const path of gpu) rmSync(path, { recursive: true, force: true });
  for (const entry of readdirSync(store).filter(name => name.startsWith("onnxruntime-node@"))) {
    const native = resolve(store, entry, "node_modules/onnxruntime-node/bin");
    if (!existsSync(native)) continue;
    for (const api of readdirSync(native)) {
      const path = resolve(native, api);
      if (!lstatSync(path).isDirectory()) continue;
      for (const platform of ["darwin", "win32"]) rmSync(resolve(path, platform), { recursive: true, force: true });
      for (const arch of ["arm64", "arm", "ia32"]) rmSync(resolve(path, "linux", arch), { recursive: true, force: true });
    }
  }
  writeFileSync(resolve(vendor, ".zioon-upstream.json"), JSON.stringify({
    commit: "aecd4c83606f45325daece46b01f0c38ad2cc0ed", version: "0.18.5"
  }) + "\n");
  rmSync(resolve(vendor, ".git"), { recursive: true, force: true });
  execFileSync(process.env.ZION_BUN_BINARY || "bun",
    ["test", "apps/memory-service/tests/gateway.integration.test.ts"], {
      cwd: stage, env: { ...process.env, AGENT_FS_UPSTREAM_DIR: vendor }, stdio: "inherit"
    });
} else if (component === "public-site") {
  cpSync("dist/public-site", stage, { recursive: true, verbatimSymlinks: true });
} else throw new Error(`Unsupported component: ${component}`);
execFileSync("python3", [resolve(process.env.RELEASE_TOOLS_DIR || ".release-tools", "scripts/pack.py"),
  "--stage", stage, "--output", resolve(".release-out", component),
  "--product", "memory", "--component", component], { stdio: "inherit" });

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
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
} else if (component === "public-site") {
  cpSync("dist/public-site", stage, { recursive: true, verbatimSymlinks: true });
} else throw new Error(`Unsupported component: ${component}`);
execFileSync("python3", [resolve(process.env.RELEASE_TOOLS_DIR || ".release-tools", "scripts/pack.py"),
  "--stage", stage, "--output", resolve(".release-out", component),
  "--product", "memory", "--component", component], { stdio: "inherit" });

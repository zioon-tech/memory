import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(process.env.AGENT_FS_UPSTREAM_DIR || resolve(root, ".vendor/agent-fs"));
const bun = process.env.ZION_BUN_BINARY || "bun";
const commit = "aecd4c83606f45325daece46b01f0c38ad2cc0ed";
if (execFileSync(bun, ["--version"], { encoding: "utf8" }).trim() !== "1.4.1") {
  throw new Error("Memory requires Bun 1.4.1; set ZION_BUN_BINARY if needed");
}
if (!existsSync(destination)) {
  mkdirSync(dirname(destination), { recursive: true });
  execFileSync("git", ["clone", "https://github.com/desplega-ai/agent-fs.git", destination], { stdio: "inherit" });
  execFileSync("git", ["-C", destination, "switch", "--detach", commit], { stdio: "inherit" });
}
const head = execFileSync("git", ["-C", destination, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["-C", destination, "status", "--porcelain"], { encoding: "utf8" }).trim();
if (head !== commit || dirty) throw new Error("agent-fs checkout must be clean and match the pinned commit");
for (const cwd of [destination, root, resolve(root, "apps/memory-service")]) {
  execFileSync(bun, ["install", "--frozen-lockfile"], { cwd, stdio: "inherit" });
}
console.log(`Memory dependencies ready; AGENT_FS_UPSTREAM_DIR=${destination}`);

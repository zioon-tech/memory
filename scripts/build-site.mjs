import { cp, mkdir, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "apps/memory-service/web");
const output = resolve(root, "dist/public-site");
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "assets"), { recursive: true });
await cp(resolve(source, "index.html"), resolve(output, "index.html"));
await mkdir(resolve(output, "docs"), { recursive: true });
await cp(resolve(source, "docs.html"), resolve(output, "docs/index.html"));
for (const file of ["site.css", "tokens.css", "site.js", "forest.webp", "favicon.svg"]) {
  await cp(resolve(source, file), resolve(output, "assets", file));
}
await cp(resolve(source, "favicon.svg"), resolve(output, "favicon.svg"));
const files = {};
async function scan(path, prefix = "") {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await scan(resolve(path, entry.name), name + "/");
    else files[name] = createHash("sha256").update(await readFile(resolve(path, entry.name))).digest("hex");
  }
}
await scan(output);
await writeFile(resolve(output, "build-info.json"), JSON.stringify({ product: "memory", component: "public-site", files }, null, 2) + "\n");
console.log("Built independent Memory website and documentation");

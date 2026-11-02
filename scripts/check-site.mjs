import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const output = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/public-site");
for (const page of ["index.html", "docs/index.html"]) {
  const html = await readFile(resolve(output, page), "utf8");
  assert.match(html, /<title>.+<\/title>/);
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)(?:\?[^"]*)?"/g)) {
    assert.ok((await stat(resolve(output, "." + match[1]))).isFile(), match[1]);
  }
}
console.log("Memory public pages and assets verified");

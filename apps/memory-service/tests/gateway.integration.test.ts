import { test, expect, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createMemoryClient } from "../../../packages/sdk/src/index.mjs";

const directory = await mkdtemp(join(tmpdir(), "memory-independent-"));
process.env.AGENT_FS_HOME = directory;
process.env.AGENT_FS_STORAGE_PROVIDER = "local";
process.env.AGENT_FS_LOCAL_ROOT = join(directory, "objects");
const { core } = await import("../src/upstream.ts");
const { createMemoryGateway } = await import("../src/gateway.ts");
const db = core.createDatabase(join(directory, "agent-fs.db"));
const storage = new core.LocalStorageAdapter({ root: join(directory, "objects") });
const gateway = createMemoryGateway({
  db, storage, secret: randomBytes(48).toString("base64url"), runtimeUrl: "http://127.0.0.1:1",
  fetchImpl: async (_url, init) => {
    const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "");
    if (!["alice", "bob", "read-only"].includes(token)) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({
      authenticated: true, user: { id: token === "read-only" ? "alice" : token },
      space: { id: "personal" }, membership: { status: "active" },
      scopes: token === "read-only" ? ["runtime.read"] : ["runtime.read", "runtime.write"]
    });
  }
});
const client = (token) => createMemoryClient({
  baseUrl: "http://127.0.0.1:1", tokenProvider: async () => token,
  fetchImpl: async (url, init) => gateway.fetch(new Request(url, init))
});
afterAll(async () => {
  db.$client.close();
  await rm(directory, { recursive: true, force: true });
});

test("independent service isolates accounts and checks read and write permissions", async () => {
  const path = "/memory/dev.identity/user.md";
  const written = await client("alice").write(path, "Alice preference", { create_only: true });
  expect(written.created).toBe(true);
  expect((await client("alice").read(path)).content).toBe("Alice preference");
  await expect(client("bob").read(path)).rejects.toMatchObject({ statusCode: 404 });
  expect((await client("read-only").read(path)).content).toBe("Alice preference");
  await expect(client("read-only").write(path, "overwrite")).rejects.toMatchObject({ statusCode: 403 });
  await expect(client("invalid").read(path)).rejects.toMatchObject({ statusCode: 401 });
});

test("JSONL concurrent appends preserve content and reject stale hashes", async () => {
  const path = "/memory/dev.identity/history.jsonl";
  await Promise.all(Array.from({ length: 6 }, (_, i) =>
    client("alice").appendJsonl(path, [{ id: `event-${i}`, value: i }])));
  const read = await client("alice").read(path);
  expect(read.content.trim().split("\n")).toHaveLength(6);
  const duplicate = await client("alice").appendJsonl(path, [{ id: "event-0", value: 0 }]);
  expect(duplicate.skipped).toEqual(["event-0"]);
  await expect(client("alice").write(path, "lost update", { expected_hash: "stale" }))
    .rejects.toMatchObject({ statusCode: 409 });
  expect((await client("alice").read(path)).content_hash).toBe(read.content_hash);
});

test("gateway rejects origins, traversal and wrong mutation methods", async () => {
  expect((await gateway.fetch(new Request("http://127.0.0.1:1/zion/files/read?path=/memory/dev.identity/user.md", {
    headers: { authorization: "Bearer alice", origin: "https://untrusted.invalid" }
  }))).status).toBe(403);
  expect((await gateway.fetch(new Request("http://127.0.0.1:1/zion/files/read?path=/memory/dev.identity/../escape", {
    headers: { authorization: "Bearer alice" }
  }))).status).toBe(400);
  expect((await gateway.fetch(new Request("http://127.0.0.1:1/zion/files/write", {
    headers: { authorization: "Bearer alice" }
  }))).status).toBe(405);
  await expect(client("alice").write("/etc/passwd", "escape")).rejects.toThrow("Invalid Memory file path");
});

test("public health and MCP discovery do not provision accounts", async () => {
  const before = db.$client.query("SELECT count(*) AS count FROM users").get().count;
  expect((await gateway.fetch(new Request("http://127.0.0.1:1/health"))).status).toBe(200);
  const response = await gateway.fetch(new Request("http://127.0.0.1:1/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  }));
  expect(response.status).toBe(200);
  const names = (await response.json()).result.tools.map((tool) => tool.name);
  expect(names).toContain("cat");
  expect(names).not.toContain("signed-url");
  expect(db.$client.query("SELECT count(*) AS count FROM users").get().count).toBe(before);
});

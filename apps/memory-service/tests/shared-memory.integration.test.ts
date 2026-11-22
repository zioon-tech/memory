import { test, expect, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const directory = await mkdtemp(join(tmpdir(), "zioon-shared-memory-"));
process.env.AGENT_FS_HOME = directory;
process.env.AGENT_FS_STORAGE_PROVIDER = "local";
process.env.AGENT_FS_LOCAL_ROOT = join(directory, "objects");
const { core } = await import("../src/upstream.ts");
const { createMemoryGateway } = await import("../src/gateway.ts");
const db = core.createDatabase(join(directory, "memory.db"));
const storage = new core.LocalStorageAdapter({ root: join(directory, "objects") });
const revoked = new Set<string>();
const identities = {
  alice: { user: "alice", space: "personal", kind: "personal" },
  bob: { user: "bob", space: "bob-personal", kind: "personal" },
  teamAlice: { user: "alice", space: "team", kind: "team", document: "shared-doc" },
  teamBob: { user: "bob", space: "team", kind: "team", document: "shared-doc" },
  restricted: { user: "alice", space: "team", kind: "team", document: "restricted-doc" },
  allSpace: { user: "bob", space: "team", kind: "team" },
  otherTeam: { user: "alice", space: "other-team", kind: "team", document: "shared-doc" },
  missingNamespace: { user: "alice", space: "team", kind: "team", missing: true },
  directAlice: { user: "alice", space: "personal", kind: "personal", document: "direct-doc", origin: "personal" },
  directBob: { user: "bob", space: "bob-personal", kind: "personal", document: "direct-doc", origin: "personal" },
  forgedDocument: { user: "bob", space: "bob-personal", kind: "personal", document: "direct-doc", origin: "personal", forged: true },
};
const calls = new Map<string, number>();
const gateway = createMemoryGateway({
  db, storage, secret: randomBytes(48).toString("base64url"), runtimeUrl: "http://127.0.0.1:1",
  accountIssuer: "https://account.test",
  fetchImpl: async (_url, init) => {
    const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") || "";
    const value = identities[token];
    calls.set(token, (calls.get(token) || 0) + 1);
    if (!value || revoked.has(token)) return Response.json({ error: "revoked" }, { status: 403 });
    return Response.json({
      authenticated: true, user: { id: value.user }, space: { id: value.space, kind: value.kind },
      membership: { status: "active" }, scopes: ["runtime.read", "runtime.write"],
      accountIdentity: { issuer: "https://account.test", subject: value.user },
      ...(value.origin && !value.forged ? { contentScope: { originSpaceId: value.origin, documentId: value.document } } : {}),
      ...(!value.missing ? { memoryScope: value.origin
        ? { kind: "document", spaceId: value.origin, documentId: value.document }
        : value.kind === "personal"
        ? { kind: "personal", spaceId: value.space, userId: value.user }
        : { kind: value.document ? "document" : "space", spaceId: value.space, documentId: value.document } } : {}),
    });
  }
});
const request = (token, endpoint, body?, method = body ? "POST" : "GET") => gateway.fetch(
  new Request(`http://127.0.0.1:1${endpoint}`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json",
      accept: "application/json, text/event-stream" },
    ...(body ? { body: JSON.stringify(body) } : {})
  }));
const read = async (token, path) => {
  const r = await request(token, `/zion/files/read?path=${encodeURIComponent(path)}`);
  return { status: r.status, body: await r.json() };
};
const write = async (token, path, content) => {
  const r = await request(token, "/zion/files/write", { path, content });
  expect(r.status).toBe(200);
};
afterAll(async () => { db.$client.close(); await rm(directory, { recursive: true, force: true }); });

test("two members share one document namespace without merging canonical personal identities", async () => {
  const path = "/memory/dev.identity/user.md";
  await write("alice", path, "Alice private");
  await write("teamAlice", path, "Shared preference");
  expect((await read("teamBob", path)).body.content).toBe("Shared preference");
  expect((await read("alice", path)).body.content).toBe("Alice private");
  expect((await read("bob", path)).status).toBe(404);
  expect((await read("otherTeam", path)).status).toBe(404);
});

test("independent accounts share only an explicitly authorized document Memory namespace", async () => {
  const path = "/memory/dev.identity/direct.md";
  await write("alice", path, "Owner private");
  await write("bob", path, "Receiver private");
  await write("directAlice", path, "Shared document Memory");
  expect((await read("directBob", path)).body.content).toBe("Shared document Memory");
  expect((await read("alice", path)).body.content).toBe("Owner private");
  expect((await read("bob", path)).body.content).toBe("Receiver private");
  expect((await read("forgedDocument", path)).status).toBe(403);
  revoked.add("directBob");
  expect((await read("directBob", path)).status).toBe(403);
  revoked.delete("directBob");
});

test("Space recall and native index search cannot discover restricted document memory", async () => {
  const path = "/memory/dev.identity/secret.md";
  await write("restricted", path, "OnlyRestrictedNeedle");
  expect((await read("allSpace", path)).status).toBe(404);
  expect((await read("teamBob", path)).status).toBe(404);
  const me = await (await request("allSpace", "/auth/me")).json();
  const search = await request("allSpace", `/orgs/${me.defaultOrgId}/ops`,
    { op: "grep", pattern: "OnlyRestrictedNeedle", path: "/" });
  expect(search.status).toBe(200);
  expect(await search.text()).not.toContain("OnlyRestrictedNeedle");
});

test("native API drive IDs, MCP and raw file routes use the same authorized namespace", async () => {
  const a = await (await request("restricted", "/auth/me")).json();
  const b = await (await request("teamBob", "/auth/me")).json();
  expect(a.defaultDriveId).not.toBe(b.defaultDriveId);
  const foreign = await request("teamBob", `/orgs/${a.defaultOrgId}/ops`,
    { op: "cat", path: "/memory/dev.identity/secret.md" });
  expect(foreign.status).toBe(404);
  const mcp = await request("teamBob", "/mcp", { jsonrpc: "2.0", id: 1,
    method: "tools/call", params: { name: "cat", arguments: { path: "/memory/dev.identity/user.md" } } });
  expect(mcp.status).toBe(200);
  expect(await mcp.text()).toContain("Shared preference");
  const raw = await request("teamBob", `/orgs/${a.defaultOrgId}/drives/${a.defaultDriveId}/files/memory/dev.identity/secret.md/raw`);
  expect(raw.status).toBe(404);
});

test("a team identity without an authoritative namespace fails closed before provisioning", async () => {
  const before = db.$client.query("SELECT count(*) AS n FROM users").get().n;
  expect((await read("missingNamespace", "/memory/dev.identity/user.md")).status).toBe(403);
  expect(db.$client.query("SELECT count(*) AS n FROM users").get().n).toBe(before);
});

test("revocation is checked again after waiting behind a storage operation", async () => {
  const original = storage.getObject.bind(storage);
  let unblock, entered;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  storage.getObject = async (...args) => { entered(); await gate; return original(...args); };
  try {
    const first = read("teamAlice", "/memory/dev.identity/user.md");
    await started;
    const before = calls.get("teamBob") || 0;
    const second = read("teamBob", "/memory/dev.identity/user.md");
    while ((calls.get("teamBob") || 0) === before) await new Promise(resolve => setTimeout(resolve, 1));
    revoked.add("teamBob");
    unblock();
    await first;
    expect((await second).status).toBe(403);
  } finally { storage.getObject = original; revoked.delete("teamBob"); }
});

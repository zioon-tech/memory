import { core } from "./upstream.ts";
import { contentHash, mergeJsonlRecords } from "../../../packages/protocol/src/plugin-data-files.mjs";

export const MEMORY_ROOT = "/memory/dev.identity";
const conflict = () => { throw Object.assign(new Error("content_hash_conflict"), { statusCode: 409 }); };
function validatePath(path) {
  if (!(path === MEMORY_ROOT || path.startsWith(`${MEMORY_ROOT}/`))
    || path.split("/").some((part) => part === ".." || part === ".") || /[\\\x00-\x1f]/.test(path)) {
    throw Object.assign(new Error("invalid_memory_path"), { statusCode: 400 });
  }
}

// The gateway holds its account lock throughout this operation, including CLI,
// MCP and raw uploads. Revisions and returned bytes therefore describe one view.
export function parseFileBatch(input) {
  let files;
  const values = input instanceof URLSearchParams ? input.getAll("files") : [input.files];
  if (values.length !== 1) throw Object.assign(new Error("invalid_memory_batch"), { statusCode: 400 });
  try { files = JSON.parse(values[0]); } catch {}
  if (!Array.isArray(files) || !files.length || files.length > 32) {
    throw Object.assign(new Error("invalid_memory_batch"), { statusCode: 400 });
  }
  for (const spec of files) {
    if (!spec || typeof spec.path !== "string"
      || (spec.known_hash !== undefined && spec.known_hash !== null && !/^[a-f0-9]{64}$/.test(spec.known_hash))
      || (spec.metadata_only !== undefined && typeof spec.metadata_only !== "boolean")) {
      throw Object.assign(new Error("invalid_memory_batch"), { statusCode: 400 });
    }
    validatePath(spec.path);
  }
  return files;
}
export async function readFileBatch({ db, storage, binding }, input) {
  const files = parseFileBatch(input);
  const ctx = { db, s3: storage, ...binding, embeddingProvider: null };
  const results = [];
  for (const spec of files) {
    const file = db.$client.query("SELECT is_deleted FROM files WHERE drive_id = ? AND path = ?")
      .get(binding.driveId, spec.path);
    const revision = core.getHeadVersionRow(ctx, spec.path);
    if (file?.is_deleted) {
      results.push({ path: spec.path, missing: true, content_hash: null });
    } else if (file && revision?.contentHash
      && (spec.metadata_only || spec.known_hash === revision.contentHash)) {
      results.push({ path: spec.path, missing: false, content_hash: revision.contentHash });
    } else {
      try {
        const value = await pluginFileOperation({ db, storage, binding }, "read", spec);
        results.push({ path: spec.path, missing: false, content_hash: value.content_hash,
          ...(!spec.metadata_only && spec.known_hash !== value.content_hash ? { content: value.content } : {}) });
      } catch (error) {
        if (error.statusCode !== 404) throw error;
        results.push({ path: spec.path, missing: true, content_hash: null });
      }
    }
  }
  return { ok: true, plugin_data_version: 1, batch_version: 1, files: results };
}

export async function pluginFileOperation({ db, storage, binding }, operation, input) {
  const path = String(input.path || "");
  validatePath(path);
  const ctx = { db, s3: storage, ...binding, embeddingProvider: null };
  if (operation === "entries") {
    const result = await core.dispatchOp(ctx, "ls", { path });
    return { ok: true, plugin_data_version: 1, path,
      entries: result.entries.map((entry) => ({ ...entry, path: `${path}/${entry.name}` })) };
  }
  let content = null;
  try {
    const loaded = await storage.getObject(core.getS3Key(ctx.orgId, ctx.driveId, path));
    // Keep a UTF-8 BOM as a character: the revision hash, returned text and
    // conditional-write hash must all refer to the same bytes.
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(loaded.body);
  } catch (error) {
    if (!["NoSuchKey", "NotFound", "NoSuchObject"].includes(error.name)
      && error.status !== 404 && error.$metadata?.httpStatusCode !== 404) throw error;
  }
  const currentHash = content === null ? null : contentHash(content);
  const version = core.getHeadVersionRow(ctx, path)?.version || 0;
  if (operation === "read") {
    if (content === null) throw Object.assign(new Error("ENOENT: no such file"), { statusCode: 404 });
    return { ok: true, plugin_data_version: 1, path, content, content_hash: currentHash };
  }
  if (!["write", "append-jsonl"].includes(operation)) {
    throw Object.assign(new Error("unsupported_memory_operation"), { statusCode: 400 });
  }
  if (input.create_only && content !== null) return {
    ok: true, plugin_data_version: 1, path, created: false, written: false, content_hash: currentHash
  };
  if (Object.hasOwn(input, "expected_hash") && input.expected_hash !== currentHash) conflict();
  const update = operation === "append-jsonl" ? mergeJsonlRecords(content, input.records) : null;
  const next = update ? update.content : String(input.content ?? "");
  const written = await core.dispatchOp(ctx, "write", { path, content: next, expectedVersion: version });
  return { ok: true, plugin_data_version: 1, path, content_hash: written.contentHash,
    written: true, ...(input.create_only ? { created: true } : {}),
    ...(update ? { appended: update.appended, skipped: update.skipped } : {}) };
}

const ROOT = "/memory/dev.identity";

export function createMemoryClient({ baseUrl = "https://memory.zioon.tech", tokenProvider, fetchImpl = fetch }) {
  const origin = new URL(baseUrl);
  if (origin.username || origin.password || origin.search || origin.hash
    || origin.pathname !== "/" || (origin.protocol !== "https:"
      && !(origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname)))) {
    throw new Error("Memory base URL requires an HTTPS origin or loopback");
  }
  if (typeof tokenProvider !== "function") throw new Error("An authenticated tokenProvider is required");
  function checkPath(path) {
    if (typeof path !== "string" || !(path === ROOT || path.startsWith(ROOT + "/"))
      || /[\\\x00-\x1f]/.test(path) || path.split("/").some((part) => part === "." || part === "..")) {
      throw new Error("Invalid Memory file path");
    }
  }
  async function request(operation, path, input) {
    checkPath(path);
    const write = input !== undefined;
    const token = await tokenProvider();
    if (!token) throw new Error("Memory login required");
    const url = new URL(`/zion/files/${operation}`, origin);
    if (!write) url.searchParams.set("path", path);
    let response;
    let value;
    try {
      response = await fetchImpl(url, {
        method: write ? "POST" : "GET", redirect: "error",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(write ? { body: JSON.stringify({ ...input, path }) } : {}),
        signal: AbortSignal.timeout(30_000)
      });
      value = await response.json();
    } catch (cause) {
      throw Object.assign(new Error(write
        ? "Memory write outcome unknown; inspect the file before retrying"
        : "Memory service unavailable", { cause }), {
        code: write ? "execution_outcome_unknown" : "memory_service_unavailable"
      });
    }
    if (!response.ok) throw Object.assign(new Error(value.message || value.error || "Memory operation failed"), {
      statusCode: response.status
    });
    return value;
  }
  return Object.freeze({
    read: (path) => request("read", path),
    entries: (path = ROOT) => request("entries", path),
    write: (path, content, options = {}) => request("write", path, { content, ...options }),
    appendJsonl: (path, records, options = {}) => request("append-jsonl", path, { records, ...options })
  });
}

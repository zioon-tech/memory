# Zioon Memory

[官网](https://memory.zioon.tech) · [文档](https://memory.zioon.tech/docs) · [服务状态](https://status.zioon.tech)

Memory 是独立的账户记忆服务，提供网站、控制台、CLI、HTTP 和 MCP 入口。服务基于经核验的 agent-fs 0.18.5；官网与文档随本仓库维护。

| 路径 | 归属 |
| --- | --- |
| `apps/memory-service/src` | 服务、账户隔离、文件和 MCP 网关 |
| `apps/memory-service/web` | 官网、文档和控制台 |
| `packages/account-client` | 与 Zioon 账户服务通信的客户端 |
| `packages/protocol` | 文件哈希、JSONL 与 MCP 授权语义 |
| `packages/sdk` | Memory HTTP 客户端 |
| `integrations/skills/agentfs-memory` | 可安装到 Zioon 或其他 Agent 的 Skill |
| `scripts` | 独立 CLI 登录辅助、构建与依赖初始化 |
| `docs` | 开发、架构与运行说明 |

```sh
# Node 22.18.0 和 Bun 1.4.1
npm run bootstrap
npm test
npm run build:site
npm run check:site
```

`bootstrap` 将上游检出到 `.vendor/agent-fs` 并核对 commit，按锁文件安装依赖。可以通过 `AGENT_FS_UPSTREAM_DIR` 使用已有的干净检出。

服务启动参数见 [运行说明](docs/operations.md)。生产配置和发布工具维护于私有 `zioon-tech/infra`。SQLite metadata 必须使用本地持久磁盘；不支持多副本共享 WAL 或网络文件系统。

需要真实 Zioon 账户服务的端到端验证留在 Zioon 仓库 `tests/integration/memory`，通过 `ZIOON_MEMORY_REPO` 指向此仓库。Memory 自身测试使用临时存储和受控身份验证服务。

仓库当前为私有、未授予整体开源许可。上游依赖保留原许可证；来源与固定版本见 `SOURCE-PROVENANCE.json`。

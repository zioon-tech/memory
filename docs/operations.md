# Development and operation

使用 Node 22.18.0、Bun 1.4.1。运行 `npm run bootstrap` 固定上游 commit 并安装根目录及服务锁文件。启动时将 `AGENT_FS_UPSTREAM_DIR` 设置为 `.vendor/agent-fs` 的绝对路径。

本地验证使用临时 SQLite 和本地对象存储，不需要生产云凭据。`npm test` 验证 CLI 登录、权限、账户隔离和并发文件操作。

服务需要以下环境变量：

| 配置 | 含义 |
| --- | --- |
| `AGENT_FS_UPSTREAM_DIR` | 固定版本、干净的上游检出 |
| `AGENT_FS_HOME` | 本地持久元数据目录 |
| `AGENT_FS_STORAGE_PROVIDER` | `local` 或生产的 `oss` |
| `AGENT_FS_LOCAL_ROOT` | 本地对象存储目录，仅 local 模式 |
| `ZION_MEMORY_BRIDGE_SECRET_FILE` | 至少 32 字节的服务间委托密钥文件 |
| `ZION_ACCOUNT_RUNTIME_URL` | 账户验证 Runtime 的 HTTPS origin |
| `ZIOON_ACCOUNT_ISSUER` | 统一账户 issuer |
| `ZIOON_ADC_ORIGIN` | ADC origin，账户链接兼容路径 |
| `ZION_MEMORY_WEBSITE_ORIGIN` | Memory 对外 HTTPS origin |
| `ZION_MEMORY_HOST` / `ZION_MEMORY_PORT` | 默认 `127.0.0.1:18991` |

官网和文档：`npm run build:site && npm run check:site` 生成 `dist/public-site`。服务端账户/控制台路由继续由 Bun 提供。静态制品只覆盖公开页面与资源，不能替换 `/account`、`/console` 或 API。

生产 SQLite 必须位于本地持久磁盘。备份采用 `apps/memory-service/scripts/backup.ts` 的 SQLite backup API；同时保留对象存储版本。不要直接复制运行中的 DB/WAL，也不要将 SQLite WAL 放到 NAS。

部署、域名、systemd、云身份与回滚记录由私有 `infra` 维护。`/health` 检查本地进程和数据库；`/ready` 还检查存储与身份依赖。

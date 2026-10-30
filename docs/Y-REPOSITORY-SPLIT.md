# 现代艺术仓库拆分验证

日期：2026-10-30。

独立仓库：`${MODERN_ART_ROOT}`。源目录：`GameFactory-3A/games/modern-art`。`src/`、`server/`、`packages/` 的文件 SHA256 与原游戏源码一致。

已保留完整前后端、规则测试、内置框架、npm 锁文件、许可和开发文档。Render 蓝图已删除原 monorepo 的 `rootDir`。原服务器打包和部署脚本迁入 `scripts/`；打包路径按独立仓库根目录定位。

已完成：

- `npm ci`：从锁文件全新安装成功，npm 审计报告 0 个漏洞。
- `npm test`：68 / 68 项测试通过，覆盖规则、机器人、联机、权限、重连和存储等现有测试。
- `npm run build`：生产构建成功；保留原 Three.js 大于 500 KB 的构建提示。
- 临时启动 `persist:false` 服务，`/health`、构建后的首页及其 JS 资源均返回 HTTP 200；结束后关闭测试服务。
- `python scripts/package.py --output ...`：发布 ZIP 创建成功且 CRC 完整。
- Git 文件清单未包含 `node_modules/`、`dist/`、`.data/`、证据目录或旧发布包，源码约 1 MiB。

房间存档、席位凭证和历史证据留在原目录，没有复制进新仓库；现有服务器服务和线上数据未变更。`VALIDATION.md` 等旧文档记录的是历史验收，本记录仅说明本次实际执行的检查。

来源清单见 `Y-split-manifest.json`。游戏原先没有进入父仓库提交历史，故新仓库采用独立初始快照。远程仓库已配置为 https://github.com/potatoyz/modern-art（私有），使用 HTTPS 连接。

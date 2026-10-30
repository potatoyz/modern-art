# 打包和现有服务器部署

在独立仓库根目录运行：

```powershell
npm ci
npm test
npm run build
python scripts/package.py --output release/modern-art.zip
```

发布 ZIP 包含 `dist/` 和前后端源码，自动排除依赖、存档、凭证、历史证据和旧发布包；输出路径必须尚不存在。解压后可执行 `npm ci --omit=dev` 和 `npm start`。

`deploy.sh` 沿用原服务器的既有 systemd 部署约定：应用位于 `/opt/modern-art/app`，Node 位于 `/opt/node/bin/node`，数据位于 `/var/lib/modern-art`，服务名为 `modern-art`。它接受服务器 `/tmp/` 下的 ZIP 路径及打包时输出的 SHA256，检查服务、备份数据并替换版本，失败时回滚。它不用于首次配置服务器。

部署目标通过本机环境变量 `MODERN_ART_DEPLOY_HOST` 配置，SSH 使用本机密钥或 ssh-agent；不要把真实主机地址、IP 或密钥写入源码。需要发布时先验证和打包，再上传 ZIP 与 `scripts/deploy.sh`，在服务器执行 `bash <deploy.sh 路径> /tmp/<包名>.zip <SHA256>`。发布后验证 `/health`、首页、WebSocket 和服务状态。当前拆仓仅整理工具，没有执行服务器发布。

旧版本位于 `/opt/modern-art/app.prev`。需要回滚时，停止服务，保留当前 app 至唯一备份目录，将 app.prev 恢复为 app，再启动并检查。保留 `/var/lib/modern-art` 的当前房间存档。

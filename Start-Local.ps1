$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 22.12 或更新版本。' }
if (-not (Test-Path -LiteralPath 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' } }
if (-not (Test-Path -LiteralPath 'dist/index.html')) { npm run build; if ($LASTEXITCODE -ne 0) { throw '网页构建失败' } }
Write-Host '打开 http://127.0.0.1:8787/ 开始试玩。按 Ctrl+C 停止服务。'
npm start

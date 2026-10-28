# 发布 Workset Windows 便携版

所有安装、测试和打包命令均在 `workset` 目录执行。需要 Windows x64、Node.js 22.12+。

```powershell
npm ci
npm test
npm run package:win
```

`package:win` 从当前源码重新构建，输出：

- `dist/releases/Workset-<版本>-windows-x64.zip`：包含完整 `Workset/` 目录的便携版。
- `dist/releases/SHA256SUMS.txt`：ZIP 的 SHA-256 校验值。
- `dist/releases/release.json`：版本、标签、大小、校验值和可执行文件路径，供验证和发布流程读取。
- `dist/release-build/workset-<版本>-win32-x64/Workset.exe`：该 ZIP 对应的独立构建，不覆盖日常运行的 `dist/Workset-win32-x64`。

已有同版本输出时会停止，请先移走旧输出，避免覆盖正在使用的程序。

验证打包版：

```powershell
$release = Get-Content dist/releases/release.json -Raw | ConvertFrom-Json
$env:WORKSET_EXE = Join-Path (Get-Location) $release.executable
npm run test:compact
npm run test:pin
npm run test:desktop
```

GitHub 的 `Workset Windows Release` 工作流在推送到 `main` 且修改 `workset/package.json` 或发布工作流时触发，也可以在 Actions 页面手动运行。Windows runner 安装锁定依赖，运行逻辑测试，生成 ZIP，验证打包版，再创建 `workset-v<版本>` Release 并上传 ZIP 和校验文件。先上传到草稿，确认附件完整后才公开发布。

新版本请更新 `package.json` 与 `package-lock.json` 的版本号，以及 `docs/release-notes.md`。已公开的版本不会被覆盖；同一提交的未完成草稿允许重试上传。发布脚本使用 Actions 提供的短期 `GITHUB_TOKEN`，不需要在源码内放置个人令牌。

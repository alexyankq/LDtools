// Run by the Windows GitHub Actions job after the packaged application passes.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const release = require('../dist/releases/release.json');
const repository = process.env.GITHUB_REPOSITORY;
const revision = process.env.GITHUB_SHA;
if (!repository || !revision || !process.env.GH_TOKEN) throw new Error('发布需要 GitHub Actions 提供的仓库、提交和 GH_TOKEN');
function gh(args) {
  const result = spawnSync('gh', [...args, '--repo', repository], { encoding: 'utf8', cwd: root, windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `gh 退出码 ${result.status}`);
  return result.stdout;
}
const releases = JSON.parse(gh(['release', 'list', '--limit', '1000', '--json', 'tagName,isDraft']));
const existing = releases.find(item => item.tagName === release.tag);
if (existing) {
  const details = JSON.parse(gh(['release', 'view', release.tag, '--json', 'isDraft,targetCommitish']));
  if (!details.isDraft || details.targetCommitish !== revision) throw new Error('该版本已存在，不能覆盖已公开发布或来自其他提交的版本');
}
const assets = [release.filename, 'SHA256SUMS.txt'].map(name => path.join(root, 'dist/releases', name));
assets.forEach(file => { if (!fs.existsSync(file)) throw new Error(`缺少附件：${file}`); });
if (!existing) gh(['release', 'create', release.tag, '--draft', '--target', revision, '--title', `Workset v${release.version} · Windows x64`, '--notes-file', path.join(root, 'docs/release-notes.md')]);
gh(['release', 'upload', release.tag, ...assets, '--clobber']);
const uploaded = JSON.parse(gh(['release', 'view', release.tag, '--json', 'assets']));
for (const file of assets) {
  const asset = uploaded.assets.find(asset => asset.name === path.basename(file));
  if (!asset || asset.size !== fs.statSync(file).size) throw new Error(`附件未完整上传：${file}`);
}
gh(['release', 'edit', release.tag, '--draft=false']);
console.log(gh(['release', 'view', release.tag, '--json', 'url,isDraft,assets']));

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const { ZipFile } = require('yazl');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('此发布脚本需要 Windows x64');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('请使用有效的稳定版本号');
const filename = `Workset-${pkg.version}-windows-x64.zip`;
const output = path.join(root, 'dist', 'releases');
const build = path.join(root, 'dist', 'release-build', `workset-${pkg.version}-win32-x64`);
if (fs.existsSync(path.join(output, filename)) || fs.existsSync(build)) throw new Error('此版本已有打包输出，请先移走旧输出再重新打包');
const result = spawnSync(process.execPath, [path.join(__dirname, 'build.cjs'), '--out-dir', build], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const zip = new ZipFile();
  const archive = path.join(output, filename);
  const complete = pipeline(zip.outputStream, fs.createWriteStream(archive, { flags: 'wx' }));
  zip.on('error', error => zip.outputStream.destroy(error));
  const files = fs.readdirSync(build, { recursive: true }).sort();
  let count = 0;
  for (const relative of files) {
    const source = path.join(build, relative);
    if (!fs.statSync(source).isFile()) continue;
    zip.addFile(source, 'Workset/' + relative.replaceAll('\\', '/'), { compressionLevel: 6 });
    count++;
  }
  zip.addBuffer(Buffer.from(`工作集 Workset ${pkg.version}\r\n\r\n解压整个 Workset 文件夹，双击 Workset.exe 即可运行。\r\n请保留 DLL、resources 和 locales 等全部文件，不能仅复制 EXE。\r\n不需要安装 Node.js 或 Python。脚本快捷方式仍需对应的运行环境。\r\n个人工作集保存在 %APPDATA%\\ldtools-workset，更新程序不会删除配置。\r\n`), 'Workset/开始使用.txt');
  zip.end();
  await complete;
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${sha256}  ${filename}\n`);
  const metadata = { version: pkg.version, tag: `workset-v${pkg.version}`, filename, sha256, bytes: fs.statSync(archive).size, files: count + 1, executable: path.relative(root, path.join(build, 'Workset.exe')) };
  fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify(metadata, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });

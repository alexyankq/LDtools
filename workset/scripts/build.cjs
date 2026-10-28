const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'win32') throw new Error('请在 Windows 上构建 Windows 便携版');
const electron = require('electron');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out-dir')) throw new Error('用法：node scripts/build.cjs [--out-dir dist/目标目录]');
const dist = path.join(root, 'dist');
const target = args.length ? path.resolve(root, args[1]) : path.join(dist, `Workset-win32-${process.arch}`);
if (!target.startsWith(dist + path.sep)) throw new Error('构建输出必须位于 workset/dist 内');
if (fs.existsSync(target)) throw new Error(`输出目录已存在，请关闭旧程序并将其移走后重新构建：${target}`);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(path.dirname(electron), target, { recursive: true });
fs.renameSync(path.join(target, 'electron.exe'), path.join(target, 'Workset.exe'));
const app = path.join(target, 'resources', 'app');
fs.mkdirSync(app, { recursive: true });
fs.cpSync(path.join(root, 'src'), path.join(app, 'src'), { recursive: true });
for (const dependency of ['koffi', `@koromix/koffi-win32-${process.arch}`]) {
  fs.cpSync(path.join(root, 'node_modules', dependency), path.join(app, 'node_modules', dependency), { recursive: true });
}
const pkg = require('../package.json');
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main, dependencies: pkg.dependencies }, null, 2));
fs.copyFileSync(path.join(root, 'README.md'), path.join(target, 'README.md'));
console.log(`便携版已生成：${path.join(target, 'Workset.exe')}\n请保留整个文件夹一起使用或分发。`);

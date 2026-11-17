/**
 * 生成自动更新用的发布物：
 *
 *   app-update/version.json   版本号 + app.asar 的 SHA-256 和字节数
 *   app-update/app.asar       打包出来的 app.asar（约 1.4 MB，仅此一个文件参与更新）
 *
 * 这两个文件随版本一起提交，客户端通过 raw.githubusercontent.com（或 jsDelivr 镜像）
 * 拉清单、比对哈希、只下变动的 app.asar。exe 和 Electron 运行时不参与更新，
 * 所以不用每次重发 370 MB。
 *
 *   pnpm build:app 的最后一环：node 工具读 package.json 与 app-release/win-unpacked
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const asar = resolve(root, 'app-release/win-unpacked/resources/app.asar');
const outDir = resolve(root, 'app-update');

if (!existsSync(asar)) {
  console.error(`找不到 ${asar}，先跑 pnpm build:app（或 electron-builder --win）`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
const bytes = readFileSync(asar);

mkdirSync(outDir, { recursive: true });
copyFileSync(asar, resolve(outDir, 'app.asar'));

const manifest = {
  version: pkg.version,
  file: 'app.asar',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: statSync(asar).size,
};

writeFileSync(resolve(outDir, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(
  `已生成 app-update/：版本 ${manifest.version}，app.asar ${(manifest.size / 1024 / 1024).toFixed(2)} MB，` +
    `SHA-256 ${manifest.sha256.slice(0, 12)}…`,
);

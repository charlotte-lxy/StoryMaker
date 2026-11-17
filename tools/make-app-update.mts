/**
 * 生成自动更新用的发布物：
 *
 *   app-update/version.json    版本号 + app.asar 的 SHA-256 和字节数
 *   app-update/app.asar        打包出来的 app.asar（约 1.5 MB，仅此一个文件参与更新）
 *   app-update/changelog.json  由根目录 CHANGELOG.md 转成的更新日志，客户端按版本区间展示
 *
 * 这些文件随版本一起提交，客户端通过 raw.githubusercontent.com（或 jsDelivr 镜像）
 * 拉清单、比对哈希、只下变动的 app.asar。exe 和 Electron 运行时不参与更新，
 * 所以不用每次重发 370 MB。
 *
 *   pnpm build:app 的最后一环：node 工具读 package.json、CHANGELOG.md 与 app-release/win-unpacked
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { compareVersions } = require('../electron/update-core.cjs') as {
  compareVersions: (left: string, right: string) => number;
};

const root = process.cwd();
const asar = resolve(root, 'app-release/win-unpacked/resources/app.asar');
const outDir = resolve(root, 'app-update');

if (!existsSync(asar)) {
  console.error(`找不到 ${asar}，先跑 pnpm build:app（或 electron-builder --win）`);
  process.exit(1);
}

/**
 * CHANGELOG.md 的格式：
 *
 *   ## 0.6.6
 *   - 一条改动
 *   - 另一条改动
 *
 * 只认二级标题加 `- ` 列表；最新的放最前面（写文件时会再按版本号排一次）。
 */
function parseChangelog(text: string): { version: string; items: string[] }[] {
  const versions: { version: string; items: string[] }[] = [];
  let current: { version: string; items: string[] } | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^##\s+(\d+(?:\.\d+)*)\s*$/.exec(line);
    if (heading !== null) {
      current = { version: heading[1] ?? '', items: [] };
      versions.push(current);
      continue;
    }
    if (current === null) continue;
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet !== null) current.items.push((bullet[1] ?? '').trim());
  }

  return versions.filter((entry) => entry.items.length > 0);
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
const bytes = readFileSync(asar);

const changelogPath = resolve(root, 'CHANGELOG.md');
if (!existsSync(changelogPath)) {
  console.error('找不到 CHANGELOG.md：更新弹窗要靠它展示更新内容，先给当前版本写一条记录');
  process.exit(1);
}

const notes = parseChangelog(readFileSync(changelogPath, 'utf8')).sort((left, right) =>
  compareVersions(right.version, left.version),
);
if (!notes.some((entry) => entry.version === pkg.version)) {
  console.error(`CHANGELOG.md 里没有 ${pkg.version} 的条目，先补上再打包`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(asar, resolve(outDir, 'app.asar'));

const manifest = {
  version: pkg.version,
  file: 'app.asar',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: statSync(asar).size,
};

writeFileSync(resolve(outDir, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
writeFileSync(resolve(outDir, 'changelog.json'), `${JSON.stringify({ versions: notes }, null, 2)}\n`, 'utf8');

console.log(
  `已生成 app-update/：版本 ${manifest.version}，app.asar ${(manifest.size / 1024 / 1024).toFixed(2)} MB，` +
    `SHA-256 ${manifest.sha256.slice(0, 12)}…，更新日志 ${notes.length} 个版本`,
);

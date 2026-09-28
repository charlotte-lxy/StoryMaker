/**
 * 把启动器和本地服务脚本放进单文件产物目录。
 *
 * 单文件 index.html 是给策划双击的，但它自己读不了磁盘：
 * 真正的按路径读写由本地服务代理，所以必须和 index.html 放在同一个文件夹里打包。
 *
 *   pnpm exec vite-node tools/make-launcher.mts
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const from = resolve(process.cwd(), 'tools/server');
const to = resolve(process.cwd(), 'release');

mkdirSync(to, { recursive: true });

/** 统一成 CRLF：.bat 用 LF 会在 cmd 里出些莫名其妙的毛病 */
const crlf = (text: string): string => text.replace(/\r?\n/g, '\r\n');

// .bat 里只有 ASCII，中文只出现在文件名上，交给资源管理器即可
writeFileSync(
  resolve(to, '启动StoryMaker.bat'),
  crlf(readFileSync(resolve(from, '启动StoryMaker.bat'), 'utf8')),
  'utf8',
);

// .ps1 里有中文提示，而 Windows PowerShell 5.1 读不带 BOM 的脚本会按 ANSI 解析，
// 中文会变成乱码甚至语法错误，所以这里必须补上 UTF-8 BOM。
const server = readFileSync(resolve(from, 'storymaker-server.ps1'), 'utf8').replace(/^\uFEFF/, '');
writeFileSync(resolve(to, 'storymaker-server.ps1'), '\uFEFF' + crlf(server), 'utf8');

/**
 * 版本清单：本地服务启动时拉远端这份来比，只下载真的变了的文件。
 *
 * 记的是文件内容的 SHA-256 而不是 commit：这样"构建完还没提交"也不会漏更新，
 * 也能按文件逐个判断——index.html 变了就不必惊动服务端脚本，也就不必要求重启。
 */
const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

// 版本号取自 package.json。只比哈希的话，本地刚构建、还没推上去的新版会被仓库里的
// 旧版倒着覆盖回去——本地服务靠这个号判断"远端到底是不是更新的版本"。
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  version: string;
};

const manifest = {
  version: pkg.version,
  'index.html': sha256(resolve(to, 'index.html')),
  'storymaker-server.ps1': sha256(resolve(to, 'storymaker-server.ps1')),
  '启动StoryMaker.bat': sha256(resolve(to, '启动StoryMaker.bat')),
};
writeFileSync(resolve(to, 'version.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('已把启动器放进 release/：启动StoryMaker.bat、storymaker-server.ps1、version.json');

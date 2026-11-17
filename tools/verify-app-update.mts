/**
 * 自检 Electron 自动更新的纯逻辑（不启动窗口、不碰真实网络）：
 *
 *   pnpm verify:app-update
 *
 * 覆盖：版本比较、清单校验、多源兜底（GitHub raw 挂了就换 jsDelivr）、
 * 下载后按 SHA-256 / 大小核对、校验不过不留文件。
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Manifest {
  version: string;
  file: string;
  sha256: string;
  size: number;
}

interface Changelog {
  versions: { version: string; items: string[] }[];
}

interface DownloadOptions {
  urls: string[];
  target: string;
  sha256: string;
  size: number;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  attempts?: number;
}

interface UpdateCore {
  updateBases(value?: string): string[];
  compareVersions(a: string, b: string): number;
  parseManifest(text: string): Manifest | null;
  newestManifest(entries: { manifest: Manifest }[]): { manifest: Manifest } | null;
  parseChangelog(text: string): Changelog | null;
  collectNotes(changelog: Changelog | null, current: string, latest: string): { version: string; items: string[] }[];
  downloadVerified(options: DownloadOptions): Promise<{ ok: boolean; message?: string; url?: string }>;
}

const require = createRequire(import.meta.url);
const core = require('../electron/update-core.cjs') as UpdateCore;

let failed = false;
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`✓ ${label}`);
    return;
  }
  failed = true;
  console.error(`✗ ${label}${detail === '' ? '' : `：${detail}`}`);
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

async function main(): Promise<void> {
  // ---------- 版本号比较 ----------
  check(core.compareVersions('0.1.64', '0.1.63') > 0, '0.1.64 比 0.1.63 新');
  check(core.compareVersions('0.1.10', '0.1.9') > 0, '按数字段比较：0.1.10 比 0.1.9 新');
  check(core.compareVersions('0.2.0', '0.1.99') > 0, '0.2.0 比 0.1.99 新');
  check(core.compareVersions('0.1.63', '0.1.63') === 0, '相同版本返回 0');

  // ---------- 清单校验 ----------
  const goodManifest = {
    version: '0.1.64',
    file: 'app.asar',
    sha256: 'a'.repeat(64),
    size: 1024,
  };
  check(core.parseManifest(JSON.stringify(goodManifest)) !== null, '合法清单能解析');
  check(
    core.parseManifest(JSON.stringify({ ...goodManifest, file: '../evil.asar' })) === null,
    '清单里的文件名只能是 app.asar',
  );
  check(
    core.parseManifest(JSON.stringify({ ...goodManifest, sha256: 'xyz' })) === null,
    'SHA-256 格式不对的清单被拒',
  );
  check(
    core.parseManifest(JSON.stringify({ ...goodManifest, version: 'v0.1.64' })) === null,
    '版本号不是纯数字段时被拒',
  );
  check(core.parseManifest('{ 坏掉的 json') === null, '坏 JSON 被拒');

  // ---------- 更新日志 ----------
  const changelog = core.parseChangelog(
    JSON.stringify({
      versions: [
        { version: '0.6.7', items: ['比最新还新的内容不该出现'] },
        { version: '0.6.6', items: ['检查更新时显示更新内容'] },
        { version: '0.6.5', items: ['导入按钮改名'] },
        { version: '0.6.4', items: [] },
        { version: '0.6.3', items: ['素材管理'] },
      ],
    }),
  );
  check(changelog !== null, '更新日志能解析');
  const notes = core.collectNotes(changelog, '0.6.3', '0.6.6');
  check(
    notes.length === 2 && notes[0]?.version === '0.6.6' && notes[1]?.version === '0.6.5',
    '只取当前版本之后、最新版本之前的条目，按新→旧排列',
  );
  check(
    notes.every((note) => note.items.length > 0),
    '没有条目的版本不进更新日志',
  );
  check(core.collectNotes(changelog, '0.6.6', '0.6.6').length === 0, '已经是最新版时没有更新日志');
  check(core.parseChangelog('不是 json') === null, '坏掉的更新日志被拒');

  // ---------- 更新源 ----------
  const defaults = core.updateBases('');
  check(
    defaults.some((item) => item.includes('raw.githubusercontent.com')) &&
      defaults.some((item) => item.includes('cdn.jsdelivr.net')),
    '默认同时有 GitHub raw 和 jsDelivr',
  );
  const custom = core.updateBases('https://a.example/base/, https://b.example/base');
  check(
    custom.length === 2 && custom[0] === 'https://a.example/base',
    'STORYMAKER_APP_UPDATE_BASE 可用逗号覆盖并去掉结尾斜杠',
  );

  // ---------- 多源下载 ----------
  const asarBytes = Buffer.from('fake app.asar content — 更新包');
  const goodHash = sha256(asarBytes);
  const workDir = mkdtempSync(join(tmpdir(), 'storymaker-app-update-'));
  let server: Server | null = null;

  try {
    server = createServer((request, response) => {
      const url = request.url ?? '';
      if (url === '/good/app.asar') {
        response.writeHead(200);
        response.end(asarBytes);
        return;
      }
      if (url === '/bad-hash/app.asar') {
        response.writeHead(200);
        response.end(Buffer.from('tampered'));
        return;
      }
      response.writeHead(404);
      response.end('not found');
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const successTarget = join(workDir, 'app.asar.new');
    const success = await core.downloadVerified({
      urls: [`${base}/missing/app.asar`, `${base}/good/app.asar`],
      target: successTarget,
      sha256: goodHash,
      size: asarBytes.length,
      fetchImpl: fetch,
    });
    check(success.ok, '第一个源 404 时自动换下一个源');
    check(
      existsSync(successTarget) && readFileSync(successTarget).equals(asarBytes),
      '下载并校验通过后写入目标文件',
    );

    const badTarget = join(workDir, 'bad.asar.new');
    const bad = await core.downloadVerified({
      urls: [`${base}/bad-hash/app.asar`],
      target: badTarget,
      sha256: goodHash,
      size: Buffer.from('tampered').length,
      fetchImpl: fetch,
      attempts: 1,
    });
    check(!bad.ok, '哈希对不上时判定失败');
    check(!existsSync(badTarget), '哈希对不上时不留半截文件');
    check(!existsSync(`${badTarget}.tmp`), '临时文件也被清掉');

    const sizeTarget = join(workDir, 'size.asar.new');
    const wrongSize = await core.downloadVerified({
      urls: [`${base}/good/app.asar`],
      target: sizeTarget,
      sha256: goodHash,
      size: asarBytes.length + 1,
      fetchImpl: fetch,
      attempts: 1,
    });
    check(!wrongSize.ok, '大小和清单不一致时判定失败');

    // ---------- 挑最新清单 ----------
    const older = { manifest: { ...goodManifest, version: '0.1.62' } };
    const newer = { manifest: { ...goodManifest, version: '0.1.65' } };
    const newest = core.newestManifest([older, newer]);
    check(newest?.manifest.version === '0.1.65', '多源清单取版本号最大的那个');
  } finally {
    if (server !== null) await new Promise<void>((done) => server!.close(() => done()));
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
process.exitCode = failed ? 1 : 0;

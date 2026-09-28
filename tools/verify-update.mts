/**
 * 验证"启动时自动检查更新"这条链路。
 *
 *   pnpm exec vite-node tools/verify-update.mts
 *
 * 用一个本地 HTTP 服务冒充 GitHub 远端——storymaker-server.ps1 认
 * STORYMAKER_UPDATE_BASE 这个环境变量，所以校验不必依赖真实网络，
 * 也不会因为 GitHub 抽风而时红时绿。测四种情况：
 *
 *   1. 远端有新版 index.html        → 本地被换掉，页面发出去的也是新版
 *   2. 远端连不上                   → 文件原样不动，服务照常起来
 *   3. 服务端脚本自己也有新版       → 正在运行的 .ps1 能被替换，并提示重启
 *   4. 下载下来的字节和清单对不上   → 不替换，也不留半截临时文件
 */

import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createProbeServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const releaseDir = resolve(root, 'release');
const sourceScript = join(releaseDir, 'storymaker-server.ps1');
const sourceBat = join(releaseDir, '启动StoryMaker.bat');

if (!existsSync(sourceScript) || !existsSync(sourceBat)) {
  console.error('没有找到 release/ 里的启动器，请先运行 pnpm run build:single');
  process.exit(1);
}

const sha256 = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

let failed = false;
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`✓ ${label}`);
    return;
  }
  failed = true;
  console.error(`✗ ${label}${detail === '' ? '' : `：${detail}`}`);
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createProbeServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

interface Running {
  child: ChildProcess;
  base: string;
  output: () => string;
}

/** 每个用例一套独立的目录：拷一份真的启动器，页面由用例自己伪造 */
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'storymaker-update-'));
  copyFileSync(sourceScript, join(dir, 'storymaker-server.ps1'));
  copyFileSync(sourceBat, join(dir, '启动StoryMaker.bat'));
  return dir;
}

async function startServer(dir: string, updateBase: string, port: number): Promise<Running> {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(dir, 'storymaker-server.ps1'),
      '-NoBrowser',
      '-Port',
      String(port),
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        STORYMAKER_SESSION_FILE: join(dir, 'session.json'),
        STORYMAKER_UPDATE_BASE: updateBase,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let log = '';
  child.stdout?.on('data', (chunk) => {
    log += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    log += String(chunk);
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/ping`, {
        method: 'POST',
        signal: AbortSignal.timeout(2000),
      });
      if (response.status === 403) return { child, base, output: () => log };
    } catch {
      // 还没起来，接着等
    }
    await new Promise((done) => setTimeout(done, 250));
  }

  child.kill();
  throw new Error(`本地服务 30 秒内没起来。输出：\n${log}`);
}

async function stopServer(running: Running | null): Promise<void> {
  if (running === null) return;
  running.child.kill();
  await new Promise((done) => setTimeout(done, 400));
}

/** 冒充远端：按请求路径发文件，没有的就 404 */
function fakeRemote(files: Record<string, string | Buffer>) {
  const server = createHttpServer((request, response) => {
    const name = decodeURIComponent((request.url ?? '/').replace(/^\//, ''));
    const body = files[name];
    if (body === undefined) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.end(body);
  });
  return new Promise<{ base: string; close: () => Promise<void> }>((done, fail) => {
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      done({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((ok) => server.close(() => ok())),
      });
    });
  });
}

/** 清单里除了 index.html 之外的文件都声明成"和本地一致"，这样只有目标文件会动 */
function manifest(dir: string, indexPage: string): string {
  return JSON.stringify({
    'index.html': sha256(Buffer.from(indexPage, 'utf8')),
    'storymaker-server.ps1': sha256(readFileSync(join(dir, 'storymaker-server.ps1'))),
    '启动StoryMaker.bat': sha256(readFileSync(join(dir, '启动StoryMaker.bat'))),
  });
}

let running: Running | null = null;
let cleanupRemote: (() => Promise<void>) | null = null;
let fixture = '';

try {
  // ---------- 1. 远端有新版 index.html ----------
  console.log('【1】远端有新版 index.html');
  fixture = makeFixture();
  const oldPage = '<html><body>本机旧版</body></html>';
  const newPage = '<html><body>远端新版内容</body></html>';
  writeFileSync(join(fixture, 'index.html'), oldPage, 'utf8');
  {
    const remote = await fakeRemote({
      'version.json': manifest(fixture, newPage),
      'index.html': newPage,
    });
    cleanupRemote = remote.close;
    const port = await freePort();
    running = await startServer(fixture, remote.base, port);

    check(
      readFileSync(join(fixture, 'index.html'), 'utf8') === newPage,
      '本地 index.html 被换成了远端新版',
    );
    const page = await fetch(`${running.base}/`, { signal: AbortSignal.timeout(10_000) });
    const text = await page.text();
    check(text.includes('远端新版内容'), '服务发出去的确实是新版页面');
    check(!running.output().includes('重新双击'), '只换 index.html 时不提示重启');
  }
  await stopServer(running);
  running = null;
  await cleanupRemote?.();
  cleanupRemote = null;
  rmSync(fixture, { recursive: true, force: true });

  // ---------- 2. 远端连不上 ----------
  console.log('');
  console.log('【2】远端连不上');
  fixture = makeFixture();
  const localPage = '<html><body>本机版</body></html>';
  writeFileSync(join(fixture, 'index.html'), localPage, 'utf8');
  {
    const deadPort = await freePort(); // 拿到端口但不监听，连过去直接被拒
    const port = await freePort();
    running = await startServer(fixture, `http://127.0.0.1:${deadPort}`, port);

    check(
      readFileSync(join(fixture, 'index.html'), 'utf8') === localPage,
      '连不上时本地文件原样不动',
    );
    const response = await fetch(`${running.base}/`, { signal: AbortSignal.timeout(10_000) });
    check(response.status === 200, '连不上时服务照常启动，页面正常发出去');
    check(!existsSync(join(fixture, 'index.html.new')), '没留下半截的 .new 临时文件');
  }
  await stopServer(running);
  running = null;
  rmSync(fixture, { recursive: true, force: true });

  // ---------- 3. 服务端脚本自己也有新版 ----------
  console.log('');
  console.log('【3】服务端脚本自己也有新版');
  fixture = makeFixture();
  const steadyPage = '<html><body>页面</body></html>';
  writeFileSync(join(fixture, 'index.html'), steadyPage, 'utf8');
  {
    const oldScript = readFileSync(join(fixture, 'storymaker-server.ps1'));
    const newScript = Buffer.concat([
      oldScript,
      Buffer.from('\r\n# 校验用：模拟服务端脚本有了新版\r\n', 'utf8'),
    ]);
    const remote = await fakeRemote({
      'version.json': JSON.stringify({
        'index.html': sha256(Buffer.from(steadyPage, 'utf8')),
        'storymaker-server.ps1': sha256(newScript),
        '启动StoryMaker.bat': sha256(readFileSync(join(fixture, '启动StoryMaker.bat'))),
      }),
      'storymaker-server.ps1': newScript,
    });
    cleanupRemote = remote.close;
    const port = await freePort();
    running = await startServer(fixture, remote.base, port);

    const after = readFileSync(join(fixture, 'storymaker-server.ps1'));
    check(
      sha256(after) === sha256(newScript),
      '正在运行的服务端脚本也能被自己换掉（Windows 没锁死它）',
    );
    check(running.output().includes('重新双击'), '换了服务端脚本就提示重新启动');
    const response = await fetch(`${running.base}/`, { signal: AbortSignal.timeout(10_000) });
    check(response.status === 200, '换完脚本当次启动不受影响，服务照常起来');
  }
  await stopServer(running);
  running = null;
  await cleanupRemote?.();
  cleanupRemote = null;
  rmSync(fixture, { recursive: true, force: true });

  // ---------- 4. 下载内容与清单对不上 ----------
  console.log('');
  console.log('【4】下载内容与清单对不上');
  fixture = makeFixture();
  const keepPage = '<html><body>本机版</body></html>';
  writeFileSync(join(fixture, 'index.html'), keepPage, 'utf8');
  {
    const remote = await fakeRemote({
      'version.json': manifest(fixture, '<html>清单里说的新版</html>'),
      'index.html': '<html>实际发下来的却是别的东西</html>',
    });
    cleanupRemote = remote.close;
    const port = await freePort();
    running = await startServer(fixture, remote.base, port);

    check(
      readFileSync(join(fixture, 'index.html'), 'utf8') === keepPage,
      '字节对不上清单时不替换，仍用本机这份',
    );
    check(!existsSync(join(fixture, 'index.html.new')), '不留下校验失败的 .new 文件');
  }
  await stopServer(running);
  running = null;
  await cleanupRemote?.();
  cleanupRemote = null;
  rmSync(fixture, { recursive: true, force: true });

  // ---------- 5. 页面和服务端同时有新版 ----------
  console.log('');
  console.log('【5】页面和服务端同时有新版');
  fixture = makeFixture();
  const oldPage5 = '<html><body>旧版页面</body></html>';
  const newPage5 = '<html><body>新版页面</body></html>';
  writeFileSync(join(fixture, 'index.html'), oldPage5, 'utf8');
  {
    const oldScript = readFileSync(join(fixture, 'storymaker-server.ps1'));
    const newScript = Buffer.concat([
      oldScript,
      Buffer.from('\r\n# 校验用：模拟服务端脚本有了新版\r\n', 'utf8'),
    ]);
    const remote = await fakeRemote({
      'version.json': JSON.stringify({
        'index.html': sha256(Buffer.from(newPage5, 'utf8')),
        'storymaker-server.ps1': sha256(newScript),
        '启动StoryMaker.bat': sha256(readFileSync(join(fixture, '启动StoryMaker.bat'))),
      }),
      'index.html': newPage5,
      'storymaker-server.ps1': newScript,
    });
    cleanupRemote = remote.close;

    const port = await freePort();
    running = await startServer(fixture, remote.base, port);

    check(
      sha256(readFileSync(join(fixture, 'storymaker-server.ps1'))) === sha256(newScript),
      '服务端脚本先换成了新版',
    );
    check(
      readFileSync(join(fixture, 'index.html'), 'utf8') === oldPage5,
      '页面这次不换：跟内存里那份旧服务端保持同一版',
    );
    const firstPage = await (
      await fetch(`${running.base}/`, { signal: AbortSignal.timeout(10_000) })
    ).text();
    check(firstPage.includes('旧版页面'), '本次发出去的仍是旧页面，没有新旧混搭');
    check(running.output().includes('留到下次启动'), '说明了页面为什么这次不换');
    check(running.output().includes('重新双击'), '提示了需要重新启动');

    // 再启动一次，模拟策划重新双击：这回两边一起变新
    await stopServer(running);
    running = null;
    const secondPort = await freePort();
    running = await startServer(fixture, remote.base, secondPort);

    check(
      readFileSync(join(fixture, 'index.html'), 'utf8') === newPage5,
      '重启后页面才换成新版，两边同步',
    );
    const secondPage = await (
      await fetch(`${running.base}/`, { signal: AbortSignal.timeout(10_000) })
    ).text();
    check(secondPage.includes('新版页面'), '重启后发出去的是新页面');
    check(!running.output().includes('重新双击'), '两边都换完了就不再提示重启');
  }
  await stopServer(running);
  running = null;
  await cleanupRemote?.();
  cleanupRemote = null;
  rmSync(fixture, { recursive: true, force: true });
} catch (error) {
  failed = true;
  console.error('✗ 校验过程出错：', error);
  if (running !== null) console.error((running as Running).output());
} finally {
  await stopServer(running);
  await cleanupRemote?.();
  if (fixture !== '') rmSync(fixture, { recursive: true, force: true });
}

if (failed) {
  console.error('');
  console.error('自动更新校验没通过。');
  process.exit(1);
}

console.log('');
console.log('自动更新校验通过：有更新会换、连不上照常启动、服务端脚本能自替换。');

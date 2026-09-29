/**
 * 验证本地服务（release/storymaker-server.ps1）真的能按路径读写项目文件。
 *
 *   pnpm exec vite-node tools/verify-server.mts
 *
 * 这是"策划双击 .bat"那条链路的实机检验：真的起进程、真的发 HTTP、真的落盘。
 * 校验用的临时目录不会碰到本机记住的项目路径。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const releaseDir = resolve(root, 'release');
const serverScript = join(releaseDir, 'storymaker-server.ps1');

if (!existsSync(serverScript)) {
  console.error('没有找到 release/storymaker-server.ps1，请先运行 pnpm run build:single');
  process.exit(1);
}
if (!existsSync(join(releaseDir, 'index.html'))) {
  console.error('没有找到 release/index.html，请先运行 pnpm run build:single');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'storymaker-verify-'));
const sessionFile = join(work, 'session.json');
const projectFile = join(work, '序章.json');
const otherFile = join(work, '别的.json');

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
    const probe = createServer();
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

async function startServer(port: number): Promise<Running> {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      serverScript,
      '-NoBrowser',
      // 校验不碰网络：不然本地服务每次起来都会去连 GitHub 查更新
      '-NoUpdate',
      '-Port',
      String(port),
    ],
    {
      cwd: releaseDir,
      env: { ...process.env, STORYMAKER_SESSION_FILE: sessionFile },
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

  // 等到能应答为止：没带令牌时服务会回 403，这本身就说明它起来了
  const deadline = Date.now() + 20_000;
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
  throw new Error(`本地服务 20 秒内没起来。输出：\n${log}`);
}

async function stopServer(running: Running | null): Promise<void> {
  if (running === null) return;
  running.child.kill();
  await new Promise((done) => setTimeout(done, 400));
}

function api(
  running: Running,
  path: string,
  options: { token?: string; body?: string } = {},
): Promise<Response> {
  return fetch(`${running.base}${path}`, {
    method: 'POST',
    headers: {
      ...(options.token === undefined ? {} : { 'X-StoryMaker-Token': options.token }),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    },
    body: options.body,
    signal: AbortSignal.timeout(20_000),
  });
}

/** 每次启动的令牌都是新的，重启后要重新从页面里取一遍 */
async function getPage(running: Running): Promise<{ text: string; token: string }> {
  const page = await fetch(`${running.base}/`, { signal: AbortSignal.timeout(20_000) });
  const text = await page.text();
  const token = /__STORYMAKER_SERVER__=\{"token":"([0-9a-f]+)"\}/.exec(text)?.[1] ?? '';
  return { text, token };
}

let running: Running | null = null;

try {
  const port = await freePort();
  running = await startServer(port);
  console.log(`✓ 本地服务已启动：${running.base}`);

  // 页面：必须注入令牌，否则前端根本认不出宿主
  const { text: pageText, token } = await getPage(running);
  check(pageText.includes('__STORYMAKER_SERVER__'), '页面里注入了宿主标记');
  check(pageText.includes('StoryMaker'), '页面内容是 StoryMaker 单文件产物');
  check(token.length === 32, '页面里带上了 32 位随机令牌', token);

  const noToken = await api(running, '/api/last-path');
  check(noToken.status === 403, '没有令牌的请求被拒绝', String(noToken.status));

  const badToken = await api(running, '/api/last-path', { token: 'x'.repeat(32) });
  check(badToken.status === 403, '令牌不对的请求被拒绝', String(badToken.status));

  const lastPath = await api(running, '/api/last-path', { token });
  const lastPathData = (await lastPath.json()) as { filePath: string | null };
  check(lastPathData.filePath === null, '还没记住任何路径时返回 null');

  const writeWithout = await api(running, `/api/write?path=${encodeURIComponent(projectFile)}`, {
    token,
    body: '{}',
  });
  check(writeWithout.status === 403, '没绑定项目文件之前不许写盘', String(writeWithout.status));

  const remember = await api(running, `/api/remember?path=${encodeURIComponent(projectFile)}`, {
    token,
  });
  check(remember.status === 200, '记住了项目文件路径');

  // 3MB 左右的中文正文：顺带验证请求体是分多次读进来的
  const big = JSON.stringify({
    version: 1,
    name: '验证项目',
    note: '中文内容'.repeat(60_000),
    chapters: [{ uid: 'c1', id: 'ch01', title: '序章', groups: [] }],
  });
  const written = await api(running, `/api/write?path=${encodeURIComponent(projectFile)}`, {
    token,
    body: big,
  });
  check(written.status === 200, `写盘成功（${Math.round(big.length / 1024)} KB）`);

  const onDisk = readFileSync(projectFile, 'utf8');
  check(onDisk === big, '磁盘上的内容和发出去的一模一样（UTF-8 原样落盘）');
  check(!onDisk.startsWith('\uFEFF'), '落盘不带 BOM');

  const read = await api(running, `/api/read?path=${encodeURIComponent(projectFile)}`, { token });
  check(read.status === 200, '按路径读回成功');
  check((await read.text()) === big, '读回的内容和写进去的一致');

  // 带 BOM 的项目文件也要能读（记事本另存为就会加 BOM）
  const { writeFileSync } = await import('node:fs');
  writeFileSync(otherFile, '\uFEFF' + JSON.stringify({ version: 1, name: '带BOM', chapters: [] }));
  await api(running, `/api/remember?path=${encodeURIComponent(otherFile)}`, { token });
  const bom = await api(running, `/api/read?path=${encodeURIComponent(otherFile)}`, { token });
  const bomText = await bom.text();
  check(bom.status === 200 && !bomText.startsWith('\uFEFF'), '带 BOM 的文件读回来时 BOM 被剥掉');

  const foreign = await api(running, `/api/read?path=${encodeURIComponent(projectFile)}`, { token });
  check(foreign.status === 403, '不许读当前项目文件以外的文件', String(foreign.status));

  // 协作元数据：当前项目旁边的 .sync 是专门放开的（同步靠它记"上次同步到哪一版"）。
  // 但放开这一个兄弟文件之后，别的路径必须仍然一律拒绝——这是安全边界，不能跟着松。
  const syncFile = `${otherFile}.sync`;
  const syncWrite = await api(running, `/api/write?path=${encodeURIComponent(syncFile)}`, {
    token,
    body: '{"clock":7}',
  });
  check(syncWrite.status === 200, '当前项目旁边的 .sync 可以写', String(syncWrite.status));

  const syncRead = await api(running, `/api/read?path=${encodeURIComponent(syncFile)}`, { token });
  const syncText = syncRead.status === 200 ? await syncRead.text() : '';
  check(syncText === '{"clock":7}', '.sync 能原样读回来', syncText);

  const stranger = join(work, '别人的文件.json');
  const strangerWrite = await api(running, `/api/write?path=${encodeURIComponent(stranger)}`, {
    token,
    body: '{}',
  });
  check(strangerWrite.status === 403, '放开 .sync 之后，别的路径仍然被拒', String(strangerWrite.status));

  const strangerSync = await api(running, `/api/read?path=${encodeURIComponent(`${stranger}.sync`)}`, {
    token,
  });
  check(strangerSync.status === 403, '别的项目的 .sync 也不许碰', String(strangerSync.status));

  const missing = await api(running, `/api/read?path=${encodeURIComponent(otherFile)}`, { token });
  check(missing.status === 200, '切换过项目文件后读的是新文件');

  // 重启一次：路径必须还在，这就是"下次打开直接读路径"
  await stopServer(running);
  running = await startServer(port);
  const restarted = await getPage(running);
  const afterRestart = await api(running, '/api/last-path', { token: restarted.token });
  const afterData = (await afterRestart.json()) as { filePath: string | null };
  check(afterData.filePath === otherFile, '重启后仍记得上次打开的项目文件路径', String(afterData.filePath));

  const stillReadable = await api(running, `/api/read?path=${encodeURIComponent(otherFile)}`, {
    token: restarted.token,
  });
  check(stillReadable.status === 200, '重启后还能按这个路径读回项目');
} catch (error) {
  failed = true;
  console.error('✗ 校验过程出错：', error);
  if (running !== null) console.error(running.output());
} finally {
  await stopServer(running);
  rmSync(work, { recursive: true, force: true });
}

if (failed) {
  console.error('');
  console.error('本地服务校验没通过。');
  process.exit(1);
}

console.log('');
console.log('本地服务校验通过：路径读写、令牌、会话记忆都正常。');

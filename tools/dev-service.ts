/**
 * 开发服务器（pnpm dev）上的项目文件支持。
 *
 * 正式产物靠「启动StoryMaker.bat」起的本地服务读写项目文件；
 * 开发时没有那个服务，页面就会停在门槛页、什么都改不了。
 *
 * 这里不另写一套读写逻辑：直接把 /api 原样转给同一个 storymaker-server.ps1
 * （-ApiOnly：它只提供接口，页面还是由 vite 发）。于是 dev 和策划手里那份
 * 行为一致——同样的路径读写、同样的系统文件对话框、同样的报错。
 *
 * 代价：开发时要多一个 PowerShell 进程，会话文件也单独放（.dev-session.json）。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import type { Connect, Plugin, ViteDevServer } from 'vite';

/** 开发的令牌：dev server 和本地服务共用同一个，省掉来回换头 */
const DEV_TOKEN = randomBytes(16).toString('hex');

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

interface Service {
  base: string;
  child: ChildProcess;
}

async function startService(): Promise<Service> {
  const port = await freePort();
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(process.cwd(), 'tools/server/storymaker-server.ps1'),
      '-ApiOnly',
      '-NoBrowser',
      '-Port',
      String(port),
      '-Token',
      DEV_TOKEN,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // 开发用的"上次打开的项目"单独记，不碰正式那份
        STORYMAKER_SESSION_FILE: resolve(process.cwd(), '.dev-session.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const base = `http://127.0.0.1:${port}`;
  child.stdout?.on('data', (chunk) => process.stdout.write(`[storymaker] ${String(chunk)}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[storymaker] ${String(chunk)}`));

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/ping`, {
        method: 'POST',
        headers: { 'X-StoryMaker-Token': DEV_TOKEN },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return { base, child };
    } catch {
      // 还没起来，接着等
    }
    if (child.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 250));
  }

  child.kill();
  throw new Error('本地服务没起来，请确认这台机器能跑 powershell');
}

/** 把 /api/* 原样转给本地服务 */
function apiProxy(service: () => Promise<Service>): Connect.NextHandleFunction {
  return (req, res) => {
    void (async () => {
      try {
        const running = await service();
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);

        const headers: Record<string, string> = { 'X-StoryMaker-Token': DEV_TOKEN };
        if (req.headers['content-type'] !== undefined) {
          headers['Content-Type'] = req.headers['content-type'];
        }

        const response = await fetch(`${running.base}/api${req.url ?? '/'}`, {
          method: req.method,
          headers,
          body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        });

        const path = response.headers.get('X-StoryMaker-Path');
        res.statusCode = response.status;
        res.setHeader('Content-Type', response.headers.get('content-type') ?? 'application/json');
        if (path !== null) res.setHeader('X-StoryMaker-Path', path);
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: `本地服务不可用：${String(error)}` }));
      }
    })();
  };
}

export function devProjectService(): Plugin {
  let service: Promise<Service> | null = null;
  // 起失败就把缓存清掉，下一次请求再试一遍（不然整个 dev 会话都废了）
  const ensure = (): Promise<Service> => {
    service ??= startService().catch((error: unknown) => {
      service = null;
      throw error;
    });
    return service;
  };

  return {
    name: 'storymaker:dev-project-service',
    apply: 'serve',

    // 页面要知道自己在"本地服务版"下跑，才会去走 /api
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          injectTo: 'head',
          children: `window.__STORYMAKER_SERVER__={"token":"${DEV_TOKEN}"};`,
        },
      ];
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api', apiProxy(ensure));
      server.httpServer?.on('close', () => {
        void service?.then((running) => running.child.kill()).catch(() => undefined);
      });
    },
  };
}

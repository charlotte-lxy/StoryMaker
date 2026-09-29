/**
 * 协作连接层：把 WebSocket 包成「能连就连、断了自动重连、连不上就当没有」的样子。
 *
 * 为什么是"当没有"而不是报错：连不上服务端是完全正常的情况（对端没开机、没插网线、
 * 服务器进程没起），这时程序必须照常用——只是同步不了而已。所以这里把状态如实
 * 报给上层，由上层决定走协作还是纯本地，绝不因为连不上而挡住任何编辑。
 *
 * 服务端是外挂的 SocketServer.exe，只会把消息广播给所有连接，而且**会把你自己的消息
 * 也回显给你**。过滤自己的消息是上层的活（session.ts 按 clientId 判断）。
 */

import type { CollabMessage, CollabStatus } from './protocol';

/** 只取用得上的那几个成员，方便测试塞一个假的进来 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
}

const SOCKET_OPEN = 1;

export interface CollabClientOptions {
  url: string;
  clientId: string;
  /** 状态变化回调：detail 是给人看的说明（地址、失败原因） */
  onStatus: (status: CollabStatus, detail: string) => void;
  /** 收到一条消息（含自己发的回显，由上层过滤） */
  onMessage: (message: CollabMessage) => void;
  /** 测试注入假 WebSocket；不传就用浏览器的 */
  createSocket?: (url: string) => WebSocketLike;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface CollabClient {
  /** 开始连接；重复调用无副作用 */
  connect: () => void;
  /** 主动断开，之后不再自动重连 */
  disconnect: () => void;
  /** 发一条消息；返回是否真的发出去了（没连上就是 false） */
  send: (message: CollabMessage) => boolean;
  status: () => CollabStatus;
  /** 已连续失败几次，测试用 */
  failures: () => number;
}

function browserSocket(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

export function createCollabClient(options: CollabClientOptions): CollabClient {
  const createSocket = options.createSocket ?? browserSocket;
  const retryBaseMs = options.retryBaseMs ?? 500;
  const retryMaxMs = options.retryMaxMs ?? 30_000;

  let socket: WebSocketLike | null = null;
  let current: CollabStatus = 'offline';
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;

  function setStatus(next: CollabStatus, detail: string): void {
    current = next;
    options.onStatus(next, detail);
  }

  function clearRetry(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  /** 指数退避：0.5s、1s、2s…最多 30s，避免对端没开时把本机 CPU 打满 */
  function scheduleRetry(): void {
    if (stopped) return;
    clearRetry();
    const delay = Math.min(retryBaseMs * 2 ** failures, retryMaxMs);
    failures += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, delay);
  }

  function open(): void {
    if (stopped || socket !== null) return;
    setStatus('connecting', options.url);

    let ws: WebSocketLike;
    try {
      ws = createSocket(options.url);
    } catch {
      setStatus('offline', '这个地址连不上');
      scheduleRetry();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      failures = 0;
      setStatus('online', options.url);
    };

    ws.onmessage = (event) => {
      const text = typeof event.data === 'string' ? event.data : '';
      if (text === '') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return; // 不是 JSON 就当作别人的杂讯，丢掉
      }
      if (typeof parsed !== 'object' || parsed === null) return;
      const message = parsed as CollabMessage;
      if (typeof message.type !== 'string' || typeof message.clientId !== 'string') return;
      options.onMessage(message);
    };

    // 出错之后 close 一定会跟来，统一在 onclose 里处理，免得重连安排两遍
    ws.onerror = () => {};

    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (stopped) return;
      setStatus('offline', '连接已断开，正在重试');
      scheduleRetry();
    };
  }

  return {
    connect: () => {
      stopped = false;
      failures = 0;
      clearRetry();
      if (socket !== null) return;
      open();
    },

    disconnect: () => {
      stopped = true;
      clearRetry();
      const ws = socket;
      socket = null;
      if (ws !== null) {
        ws.onclose = null; // 主动断开不该触发重连
        ws.onmessage = null;
        try {
          ws.close();
        } catch {
          // 已经断了就算了
        }
      }
      setStatus('offline', '已断开协作');
    },

    send: (message) => {
      const ws = socket;
      if (ws === null || ws.readyState !== SOCKET_OPEN) return false;
      try {
        ws.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },

    status: () => current,
    failures: () => failures,
  };
}

import { describe, expect, it } from 'vitest';

import { createCollabClient, type WebSocketLike } from './client';
import type { CollabMessage, CollabStatus } from './protocol';

/** 假的 WebSocket：不碰网络，用 fireXxx 手动推进各种时机 */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  fireOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  fireMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  fireClose(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

const hello: CollabMessage = { type: 'hello', clientId: 'other', clock: 0 };

function setup() {
  const sockets: FakeSocket[] = [];
  const statuses: { status: CollabStatus; detail: string }[] = [];
  const received: CollabMessage[] = [];

  const client = createCollabClient({
    url: 'ws://192.168.1.20:1999',
    clientId: 'me',
    retryBaseMs: 1, // 测试里别真的等半秒
    retryMaxMs: 4,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onStatus: (status, detail) => statuses.push({ status, detail }),
    onMessage: (message) => received.push(message),
  });

  return { client, sockets, statuses, received, last: () => sockets[sockets.length - 1] };
}

describe('createCollabClient：连接', () => {
  it('connect 之后进入 connecting，连上后变 online', () => {
    const { client, last, statuses } = setup();
    client.connect();

    expect(client.status()).toBe('connecting');
    last().fireOpen();
    expect(client.status()).toBe('online');
    expect(statuses.map((entry) => entry.status)).toEqual(['connecting', 'online']);
  });

  it('重复 connect 不会开第二条连接', () => {
    const { client, sockets } = setup();
    client.connect();
    client.connect();
    expect(sockets).toHaveLength(1);
  });
});

describe('createCollabClient：收发', () => {
  it('连上之后能发消息', () => {
    const { client, last } = setup();
    client.connect();
    last().fireOpen();

    expect(client.send(hello)).toBe(true);
    expect(JSON.parse(last().sent[0])).toEqual(hello);
  });

  it('没连上时 send 返回 false，不抛错', () => {
    const { client } = setup();
    client.connect();
    expect(client.send(hello)).toBe(false);
  });

  it('收到合法 JSON 就交给上层', () => {
    const { client, last, received } = setup();
    client.connect();
    last().fireOpen();
    last().fireMessage(JSON.stringify(hello));

    expect(received).toEqual([hello]);
  });

  it('收到不是 JSON 的东西当作杂讯丢掉', () => {
    const { client, last, received } = setup();
    client.connect();
    last().fireOpen();
    last().fireMessage('这不是 JSON');
    last().fireMessage(JSON.stringify({ 没有type: true }));

    expect(received).toHaveLength(0);
  });
});

describe('createCollabClient：断开与重连', () => {
  it('意外断开后状态回到 offline 并自动重连', async () => {
    const { client, last, sockets } = setup();
    client.connect();
    last().fireOpen();
    last().fireClose();

    expect(client.status()).toBe('offline');
    await sleep(30);
    expect(sockets.length).toBeGreaterThan(1); // 又开了一条
  });

  it('主动 disconnect 之后不再重连', async () => {
    const { client, last, sockets } = setup();
    client.connect();
    last().fireOpen();
    const countBefore = sockets.length;

    client.disconnect();
    await sleep(30);

    expect(client.status()).toBe('offline');
    expect(sockets).toHaveLength(countBefore);
  });

  it('断开后重连成功会回到 online', async () => {
    const { client, last } = setup();
    client.connect();
    last().fireOpen();
    last().fireClose();

    await sleep(30);
    last().fireOpen();
    expect(client.status()).toBe('online');
  });

  it('构造 socket 就抛错时也不崩，只是记一次失败', () => {
    const statuses: CollabStatus[] = [];
    const client = createCollabClient({
      url: 'ws://坏的地址',
      clientId: 'me',
      retryBaseMs: 1,
      createSocket: () => {
        throw new Error('地址不对');
      },
      onStatus: (status) => statuses.push(status),
      onMessage: () => {},
    });

    client.connect();
    expect(client.status()).toBe('offline');
    expect(statuses).toContain('offline');
  });
});

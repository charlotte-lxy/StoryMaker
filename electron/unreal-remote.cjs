'use strict';

/**
 * Unreal 编辑器的 Python Remote Execution 客户端。
 *
 * 引擎自带的 remote_execution.py 用「UDP 组播发现 + TCP 回连」跟编辑器通信：
 *
 *   1. 客户端在 239.0.0.1:6766 上广播 ping，编辑器回 pong（带项目名、引擎版本）
 *   2. 客户端在某个 TCP 端口上监听，发 open_connection 告诉编辑器连回来
 *   3. 编辑器连上后，客户端发 command，编辑器跑完 Python 回 command_result
 *
 * 命令通道支持长连接：打开一次可以连着跑很多段脚本。逐文件导入素材时这一点很关键，
 * 否则每个文件都要重新握手。
 */

const dgram = require('node:dgram');
const net = require('node:net');
const crypto = require('node:crypto');

const PROTOCOL_VERSION = 1;
const PROTOCOL_MAGIC = 'ue_py';
const MULTICAST_GROUP = '239.0.0.1';
const DISCOVERY_PORT = 6766;

/** 引擎要求的执行模式，与 EPythonCommandExecutionMode 对应 */
const EXEC_MODE_FILE = 'ExecuteFile';

/** 本机一个随机节点 ID；只要在一轮通心里保持唯一即可 */
function newNodeId() {
  return crypto.randomUUID().replace(/-/g, '').toUpperCase();
}

/**
 * 把一条报文编码成 UTF-8 JSON 字节。
 *
 * 引擎的接收端不做长度前缀，靠一次 recv 拿到整段 JSON 再解析，
 * 所以这里必须一条消息一次 send，不能拼接。
 */
function encodeMessage(type, source, dest, data) {
  const payload = { version: PROTOCOL_VERSION, magic: PROTOCOL_MAGIC, type, source };
  if (dest !== undefined && dest !== null) payload.dest = dest;
  if (data !== undefined && data !== null) payload.data = data;
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

/** 解析一条报文；字段不对就返回 null（当成噪声丢掉，不让它打断整轮通信） */
function decodeMessage(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  if (parsed.version !== PROTOCOL_VERSION || parsed.magic !== PROTOCOL_MAGIC) return null;
  if (typeof parsed.type !== 'string' || typeof parsed.source !== 'string') return null;
  return parsed;
}

/** pong 里带的节点信息，缺字段的一律留空，界面按「未知」显示 */
function readNodeInfo(message) {
  const data = message.data !== null && typeof message.data === 'object' ? message.data : {};
  return {
    id: message.source,
    user: typeof data.user === 'string' ? data.user : '',
    machine: typeof data.machine === 'string' ? data.machine : '',
    engineVersion: typeof data.engine_version === 'string' ? data.engine_version : '',
    engineRoot: typeof data.engine_root === 'string' ? data.engine_root : '',
    projectRoot: typeof data.project_root === 'string' ? data.project_root : '',
    projectName: typeof data.project_name === 'string' ? data.project_name : '',
  };
}

/** 从 command_result 里取出人看的输出行 */
function readCommandOutput(message) {
  const data = message.data !== null && typeof message.data === 'object' ? message.data : {};
  const lines = [];
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item === null || typeof item !== 'object') continue;
      if (typeof item.output === 'string') lines.push(item.output);
    }
  }
  return {
    success: data.success === true,
    output: lines,
    result: typeof data.result === 'string' ? data.result : '',
  };
}

class UnrealRemoteError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'UnrealRemoteError';
    this.code = code ?? 'unreal-remote';
  }
}

/**
 * 一条已经打开的命令通道：可以连着跑多段脚本，不用每条都重新握手。
 *
 * 逐文件导入素材时这一步很关键——每个文件都重连一次的话，
 * 几百个素材光握手就能耗掉好几分钟，进度条也没法细到单个文件。
 */
class UnrealCommandChannel {
  constructor(socket, server, nodeId, remoteNodeId) {
    this.socket = socket;
    this.server = server;
    this.nodeId = nodeId;
    this.remoteNodeId = remoteNodeId;
    this._buffer = '';
    this._pending = null;
    this._closed = false;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', (error) => {
      this._fail(new UnrealRemoteError(`命令通道出错：${error.message}`, 'socket-error'));
    });
    socket.on('close', () => {
      this._fail(new UnrealRemoteError('编辑器断开了命令通道', 'socket-closed'));
    });
  }

  _onData(chunk) {
    this._buffer += chunk.toString('utf8');
    // 引擎一条消息一次发完，但 TCP 会分片；能解析了才算收全
    const message = decodeMessage(this._buffer);
    if (message === null) return;
    this._buffer = '';
    if (this._pending === null || message.type !== 'command_result') return;
    const { resolve, timer } = this._pending;
    this._pending = null;
    clearTimeout(timer);
    resolve(readCommandOutput(message));
  }

  _fail(error) {
    if (this._pending === null) return;
    const { reject, timer } = this._pending;
    this._pending = null;
    clearTimeout(timer);
    reject(error);
  }

  /**
   * 在这条通道上跑一段 Python，等结果回来。
   * @param {string} script
   * @param {{ timeoutMs?: number, execMode?: string }} [options]
   */
  run(script, options = {}) {
    if (this._closed) {
      return Promise.reject(new UnrealRemoteError('命令通道已经关闭', 'channel-closed'));
    }
    if (this._pending !== null) {
      return Promise.reject(new UnrealRemoteError('上一条命令还没跑完', 'channel-busy'));
    }
    const timeoutMs = options.timeoutMs ?? 600_000;
    const execMode = options.execMode ?? EXEC_MODE_FILE;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending === null) return;
        this._pending = null;
        reject(new UnrealRemoteError(`执行超时（${Math.round(timeoutMs / 1000)} 秒）`, 'timeout'));
      }, timeoutMs);
      this._pending = { resolve, reject, timer };
      this.socket.write(
        encodeMessage('command', this.nodeId, this.remoteNodeId, {
          command: script,
          unattended: true,
          exec_mode: execMode,
        }),
      );
    });
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try {
      this.socket.destroy();
    } catch {
      // 已经断了
    }
    try {
      this.server.close();
    } catch {
      // 同上
    }
  }
}

class UnrealRemoteSession {
  /**
   * @param {object} [options]
   * @param {string} [options.host] 只连本机，默认 127.0.0.1
   * @param {number} [options.discoveryPort] UDP 发现端口，默认 6766
   */
  constructor(options = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.discoveryPort = options.discoveryPort ?? DISCOVERY_PORT;
    this.nodeId = options.nodeId ?? newNodeId();
    this.udp = null;
    /** @type {Map<string, object>} */
    this.nodes = new Map();
    this._closed = false;
  }

  /** 建 UDP 套接字并加入组播组；同一个进程里只该有一个 session 开着 */
  async start() {
    if (this.udp !== null) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (buffer) => {
      const message = decodeMessage(buffer.toString('utf8'));
      if (message === null) return;
      if (message.type === 'pong' && message.source !== this.nodeId) {
        this.nodes.set(message.source, readNodeInfo(message));
      }
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        socket.close();
        reject(
          new UnrealRemoteError(
            error && error.code === 'EADDRINUSE'
              ? `UDP ${this.discoveryPort} 被占用了，可能是另一个 StoryMaker 窗口占着它`
              : `无法打开发现端口：${error instanceof Error ? error.message : String(error)}`,
            'udp-unavailable',
          ),
        );
      };
      socket.once('error', onError);
      socket.bind(this.discoveryPort, this.host, () => {
        socket.off('error', onError);
        try {
          socket.addMembership(MULTICAST_GROUP, this.host);
          socket.setMulticastInterface(this.host);
          socket.setMulticastTTL(0);
          socket.setMulticastLoopback(true);
        } catch (error) {
          socket.close();
          reject(
            new UnrealRemoteError(
              `加入组播组失败：${error instanceof Error ? error.message : String(error)}`,
              'multicast-unavailable',
            ),
          );
          return;
        }
        this.udp = socket;
        resolve();
      });
    });
  }

  /**
   * 广播 ping 找在线的编辑器，直到等到至少一个节点或超时。
   * @returns {Promise<Array<object>>}
   */
  async discover(timeoutMs = 3000) {
    await this.start();
    this.nodes.clear();

    const deadline = Date.now() + setTimeoutMs(timeoutMs);
    while (Date.now() < deadline) {
      this._send(encodeMessage('ping', this.nodeId, null, null));
      await sleep(400);
      if (this.nodes.size > 0) return this.listNodes();
    }
    return this.listNodes();
  }

  listNodes() {
    return [...this.nodes.values()];
  }

  /**
   * 打开一条命令通道，调用方负责 close()。
   *
   * 通道建立后可以连着跑很多段脚本，省掉每次握手的开销——逐文件导素材就靠它。
   */
  async openCommand(nodeId) {
    await this.start();
    if (!this.nodes.has(nodeId)) {
      throw new UnrealRemoteError('目标 Unreal 节点已经掉线', 'node-missing');
    }

    const server = net.createServer();
    const connection = new Promise((resolve, reject) => {
      server.once('connection', resolve);
      server.once('error', reject);
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, this.host, resolve);
    });
    const commandPort = server.address().port;

    try {
      const open = encodeMessage('open_connection', this.nodeId, nodeId, {
        command_ip: this.host,
        command_port: commandPort,
      });
      // 引擎只重试 6 次、每次 5 秒，这边也按同样的节奏发
      const socket = await this._awaitConnection(server, connection, open);
      return new UnrealCommandChannel(socket, server, this.nodeId, nodeId);
    } catch (error) {
      await new Promise((resolve) => server.close(() => resolve()));
      throw error;
    }
  }

  /**
   * 在指定节点上跑一段 Python，等它跑完把输出拿回来。
   *
   * 编辑器是在自己主线程上同步执行这段脚本的，导入大量资源时编辑器中会卡住，
   * 所以超时要给足（默认 10 分钟）。
   */
  async runScript(nodeId, script, options = {}) {
    const channel = await this.openCommand(nodeId);
    try {
      return await channel.run(script, options);
    } finally {
      channel.close();
    }
  }

  async _awaitConnection(server, connection, openMessage) {
    const attempts = 6;
    const perAttempt = 5000;
    for (let index = 0; index < attempts; index += 1) {
      this._send(openMessage);
      const race = await Promise.race([connection, sleep(perAttempt).then(() => null)]);
      if (race !== null) return race;
    }
    throw new UnrealRemoteError(
      'Unreal 没有连回来：编辑器可能没开这个项目，或远程执行被关掉了',
      'connect-failed',
    );
  }

  _send(message) {
    if (this.udp === null) return;
    this.udp.send(message, this.discoveryPort, MULTICAST_GROUP);
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    if (this.udp !== null) {
      try {
        this.udp.dropMembership(MULTICAST_GROUP, this.host);
      } catch {
        // 已经关了就算了
      }
      try {
        this.udp.close();
      } catch {
        // 同上
      }
      this.udp = null;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 把可能传进来的字符串/数字统一成合法的毫秒数 */
function setTimeoutMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 3000;
  return number;
}

module.exports = {
  DISCOVERY_PORT,
  EXEC_MODE_FILE,
  MULTICAST_GROUP,
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  UnrealCommandChannel,
  UnrealRemoteError,
  UnrealRemoteSession,
  decodeMessage,
  encodeMessage,
  newNodeId,
  readCommandOutput,
  readNodeInfo,
};

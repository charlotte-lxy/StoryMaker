/**
 * 和 Godot 编辑器的连接状态。
 *
 * 连接靠装在工程里的 EditorPlugin：插件在 127.0.0.1:27185 上监听，
 * 令牌写在工程的 `.godot/storymaker_bridge.json` 里，所以先得在设置页选 project.godot。
 * 插件没装 / 没启用时 ping 会直接给出原因，设置页据此提示「安装插件」。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GodotEditorInfo, GodotPluginState, HostApi } from '../core/host';
import { DEFAULT_CONNECT_INTERVAL_SEC } from '../state/prefs';
import type { ConnectionStatus } from './use-unreal-connection';

/** 自动探测的超时：本机 ping-pong 一般几十毫秒 */
const PROBE_TIMEOUT_MS = 1200;

/** 手动检测的超时：编辑器刚启动、插件还在 enter_tree 时多给一点 */
const CONNECT_TIMEOUT_MS = 2500;

export interface GodotNotice {
  ok: boolean;
  text: string;
}

export interface GodotConnection {
  /** 桌面版才有连接能力 */
  available: boolean;
  status: ConnectionStatus;
  editor: GodotEditorInfo | null;
  /** 连不上时给策划看的原因 */
  message: string;
  /** 插件状态：没选工程或没查过时是 null */
  plugin: GodotPluginState | null;
  installing: boolean;
  /** 上一次「安装插件 / 检测连接」的结果文案，设置页内联显示 */
  notice: GodotNotice | null;
  /** 手动检测（会显示「检测中」） */
  connect: () => Promise<void>;
  /** 选好工程后一键装插件 + 在 project.godot 里启用 */
  installPlugin: () => Promise<void>;
}

export function useGodotConnection(
  host: HostApi | undefined,
  projectPath: string,
  options: { autoConnect?: boolean; intervalSec?: number } = {},
): GodotConnection {
  const godot = host?.godot;
  const autoConnect = options.autoConnect === true;
  const intervalSec = Math.max(1, options.intervalSec ?? DEFAULT_CONNECT_INTERVAL_SEC);

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [editor, setEditor] = useState<GodotEditorInfo | null>(null);
  const [message, setMessage] = useState('');
  const [plugin, setPlugin] = useState<GodotPluginState | null>(null);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState<GodotNotice | null>(null);

  /** 同时只跑一个探测；手动点「检测连接」时等它跑完再上 */
  const inFlight = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const readPluginState = useCallback(async (): Promise<void> => {
    if (godot === undefined || projectPath.trim() === '') {
      setPlugin(null);
      return;
    }
    try {
      const state = await godot.pluginState(projectPath);
      if (alive.current) setPlugin(state);
    } catch {
      if (alive.current) setPlugin(null);
    }
  }, [godot, projectPath]);

  // 换了工程文件就当成没连过，插件状态也重查
  useEffect(() => {
    setStatus('idle');
    setEditor(null);
    setMessage('');
    setNotice(null);
    void readPluginState();
  }, [projectPath, readPluginState]);

  const check = useCallback(
    async (timeoutMs: number, force: boolean): Promise<void> => {
      if (godot === undefined) return;
      if (projectPath.trim() === '') return;
      if (inFlight.current) {
        if (!force) return;
        while (inFlight.current) await new Promise((resolve) => setTimeout(resolve, 80));
      }
      inFlight.current = true;
      if (force) setStatus('checking');
      try {
        const result = await godot.ping(projectPath, timeoutMs);
        if (!alive.current) return;
        if (!result.ok || result.editor === undefined) {
          setStatus('offline');
          setEditor(null);
          setMessage(result.message ?? '连不上 Godot 编辑器');
          if (force) setNotice({ ok: false, text: result.message ?? '连不上 Godot 编辑器' });
          return;
        }
        setEditor(result.editor);
        setStatus('online');
        setMessage('');
        if (force) {
          setNotice({ ok: true, text: `已连上 ${result.editor.projectName || 'Godot 工程'}` });
        }
      } catch (error) {
        if (!alive.current) return;
        const text = error instanceof Error ? error.message : String(error);
        setStatus('offline');
        setEditor(null);
        setMessage(text);
        if (force) setNotice({ ok: false, text });
      } finally {
        inFlight.current = false;
      }
    },
    [godot, projectPath],
  );

  const connect = useCallback(async (): Promise<void> => {
    setNotice(null);
    await check(CONNECT_TIMEOUT_MS, true);
  }, [check]);

  const installPlugin = useCallback(async (): Promise<void> => {
    if (godot === undefined || projectPath.trim() === '') return;
    setInstalling(true);
    setNotice(null);
    try {
      const result = await godot.installPlugin(projectPath);
      await readPluginState();
      if (alive.current) setNotice({ ok: result.ok, text: result.message ?? '插件已安装' });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (alive.current) setNotice({ ok: false, text });
    } finally {
      if (alive.current) setInstalling(false);
    }
  }, [godot, projectPath, readPluginState]);

  // 自动探测：串行跑，不会把上一次堆起来
  useEffect(() => {
    if (godot === undefined) return;
    if (!autoConnect || projectPath.trim() === '') return;
    void check(PROBE_TIMEOUT_MS, false);
    const timer = window.setInterval(() => {
      void check(PROBE_TIMEOUT_MS, false);
    }, intervalSec * 1000);
    return () => window.clearInterval(timer);
  }, [godot, autoConnect, intervalSec, projectPath, check]);

  return {
    available: godot !== undefined,
    status,
    editor,
    message,
    plugin,
    installing,
    notice,
    connect,
    installPlugin,
  };
}

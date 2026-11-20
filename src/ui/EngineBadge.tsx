import type { EngineKind } from '../state/prefs';

import { UnrealBadge } from './UnrealBadge';
import type { GodotConnection } from './use-godot-connection';
import type { UnrealConnection } from './use-unreal-connection';

interface Props {
  /** 当前选中的引擎；决定标签上显示 UE 还是 Godot */
  engine: EngineKind;
  connection: UnrealConnection;
  godotConnection: GodotConnection;
  /** 已连接时点一下：直接开「导出到 UE」弹窗 */
  onExportToUe: () => void;
  /** 没连接时点一下：跳到设置页去连 */
  onOpenSettings: () => void;
}

/**
 * 顶部工具条右侧的编辑器连接标签。
 *
 * Unreal 那一套原样交给 UnrealBadge（点一下还能导出）；选 Godot 时只显示
 * Godot 的连接状态，点一下跳到设置页——Godot 的素材导入还没做，先不给导出入口。
 */
export function EngineBadge({
  engine,
  connection,
  godotConnection,
  onExportToUe,
  onOpenSettings,
}: Props) {
  if (engine === 'unreal') {
    return (
      <UnrealBadge
        connection={connection}
        onExportToUe={onExportToUe}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  const stateClass =
    godotConnection.status === 'online'
      ? 'on'
      : godotConnection.status === 'checking'
        ? 'wait'
        : 'off';

  return (
    <button
      type="button"
      className={`collab-badge ue-badge ${stateClass}`}
      title={`Godot：${describe(godotConnection)}\n点一下去设置里连接`}
      onClick={onOpenSettings}
    >
      <span className="collab-dot" />
      Godot
    </button>
  );
}

function describe(connection: GodotConnection): string {
  if (!connection.available) return '只有桌面版能连编辑器';
  if (connection.status === 'online') {
    const name = connection.editor?.projectName || '（未命名工程）';
    const engine = connection.editor?.engineVersion || '未知版本';
    return `已连接 ${name}（Godot ${engine}）`;
  }
  if (connection.status === 'checking') return '正在检测…';
  if (connection.status === 'offline') {
    return connection.message === '' ? '未连接' : `未连接——${connection.message}`;
  }
  return '未连接——在「设置 → 引擎连接」里检测';
}

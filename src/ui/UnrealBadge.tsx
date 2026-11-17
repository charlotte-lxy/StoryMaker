import type { UnrealConnection } from './use-unreal-connection';

interface Props {
  connection: UnrealConnection;
  /** 已连接时点一下：直接开「导出到 UE」弹窗 */
  onExportToUe: () => void;
  /** 没连接时点一下：跳到设置页去连 */
  onOpenSettings: () => void;
}

/**
 * 顶部工具条的 UE 状态标签。
 *
 * 和「协作」那个标签一个样式：绿点=连上、灰点=没连、黄点=正在检测。
 * 点它的意思分两种：连上了就想导出（直接开弹窗），没连上就得先去设置里连。
 */
export function UnrealBadge({ connection, onExportToUe, onOpenSettings }: Props) {
  const stateClass =
    connection.status === 'online' ? 'on' : connection.status === 'checking' ? 'wait' : 'off';

  const detail = describe(connection);
  const hint =
    connection.status === 'online' ? '点一下导出到 UE' : '点一下去设置里连接';

  return (
    <button
      type="button"
      className={`collab-badge ue-badge ${stateClass}`}
      title={`Unreal：${detail}\n${hint}`}
      onClick={() => {
        if (connection.status === 'online') onExportToUe();
        else onOpenSettings();
      }}
    >
      <span className="collab-dot" />
      UE
    </button>
  );
}

function describe(connection: UnrealConnection): string {
  if (!connection.available) return '只有桌面版能连编辑器';
  if (connection.status === 'online') {
    const name = connection.node?.projectName || '（未命名工程）';
    const engine = connection.node?.engineVersion || '未知版本';
    return `已连接 ${name}（引擎 ${engine}）`;
  }
  if (connection.status === 'checking') return '正在检测…';
  if (connection.status === 'offline') {
    return connection.message === '' ? '未连接' : `未连接——${connection.message}`;
  }
  return '未连接——在「设置 → Unreal 连接」里检测';
}

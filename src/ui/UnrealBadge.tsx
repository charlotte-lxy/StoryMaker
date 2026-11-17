import type { UnrealConnection } from './use-unreal-connection';

interface Props {
  connection: UnrealConnection;
  /** 点一下跳到设置页去连 / 改参数 */
  onOpenSettings: () => void;
}

/**
 * 顶部工具条的 UE 状态标签。
 *
 * 和「协作」那个标签一个样式：绿点=连上、灰点=没连、黄点=正在检测。
 * 点一下跳到设置页——连不上的原因和改法都在那儿。
 */
export function UnrealBadge({ connection, onOpenSettings }: Props) {
  const stateClass =
    connection.status === 'online' ? 'on' : connection.status === 'checking' ? 'wait' : 'off';

  const detail = describe(connection);

  return (
    <button
      type="button"
      className={`collab-badge ue-badge ${stateClass}`}
      title={`Unreal：${detail}`}
      onClick={onOpenSettings}
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

import type { LookupRow, Project } from '../core/types';
import type { LookupKind } from '../state/operations';
import { useScrollMemory } from './view-memory';

const TITLES: Record<LookupKind, { title: string; hint: string; placeholder: string }> = {
  items: {
    title: '物品表',
    hint: '物品 ID 供指令「背包# 物品ID±数量」与条件「背包# 物品ID >= 数量」的下拉使用。',
    placeholder: '例如：金币',
  },
  quests: {
    title: '任务表',
    hint: '任务 ID 供指令「任务.接取# 任务ID」与条件「任务# 任务ID=1」的下拉使用。',
    placeholder: '例如：凑齐医药费',
  },
  images: {
    title: '立绘 / 图片表',
    hint: '图片 ID 供指令「剧情.图片# 图片ID」的下拉使用。',
    placeholder: '例如：夜晚的城市',
  },
  sounds: {
    title: '音效表',
    hint: '音效 ID 供指令「剧情.音效# 音效ID」的下拉使用。',
    placeholder: '例如：按键提示音',
  },
};

interface Props {
  project: Project;
  kind: LookupKind;
  onAdd: (kind: LookupKind) => void;
  onRemove: (kind: LookupKind, uid: string) => void;
  onUpdate: (kind: LookupKind, uid: string, patch: Partial<LookupRow>) => void;
  /** 全局搜索跳过来的那一行：交给上层滚过去，这里只负责高亮它 */
  focusUid?: string | null;
}

export function LookupEditor({ project, kind, onAdd, onRemove, onUpdate, focusUid = null }: Props) {
  const editorRef = useScrollMemory(`lookup:${kind}`);
  const rows = project[kind];
  const meta = TITLES[kind];

  const idCounts = new Map<string, number>();
  for (const row of rows) idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);

  return (
    <div className="editor" ref={editorRef}>
      <div className="editor-head">
        <h2>{meta.title}</h2>
        <span className="hint">{meta.hint}</span>
        <button type="button" className="primary" onClick={() => onAdd(kind)}>
          ＋ 新增一行
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          还没有数据。先在这里建好，写剧情时指令和条件的下拉框才有内容可选。
        </div>
      ) : (
        <table className="lines">
          <thead>
            <tr>
              <th style={{ width: '36%' }}>ID</th>
              <th>说明</th>
              <th style={{ width: 86 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.uid}
                className={`line-row${focusUid === row.uid ? ' flash' : ''}`}
                data-search-uid={row.uid}
              >
                <td>
                  <input
                    value={row.id}
                    onChange={(event) => onUpdate(kind, row.uid, { id: event.target.value })}
                  />
                  {(idCounts.get(row.id) ?? 0) > 1 && <div className="field-error">ID 重复</div>}
                </td>
                <td>
                  <input
                    value={row.name}
                    placeholder={meta.placeholder}
                    onChange={(event) => onUpdate(kind, row.uid, { name: event.target.value })}
                  />
                </td>
                <td>
                  <button type="button" onClick={() => onRemove(kind, row.uid)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

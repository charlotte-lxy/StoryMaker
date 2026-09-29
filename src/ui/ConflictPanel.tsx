import { useMemo, useState } from 'react';

import type { Conflict } from '../core/collab/protocol';
import type { ConflictChoice } from '../core/collab/resolve';
import type { Project } from '../core/types';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  project: Project;
  conflicts: Conflict[];
  onApply: (choices: ConflictChoice[]) => void;
  onCancel: () => void;
}

/** 集合字段名 → 人话 */
const COLLECTION_NAMES: Record<string, string> = {
  characters: '角色',
  items: '物品',
  quests: '任务',
  images: '立绘',
  sounds: '音效',
  commands: '指令字典',
  chapters: '章节',
  groups: '段落',
  lines: '对话行',
  options: '选项',
  uiTexts: '界面文案',
  exportSettings: '导入设置',
  attributes: '属性',
  effects: '效果',
  skills: '技能',
  events: '事件',
  weapons: '武器',
  modifiers: '修改器',
  parameters: '参数',
};

/** 字段名 → 人话；没列的字段就显示原名，不硬猜 */
const FIELD_NAMES: Record<string, string> = {
  name: '名称',
  id: 'ID',
  title: '标题',
  note: '备注',
  text: '文本',
  'text.zh': '文本（中文）',
  'text.en': '文本（英文）',
  'text.ja': '文本（日文）',
  command: '指令',
  characterId: '角色ID',
  displayName: '显示名称',
  autoAdvance: '强制自动播放',
  nextId: '跳转目标',
  results: '结果',
  appearConditions: '出现条件',
  enableConditions: '可用条件',
  optionIds: '选项列表',
  fixedValues: '候选值',
};

/** 在项目里按 uid 找条目，顺手记下它在哪个集合字段下 */
function findItem(
  node: unknown,
  uid: string,
): { item: Record<string, unknown>; collection: string } | null {
  if (node === null || typeof node !== 'object') return null;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (entry === null || typeof entry !== 'object') continue;
      if ((entry as Record<string, unknown>).uid === uid) {
        return { item: entry as Record<string, unknown>, collection: key };
      }
    }
    for (const entry of value) {
      const found = findItem(entry, uid);
      if (found !== null) return found;
    }
  }
  return null;
}

/** 条目拿什么当"名字"给人看 */
function labelOf(item: Record<string, unknown>): string {
  for (const key of ['title', 'name', 'readableId', 'id', 'key']) {
    const value = item[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return typeof item.uid === 'string' ? item.uid : '这一条';
}

function lastUid(target: string): string {
  const parts = target.split('/');
  return parts[parts.length - 1] ?? '';
}

/** 一条冲突说的是哪儿 */
function describeConflict(project: Project, conflict: Conflict): string {
  const patch = conflict.patch;

  if (patch.kind === 'add') {
    return `${COLLECTION_NAMES[patch.collection] ?? patch.collection}：新增一条`;
  }
  if (patch.kind === 'reorder') {
    return `${COLLECTION_NAMES[patch.collection] ?? patch.collection}：顺序`;
  }

  const found = findItem(project, lastUid(patch.target));
  const where = found === null ? patch.target : labelOf(found.item);

  if (patch.kind === 'remove') return `${where}：整条`;
  return `${where} · ${FIELD_NAMES[patch.field] ?? patch.field}`;
}

/** 对方那一列显示什么 */
function remoteValue(conflict: Conflict): unknown {
  const patch = conflict.patch;
  if (patch.kind === 'field') return patch.value;
  if (patch.kind === 'add') return patch.item;
  if (patch.kind === 'remove') return '（对方删掉了这一条）';
  return patch.order;
}

/** 己方那一列显示什么 */
function localValue(conflict: Conflict): unknown {
  const patch = conflict.patch;
  if (patch.kind === 'add') return '（本机没有这一条）';
  if (patch.kind === 'remove') return '（本机保留着这一条）';
  return conflict.localValue;
}

function renderValue(value: unknown): string {
  if (value === undefined) return '（没有）';
  if (value === null) return '（空）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value === '' ? '（空）' : value;
  if (Array.isArray(value)) {
    return value.length === 0 ? '（空列表）' : value.map((item) => String(item)).join('\n');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.uid === 'string') return labelOf(record);
    return JSON.stringify(value);
  }
  return String(value);
}

interface PendingAction {
  label: string;
  run: () => void;
}

/**
 * 冲突面板。
 *
 * 冲突没解决完就不放行编辑——这是刻意的：此时文档处于"合并了一半"的状态，
 * 让人继续改只会让后面更难收拾。出口只有两个：裁决完，或者取消合并回滚。
 */
export function ConflictPanel({ project, conflicts, onApply, onCancel }: Props) {
  const [choices, setChoices] = useState<(ConflictChoice | null)[]>(() =>
    conflicts.map(() => null),
  );
  const [pending, setPending] = useState<PendingAction | null>(null);

  const rows = useMemo(
    () => conflicts.map((conflict) => ({ conflict, where: describeConflict(project, conflict) })),
    [conflicts, project],
  );

  const chosenCount = choices.filter((choice) => choice !== null).length;
  const allChosen = chosenCount === conflicts.length;

  const pick = (index: number, choice: ConflictChoice): void => {
    setChoices((current) => current.map((value, i) => (i === index ? choice : value)));
  };

  const fillAll = (choice: ConflictChoice): void => {
    setChoices(conflicts.map(() => choice));
  };

  return (
    <div className="modal-mask">
      <div className="modal conflict-modal" role="dialog" aria-modal="true">
        <header>
          合并时需要你决定：{chosenCount} / {conflicts.length} 已选
        </header>

        <div className="modal-body">
          <p className="collab-note">
            这些地方你和对方都改过。点一下某一列就表示采用它——选中的那格会高亮。
          </p>
          <div className="conflict-scroll">
            <table className="conflict-table">
              <thead>
                <tr>
                  <th>位置</th>
                  <th>对方数据</th>
                  <th>己方数据</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ conflict, where }, index) => (
                  <tr key={`${where}-${index}`}>
                    <td className="conflict-where" title={where}>
                      {where}
                    </td>
                    <td
                      className={`conflict-value ${choices[index] === 'theirs' ? 'picked' : ''}`}
                      title="点这里采用对方的数据"
                      onClick={() => pick(index, 'theirs')}
                    >
                      {renderValue(remoteValue(conflict))}
                    </td>
                    <td
                      className={`conflict-value ${choices[index] === 'mine' ? 'picked' : ''}`}
                      title="点这里采用己方的数据"
                      onClick={() => pick(index, 'mine')}
                    >
                      {renderValue(localValue(conflict))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="conflict-actions">
          <button
            type="button"
            onClick={() =>
              setPending({
                label: '全部采用己方数据',
                run: () => fillAll('mine'),
              })
            }
          >
            全部使用我方数据
          </button>
          <button
            type="button"
            onClick={() =>
              setPending({
                label: '全部采用对方数据',
                run: () => fillAll('theirs'),
              })
            }
          >
            全部使用对方数据
          </button>
          <button
            type="button"
            className="danger"
            onClick={() =>
              setPending({
                label: '取消合并（本次合并的改动会全部撤销，并切回离线）',
                run: onCancel,
              })
            }
          >
            取消合并并切换回离线模式
          </button>
          <button
            type="button"
            className="primary"
            disabled={!allChosen}
            title={allChosen ? '把选定的结果合并进去' : '还有没选的地方'}
            onClick={() =>
              setPending({
                label: '确认合并',
                run: () => onApply(choices as ConflictChoice[]),
              })
            }
          >
            确认合并
          </button>
        </footer>
      </div>

      {pending !== null && (
        <ConfirmDialog
          title="请确认"
          message={`${pending.label}？`}
          confirmLabel="确定"
          onConfirm={() => {
            pending.run();
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

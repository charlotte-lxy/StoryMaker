import { useMemo, useState } from 'react';

import type { Conflict } from '../core/collab/protocol';
import type { ConflictChoice } from '../core/collab/resolve';
import type { Project } from '../core/types';
import { ConfirmDialog } from './ConfirmDialog';
import { describePatchLocation, renderValue } from './collab-labels';

interface Props {
  project: Project;
  conflicts: Conflict[];
  onApply: (choices: ConflictChoice[]) => void;
  onCancel: () => void;
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

interface PendingAction {
  label: string;
  run: () => void;
}

/**
 * 冲突面板。
 *
 * 冲突没解决完就不放行编辑——这是刻意的：此时文档处在「合并了一半」的状态，
 * 让人继续改只会让后面更难收拾。出口只有两个：裁决完，或者取消合并回滚。
 */
export function ConflictPanel({ project, conflicts, onApply, onCancel }: Props) {
  const [choices, setChoices] = useState<(ConflictChoice | null)[]>(() =>
    conflicts.map(() => null),
  );
  const [pending, setPending] = useState<PendingAction | null>(null);

  const rows = useMemo(
    () =>
      conflicts.map((conflict) => ({
        conflict,
        where: describePatchLocation(project, conflict.patch),
      })),
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

import { useState } from 'react';

import type {
  Character,
  CharacterAlias,
  ExpressionRow,
  PlayPositionRow,
  Project,
} from '../core/types';
import { OrderCell, useRowDrag } from './battle/row-drag';
import { useScrollMemory } from './view-memory';

interface Props {
  project: Project;
  onAdd: () => void;
  onRemove: (characterUid: string) => void;
  onUpdate: (characterUid: string, patch: Partial<Character>) => void;
  /** 别名：加一个空行、删一个、改文字 */
  onAddAlias: (characterUid: string) => void;
  onRemoveAlias: (characterUid: string, aliasUid: string) => void;
  onUpdateAlias: (aliasUid: string, patch: Partial<CharacterAlias>) => void;
  /** 播放位置配置表 */
  onAddPosition: () => void;
  onRemovePosition: (uid: string) => void;
  onUpdatePosition: (uid: string, patch: Partial<PlayPositionRow>) => void;
  /** 表情差分配置表（全局） */
  onAddExpression: () => void;
  onRemoveExpression: (uid: string) => void;
  onUpdateExpression: (uid: string, patch: Partial<ExpressionRow>) => void;
  /** 角色表拖拽排序 */
  onReorder: (from: number, to: number) => void;
  /** 全局搜索跳过来的那一行：交给上层滚过去，这里只负责高亮它 */
  focusUid?: string | null;
}

/**
 * 角色模块。
 *
 * 顶部是一块配置区（左右两张小表）：
 *   播放位置  —— 台词在哪儿显示，角色行里选的就是这里的条目（存 uid，改名不断引用）
 *   表情差分  —— 全局表情清单；图片 ID 的规则是 PIC_<角色ID>-<标识>，标识默认等于表情名
 * 下面才是角色表：每行勾这个角色有哪些表情，勾了的会在立绘页自动收成表情图片。
 */
export function CharacterEditor({
  project,
  onAdd,
  onRemove,
  onUpdate,
  onAddAlias,
  onRemoveAlias,
  onUpdateAlias,
  onAddPosition,
  onRemovePosition,
  onUpdatePosition,
  onAddExpression,
  onRemoveExpression,
  onUpdateExpression,
  onReorder,
  focusUid = null,
}: Props) {
  const [draftExpression, setDraftExpression] = useState<Record<string, string>>({});
  const editorRef = useScrollMemory('character');
  const drag = useRowDrag(onReorder);

  /** 有多少行对话用了这个角色：按 uid 数（改角色 ID 不会影响这件事） */
  const usageOf = (characterUid: string): number => {
    let count = 0;
    for (const chapter of project.chapters) {
      for (const group of chapter.groups) {
        for (const line of group.lines) {
          if (line.characterUid === characterUid) count += 1;
        }
      }
    }
    return count;
  };

  const positionNames = new Map(project.playPositions.map((row) => [row.uid, row.name]));
  const expressionNames = project.expressions.map((row) => row.name.trim());

  const addExpression = (character: Character): void => {
    const text = (draftExpression[character.uid] ?? '').trim();
    if (text === '' || character.expressions.includes(text)) return;
    onUpdate(character.uid, { expressions: [...character.expressions, text] });
    setDraftExpression((prev) => ({ ...prev, [character.uid]: '' }));
  };

  const removeExpression = (character: Character, expression: string): void => {
    onUpdate(character.uid, {
      expressions: character.expressions.filter((item) => item !== expression),
    });
  };

  return (
    <div className="editor" ref={editorRef}>
      {/* 配置区：播放位置 + 表情差分（左右两张小表） */}
      <div className="char-config">
        <section className="config-panel">
          <div className="lookup-subhead">
            <h3>播放位置</h3>
            <span className="hint">
              角色行里选的「播放位置」就是这里的条目，导出时原样写进「角色」子表；改名不用改角色。
            </span>
            <button type="button" className="primary" onClick={onAddPosition}>
              ＋ 新增位置
            </button>
          </div>

          {project.playPositions.length === 0 ? (
            <div className="empty-state">还没有播放位置。先加一个（比如「剧情对话框」）。</div>
          ) : (
            <table className="lines">
              <thead>
                <tr>
                  <th>位置名</th>
                  <th style={{ width: 74 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {project.playPositions.map((row) => (
                  <tr className="line-row" key={row.uid}>
                    <td>
                      <input
                        value={row.name}
                        placeholder="例如：剧情对话框"
                        onChange={(event) => onUpdatePosition(row.uid, { name: event.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="mini danger"
                        title="删掉这个位置；用着它的角色会挪到第一个位置上"
                        onClick={() => onRemovePosition(row.uid)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="config-panel">
          <div className="lookup-subhead">
            <h3>表情差分</h3>
            <span className="hint">
              全局表情清单，角色行里勾自己有哪些。图片 ID 规则是 PIC_角色ID-标识（标识默认等于表情名，
              想用英文就在这里改）。
            </span>
            <button type="button" className="primary" onClick={onAddExpression}>
              ＋ 新增表情
            </button>
          </div>

          {project.expressions.length === 0 ? (
            <div className="empty-state">还没有表情差分。先加几个（比如「微笑」「生气」）。</div>
          ) : (
            <table className="lines">
              <thead>
                <tr>
                  <th>表情</th>
                  <th>图片 ID 标识</th>
                  <th style={{ width: 74 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {project.expressions.map((row) => (
                  <tr className="line-row" key={row.uid}>
                    <td>
                      <input
                        value={row.name}
                        placeholder="例如：微笑"
                        onChange={(event) => onUpdateExpression(row.uid, { name: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={row.id}
                        placeholder={row.name.trim() === '' ? '默认等于表情名' : row.name}
                        title="图片 ID 里「-」后面那一段，例如 CHA_伊芙 + smile → PIC_CHA_伊芙-smile"
                        onChange={(event) => onUpdateExpression(row.uid, { id: event.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="mini danger"
                        title="删掉这个表情；角色行里勾了它的也会一起去掉"
                        onClick={() => onRemoveExpression(row.uid)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="editor-head">
        <h2>角色表</h2>
        <span className="hint">
          角色 ID 以 CHA_ 开头。勾上的表情供指令「剧情|演出|…;表情:」的下拉使用，也会在立绘页自动收成表情图片。
        </span>
        <button type="button" className="primary" onClick={onAdd}>
          ＋ 新增角色
        </button>
      </div>

      {project.characters.length === 0 ? (
        <div className="empty-state">
          还没有角色。先在这里建好角色和它的表情差分，写剧情时就能直接选了。
        </div>
      ) : (
        <table className="lines">
          <thead>
            <tr>
              <th className="cell-order" title="按住把手上下拖动可调整角色顺序" />
              <th style={{ width: '18%' }}>角色 ID</th>
              <th style={{ width: '16%' }}>默认名称</th>
              <th style={{ width: 132 }}>播放位置</th>
              <th>表情差分</th>
              <th className="col-mid">在剧情中的使用</th>
              <th style={{ width: 74 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {project.characters.map((character, index) => {
              const used = usageOf(character.uid);
              const duplicated =
                project.characters.filter((c) => c.id === character.id).length > 1;
              const positionName = positionNames.get(character.playPosition);
              const available = expressionNames.filter(
                (name) => name !== '' && !character.expressions.includes(name),
              );
              return (
                <tr key={character.uid} {...drag.rowProps(index, focusUid === character.uid ? 'flash' : '')} data-search-uid={character.uid}>
                  <OrderCell index={index} drag={drag} />
                  <td>
                    <input
                      value={character.id}
                      placeholder="CHA_"
                      onChange={(event) => onUpdate(character.uid, { id: event.target.value })}
                    />
                    {duplicated && <div className="field-error">角色 ID 重复</div>}
                    {character.id.trim() === '' && (
                      <div className="field-error">没填角色 ID，导出的角色表与本地化 key 都要用它</div>
                    )}
                  </td>
                  <td>
                    {/* 显示名称：第一行是默认名称，下面每行一个别名 */}
                    <div className="name-list">
                      <div className="name-row">
                        <span className="name-tag">默认名称</span>
                        <input
                          value={character.name}
                          placeholder="默认名称"
                          onChange={(event) => onUpdate(character.uid, { name: event.target.value })}
                        />
                      </div>

                      {character.aliases.map((alias, aliasIndex) => (
                        <div className="name-row" key={alias.uid}>
                          <span className="name-tag">别名{aliasIndex + 1}</span>
                          <input
                            value={alias.text}
                            placeholder="这个角色的另一种写法"
                            onChange={(event) =>
                              onUpdateAlias(alias.uid, { text: event.target.value })
                            }
                          />
                          <button
                            type="button"
                            className="mini danger"
                            title="删除这个别名（对话行里选过它的会变成「已不在别名里」，校验条会提醒）"
                            onClick={() => onRemoveAlias(character.uid, alias.uid)}
                          >
                            ×
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        className="option-add name-add"
                        onClick={() => onAddAlias(character.uid)}
                      >
                        ＋ 添加别名
                      </button>
                    </div>
                  </td>
                  <td>
                    <select
                      value={character.playPosition}
                      title="播放位置：这一角色的台词在哪儿显示（选项在上面「播放位置」表里配）"
                      onChange={(event) =>
                        onUpdate(character.uid, { playPosition: event.target.value })
                      }
                    >
                      {project.playPositions.map((position) => (
                        <option key={position.uid} value={position.uid}>
                          {position.name}
                        </option>
                      ))}
                      {/* 手改过的 JSON、或位置被删了：照原样列出来好让人改回去 */}
                      {positionName === undefined && (
                        <option value={character.playPosition}>
                          {character.playPosition === ''
                            ? '（未选播放位置）'
                            : `${character.playPosition}（位置已删除）`}
                        </option>
                      )}
                    </select>
                  </td>
                  <td>
                    <div className="expression-list">
                      {character.expressions.map((expression) => (
                        <span className="expression-chip" key={expression}>
                          {expression}
                          <button
                            type="button"
                            title="这个角色不用这个表情了"
                            onClick={() => removeExpression(character, expression)}
                          >
                            ×
                          </button>
                        </span>
                      ))}

                      {/* 从全局表情表里挑；表里没有的可以手动输入（回车添加） */}
                      <select
                        className="expression-add"
                        value=""
                        title="从表情差分配置表里选一个加到这个角色上"
                        onChange={(event) => {
                          const name = event.target.value;
                          if (name === '') return;
                          onUpdate(character.uid, {
                            expressions: [...character.expressions, name],
                          });
                        }}
                      >
                        <option value="">＋ 添加表情</option>
                        {available.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <input
                        className="expression-add"
                        value={draftExpression[character.uid] ?? ''}
                        placeholder="或手输表情名后回车"
                        onChange={(event) =>
                          setDraftExpression((prev) => ({
                            ...prev,
                            [character.uid]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addExpression(character);
                          }
                        }}
                        onBlur={() => addExpression(character)}
                      />
                    </div>
                  </td>
                  <td className="usage-cell">{used === 0 ? '尚未使用' : `${used} 行对话`}</td>
                  <td>
                    <button type="button" onClick={() => onRemove(character.uid)}>
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

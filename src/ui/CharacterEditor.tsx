import { useState } from 'react';

import {
  PLAY_POSITIONS,
  type Character,
  type CharacterAlias,
  type PlayPosition,
  type Project,
} from '../core/types';
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
  /** 全局搜索跳过来的那一行：交给上层滚过去，这里只负责高亮它 */
  focusUid?: string | null;
}

export function CharacterEditor({
  project,
  onAdd,
  onRemove,
  onUpdate,
  onAddAlias,
  onRemoveAlias,
  onUpdateAlias,
  focusUid = null,
}: Props) {
  const [draftExpression, setDraftExpression] = useState<Record<string, string>>({});
  const editorRef = useScrollMemory('character');

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
      <div className="editor-head">
        <h2>角色表</h2>
        <span className="hint">
          角色 ID 以 CHA_ 开头。表情差分供指令「剧情.演出# 角色.表情=」的下拉使用。
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
              <th style={{ width: '20%' }}>角色 ID</th>
              <th style={{ width: '16%' }}>默认名称</th>
              <th style={{ width: 132 }}>播放位置</th>
              <th>表情差分</th>
              <th className="col-mid">在剧情中的使用</th>
              <th style={{ width: 74 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {project.characters.map((character) => {
              const used = usageOf(character.uid);
              const duplicated =
                project.characters.filter((c) => c.id === character.id).length > 1;
              return (
                <tr
                  key={character.uid}
                  className={`line-row${focusUid === character.uid ? ' flash' : ''}`}
                  data-search-uid={character.uid}
                >
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

                      {character.aliases.map((alias, index) => (
                        <div className="name-row" key={alias.uid}>
                          <span className="name-tag">别名{index + 1}</span>
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
                      title="播放位置：这一角色的台词在哪儿显示——剧情对话框 / 战斗对话框 / 屏幕中间。导出时按原样写进「角色」子表"
                      onChange={(event) =>
                        onUpdate(character.uid, {
                          playPosition: event.target.value as PlayPosition,
                        })
                      }
                    >
                      {PLAY_POSITIONS.map((position) => (
                        <option key={position} value={position}>
                          {position}
                        </option>
                      ))}
                      {/* 手改过的 JSON 可能写成别的值，照原样列出来好让人改回去 */}
                      {!PLAY_POSITIONS.includes(character.playPosition) && (
                        <option value={character.playPosition}>{character.playPosition}（不在候选里）</option>
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
                            title="删除该表情"
                            onClick={() => removeExpression(character, expression)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        className="expression-add"
                        value={draftExpression[character.uid] ?? ''}
                        placeholder="＋ 输入表情名后回车"
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

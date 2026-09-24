import { useState } from 'react';

import type { Character, Project } from '../core/types';

interface Props {
  project: Project;
  onAdd: () => void;
  onRemove: (characterUid: string) => void;
  onUpdate: (characterUid: string, patch: Partial<Character>) => void;
}

export function CharacterEditor({ project, onAdd, onRemove, onUpdate }: Props) {
  const [draftExpression, setDraftExpression] = useState<Record<string, string>>({});

  const usageOf = (id: string): number => {
    let count = 0;
    for (const chapter of project.chapters) {
      for (const group of chapter.groups) {
        for (const line of group.lines) {
          if (line.characterId === id) count += 1;
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
    <div className="editor">
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
              <th style={{ width: '22%' }}>角色 ID</th>
              <th style={{ width: '18%' }}>默认名称</th>
              <th>表情差分</th>
              <th className="col-mid">在剧情中的使用</th>
              <th style={{ width: 74 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {project.characters.map((character) => {
              const used = usageOf(character.id);
              const duplicated =
                project.characters.filter((c) => c.id === character.id).length > 1;
              return (
                <tr key={character.uid} className="line-row">
                  <td>
                    <input
                      value={character.id}
                      placeholder="CHA_"
                      onChange={(event) => onUpdate(character.uid, { id: event.target.value })}
                    />
                    {duplicated && <div className="field-error">角色 ID 重复</div>}
                  </td>
                  <td>
                    <input
                      value={character.name}
                      placeholder="显示名称"
                      onChange={(event) => onUpdate(character.uid, { name: event.target.value })}
                    />
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

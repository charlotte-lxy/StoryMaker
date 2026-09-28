import { useState } from 'react';

import type { Project } from '../core/types';
import { useScrollMemory } from './view-memory';

interface Props {
  project: Project;
  /** 当前正在看流程图的章节 */
  activeChapterUid: string;
  activeGroupUid: string;
  onSelectChapter: (chapterUid: string) => void;
  onSelectGroup: (groupUid: string) => void;
  onRenameChapter: (chapterUid: string, title: string) => void;
  onRenameGroup: (groupUid: string, title: string) => void;
  onAddChapter: () => void;
  onAddGroup: (chapterUid: string) => void;
  onRemoveChapter: (chapterUid: string, title: string) => void;
  onRemoveGroup: (groupUid: string, title: string) => void;
}

/** 正在改名的对象；null 表示没有 */
interface Editing {
  uid: string;
  draft: string;
}

/**
 * 章节 / 段落侧边栏。
 *
 * 点章节 = 在右侧看这一章的段落流程图；点段落 = 打开这个段落的对话列表。
 * 每一行的 ✎ 可以改名字，回车或点别处生效，Esc 取消。
 */
export function Sidebar(props: Props) {
  const { project, activeGroupUid } = props;
  const [editing, setEditing] = useState<Editing | null>(null);
  // 切走再回来时回到原来的滚动位置（章节多的时候挺需要）
  const treeRef = useScrollMemory('story:tree');

  const commit = (kind: 'chapter' | 'group'): void => {
    if (editing === null) return;
    const title = editing.draft.trim();
    if (title !== '') {
      if (kind === 'chapter') props.onRenameChapter(editing.uid, title);
      else props.onRenameGroup(editing.uid, title);
    }
    setEditing(null);
  };

  /** 改名输入框：回车/失焦保存，Esc 取消 */
  const editor = (kind: 'chapter' | 'group') => (
    <input
      className="rename-input"
      autoFocus
      value={editing === null ? '' : editing.draft}
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const draft = event.target.value;
        setEditing((current) => (current === null ? null : { ...current, draft }));
      }}
      onBlur={() => commit(kind)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit(kind);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setEditing(null);
        }
      }}
    />
  );

  const renameButton = (kind: 'chapter' | 'group', uid: string, title: string) => (
    <button
      type="button"
      className="mini"
      title={kind === 'chapter' ? `重命名章节「${title}」` : `重命名段落「${title}」`}
      onClick={(event) => {
        event.stopPropagation();
        setEditing({ uid, draft: title });
      }}
    >
      ✎
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-tree" ref={treeRef}>
        <div className="sidebar-head">
          <h3>章节 / 段落</h3>
          <button type="button" className="mini" onClick={props.onAddChapter}>
            ＋ 章节
          </button>
        </div>

        {project.chapters.map((chapter) => {
          const renamingChapter = editing !== null && editing.uid === chapter.uid;
          return (
            <div key={chapter.uid} className="tree-chapter-block">
              <div
                className={`tree-chapter${chapter.uid === props.activeChapterUid ? ' active' : ''}`}
                title="点一下在右侧看这一章的段落流程图"
                onClick={() => props.onSelectChapter(chapter.uid)}
              >
                {renamingChapter ? (
                  editor('chapter')
                ) : (
                  <>
                    <span className="chapter-title">{chapter.title}</span>
                    <span className="chapter-id">{chapter.id}</span>
                  </>
                )}
                {!renamingChapter && renameButton('chapter', chapter.uid, chapter.title)}
                <button
                  type="button"
                  className="mini"
                  title="在本章新增段落"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onAddGroup(chapter.uid);
                  }}
                >
                  ＋
                </button>
                <button
                  type="button"
                  className="mini danger"
                  title="删除本章"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onRemoveChapter(chapter.uid, chapter.title);
                  }}
                >
                  ×
                </button>
              </div>

              {chapter.groups.map((group) => {
                const renamingGroup = editing !== null && editing.uid === group.uid;
                return (
                  <div
                    key={group.uid}
                    className={`tree-group${group.uid === activeGroupUid ? ' active' : ''}`}
                    title="点一下打开这个段落的对话列表"
                    onClick={() => props.onSelectGroup(group.uid)}
                  >
                    <span className="group-id">{group.id}</span>
                    {renamingGroup ? (
                      editor('group')
                    ) : (
                      <span className="group-title">{group.title}</span>
                    )}
                    <span className="count">{group.lines.length}</span>
                    {!renamingGroup && renameButton('group', group.uid, group.title)}
                    <button
                      type="button"
                      className="mini danger"
                      title="删除本段落"
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onRemoveGroup(group.uid, group.title);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              {chapter.groups.length === 0 && <div className="tree-empty">本章还没有段落</div>}
            </div>
          );
        })}

        {project.chapters.length === 0 && <div className="tree-empty">还没有章节</div>}
      </div>
    </aside>
  );
}

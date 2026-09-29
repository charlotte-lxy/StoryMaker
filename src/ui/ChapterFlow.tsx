import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { buildChapterFlow, layoutChapterFlow } from '../core/flow';
import type { Project } from '../core/types';
import { isLinesDrag } from './script-blocks';
import { useScrollMemory } from './view-memory';

/** 块的尺寸与间距：布局由 core/flow 算，这里只提供数字 */
const GEOMETRY = {
  /** 比最初那版缩到 0.75 倍，留出横向空间给同层的其他段落 */
  blockWidth: 180,
  /** 基础高度：标题 + 说明行 */
  blockHeight: 56,
  /** 注释每行的高度（估算用） */
  noteLineHeight: 17,
  rowGap: 22,
  columnGap: 16,
  /** 层与层之间留宽一点，选项标签就摆在这条带子里 */
  layerGap: 56,
  pad: 22,
  laneStart: 26,
  laneStep: 16,
};
/** 容器还没量出宽度时（比如 jsdom 里）先按这个宽度排版 */
const FALLBACK_WIDTH = 520;
const MIN_BLOCK_WIDTH = 120;

interface Props {
  project: Project;
  chapterUid: string;
  /** 当前选中的段落，在图上高亮 */
  activeGroupUid: string;
  /** 对话列表是否展开 */
  listOpen: boolean;
  onOpenGroup: (groupUid: string) => void;
  onJumpToOption: (optionUid: string) => void;
  onToggleList: () => void;
  onRenameGroup: (groupUid: string, title: string) => void;
  onSetGroupNote: (groupUid: string, note: string) => void;
  /** 批量编辑里把勾中的行拖到某个段落块上：视为「移动至」那个段落 */
  onDropLines: (groupUid: string) => void;
}

function sameHeights(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(b);
  if (keys.length !== Object.keys(a).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/**
 * 章节流程图。
 *
 * 段落块是自己排版的普通 DOM（文字排版、深浅色主题都交给 CSS），
 * 箭头用一层铺在下面的 SVG：坐标由同一套布局算出。
 * 块可以在图上直接改名、写注释；注释写长了块会变高，下面的块顺势下移。
 */
export function ChapterFlow(props: Props) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  // 切走再回来时回到原来的滚动位置；canvasRef 同时留给下面量宽度用
  const attachCanvas = useScrollMemory('story:flow', canvasRef);
  const [measured, setMeasured] = useState(0);
  /** 渲染后量到的真实块高：注释换行几行只有浏览器知道 */
  const [heights, setHeights] = useState<Record<string, number>>({});
  /** 鼠标停在哪条线或哪个块上：用来高亮相关的、淡化无关的 */
  const [focus, setFocus] = useState<{ kind: 'edge' | 'block'; id: string } | null>(null);
  const [renaming, setRenaming] = useState<{ uid: string; draft: string } | null>(null);
  const [noting, setNoting] = useState<{ uid: string; draft: string } | null>(null);
  /** 批量编辑拖过来的行正悬在哪个段落块上：那块高亮，松手就搬过去 */
  const [dropAt, setDropAt] = useState<string | null>(null);

  // 容器宽度变了要重算布局（拖动分隔线、拉窗口都会触发）
  useEffect(() => {
    const node = canvasRef.current;
    if (node === null) return;

    const update = (): void => setMeasured(node.clientWidth);
    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const flow = useMemo(
    () => buildChapterFlow(props.project, props.chapterUid),
    [props.project, props.chapterUid],
  );

  const usable = Math.max(measured, FALLBACK_WIDTH);
  const blockWidth = Math.max(
    MIN_BLOCK_WIDTH,
    Math.min(GEOMETRY.blockWidth, (usable - GEOMETRY.pad * 2 - GEOMETRY.columnGap) / 2),
  );

  const layout = useMemo(() => {
    if (flow === null) return null;
    return layoutChapterFlow(flow, {
      ...GEOMETRY,
      blockWidth,
      availableWidth: usable,
      measuredHeights: heights,
    });
  }, [flow, blockWidth, usable, heights]);

  // 量真实块高，回填给布局重排一次（高度稳定后不会再变，不会来回抖）
  const layoutHeightKey = layout === null ? '' : `${layout.width}x${layout.height}`;
  useEffect(() => {
    const board = boardRef.current;
    if (board === null) return;

    const measure = (): void => {
      const next: Record<string, number> = {};
      for (const node of Array.from(board.querySelectorAll('.flow-block'))) {
        const uid = node.getAttribute('data-block-uid');
        const height = node.getBoundingClientRect().height;
        // jsdom 里量出来是 0，这种情况保留估算高度
        if (uid !== null && height > 30) next[uid] = Math.round(height);
      }
      setHeights((current) => (sameHeights(current, next) ? current : next));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, [flow, layoutHeightKey]);

  const chapter = props.project.chapters.find((item) => item.uid === props.chapterUid);

  if (chapter === undefined || flow === null || layout === null) {
    return (
      <div className="flow-head">
        <h3>段落流程</h3>
      </div>
    );
  }

  const commitRename = (): void => {
    if (renaming === null) return;
    const title = renaming.draft.trim();
    if (title !== '') props.onRenameGroup(renaming.uid, title);
    setRenaming(null);
  };

  const commitNote = (): void => {
    if (noting === null) return;
    props.onSetGroupNote(noting.uid, noting.draft);
    setNoting(null);
  };

  const stop = (event: { stopPropagation: () => void }): void => event.stopPropagation();

  /**
   * 悬浮时该亮什么。
   *
   *   停在线上  → 线上加粗，两端段落块保持清楚，其他块淡下去
   *   停在块上  → 与它有关的线（进去的和出去的）全部加粗，相关段落块一起亮
   */
  const activeEdges = new Set<string>();
  const activeBlocks = new Set<string>();

  if (focus !== null) {
    if (focus.kind === 'edge') {
      for (const route of layout.edges) {
        if (route.edge.key !== focus.id) continue;
        activeEdges.add(route.edge.key);
        activeBlocks.add(route.edge.from);
        activeBlocks.add(route.edge.to);
      }
    } else {
      activeBlocks.add(focus.id);
      for (const route of layout.edges) {
        if (route.edge.from !== focus.id && route.edge.to !== focus.id) continue;
        activeEdges.add(route.edge.key);
        activeBlocks.add(route.edge.from);
        activeBlocks.add(route.edge.to);
      }
    }
  }

  const paragraphCount = flow.blocks.length;

  return (
    <>
      <div className="flow-head">
        <h3>{chapter.title || chapter.id} · 段落流程</h3>
        <span className="hint">
          {paragraphCount} 个段落
          {flow.edges.length > 0 ? ` · ${flow.edges.length} 条选项跳转` : ''}
        </span>
        <span className="spacer" />
        <button type="button" className="mini" onClick={props.onToggleList}>
          {props.listOpen ? '收起对话列表 ▶' : '◀ 展开对话列表'}
        </button>
      </div>

      <div className="flow-canvas" ref={attachCanvas}>
        {paragraphCount === 0 ? (
          <div className="empty-state">本章还没有段落，点章节名旁边的「＋」新增段落。</div>
        ) : (
          <div
            className={`flow-board${focus === null ? '' : ' dimming'}`}
            ref={boardRef}
            style={{ width: layout.width, height: layout.height }}
          >
            <svg
              className="flow-lines"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="flow-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path className="flow-arrow-head" d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>

              {layout.edges.map((route) => (
                <path
                  key={`hit-${route.edge.key}`}
                  className="flow-line-hit"
                  d={route.d}
                  onMouseEnter={() => setFocus({ kind: 'edge', id: route.edge.key })}
                  onMouseLeave={() => setFocus(null)}
                />
              ))}

              {layout.edges.map((route) => (
                <path
                  key={route.edge.key}
                  className={`flow-line${activeEdges.has(route.edge.key) ? ' active' : ''}`}
                  d={route.d}
                  markerEnd="url(#flow-arrow)"
                />
              ))}
            </svg>

            {layout.blocks.map((item) => {
              const uid = item.block.uid;
              const editingName = renaming !== null && renaming.uid === uid;
              const editingNote = noting !== null && noting.uid === uid;
              const note = item.block.note.trim();

              return (
                <div
                  key={uid}
                  data-block-uid={uid}
                  className={[
                    'flow-block',
                    uid === props.activeGroupUid ? 'selected' : '',
                    activeBlocks.has(uid) ? 'active' : '',
                    editingName || editingNote ? 'editing' : '',
                    dropAt === uid ? 'drop-lines' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ left: item.x, top: item.y, width: layout.blockWidth, minHeight: item.height }}
                  role="button"
                  tabIndex={0}
                  title={`${note === '' ? '' : `${note}\n`}打开「${item.block.title}」的对话列表`}
                  onClick={() => props.onOpenGroup(uid)}
                  onMouseEnter={() => setFocus({ kind: 'block', id: uid })}
                  onMouseLeave={() => setFocus(null)}
                  onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === 'Enter') props.onOpenGroup(uid);
                  }}
                  /* 批量编辑里把勾中的行拖到这块上：视为「移动至」这个段落 */
                  onDragOver={(event) => {
                    if (!isLinesDrag(event.dataTransfer)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropAt(uid);
                  }}
                  onDragLeave={() => setDropAt((current) => (current === uid ? null : current))}
                  onDrop={(event) => {
                    if (!isLinesDrag(event.dataTransfer)) return;
                    event.preventDefault();
                    setDropAt(null);
                    props.onDropLines(uid);
                  }}
                >
                  <span className="flow-block-tools">
                    <button
                      type="button"
                      className="mini"
                      title={`重命名段落「${item.block.title}」`}
                      onClick={(event) => {
                        stop(event);
                        setRenaming({ uid, draft: item.block.title });
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="mini"
                      title={note === '' ? '加段落注释' : '改段落注释'}
                      onClick={(event) => {
                        stop(event);
                        setNoting({ uid, draft: item.block.note });
                      }}
                    >
                      注
                    </button>
                  </span>

                  {editingName ? (
                    <input
                      className="rename-input"
                      autoFocus
                      value={renaming.draft}
                      onClick={stop}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setRenaming({ uid, draft: event.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setRenaming(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="flow-block-title">{item.block.title}</span>
                  )}

                  <span className="flow-block-meta">
                    {item.block.id} · {item.block.meta}
                  </span>

                  {editingNote ? (
                    <textarea
                      className="flow-block-note-input"
                      autoFocus
                      rows={3}
                      value={noting.draft}
                      placeholder="段落注释（只自己看，不导出）"
                      onClick={stop}
                      onChange={(event) => setNoting({ uid, draft: event.target.value })}
                      onBlur={commitNote}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setNoting(null);
                        }
                      }}
                    />
                  ) : (
                    note !== '' && <span className="flow-block-note">{note}</span>
                  )}
                </div>
              );
            })}

            {/* 线上的选项标签用 HTML 画：能截断、能点、能悬浮 */}
            {layout.edges.map((route) => (
              <button
                key={`label-${route.edge.key}`}
                type="button"
                className={`flow-edge-label${activeEdges.has(route.edge.key) ? ' active' : ''}`}
                style={{ left: route.labelX, top: route.labelY }}
                title={`${route.edge.note}\n点一下跳到第一个选项`}
                onMouseEnter={() => setFocus({ kind: 'edge', id: route.edge.key })}
                onMouseLeave={() => setFocus(null)}
                onFocus={() => setFocus({ kind: 'edge', id: route.edge.key })}
                onBlur={() => setFocus(null)}
                onClick={() => props.onJumpToOption(route.edge.optionUids[0])}
              >
                {route.edge.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

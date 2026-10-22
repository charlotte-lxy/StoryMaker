import type { ImageCategoryRow, LookupRow, Project } from '../core/types';
import type { LookupKind } from '../state/operations';
import { useScrollMemory } from './view-memory';

const TITLES: Record<LookupKind, { title: string; hint: string; placeholder: string }> = {
  items: {
    title: '物品表',
    hint: '物品 ID 供指令「背包||物品:…;运算符:+;数量:」与条件「背包||物品:…;运算符:>=」的下拉使用。',
    placeholder: '例如：金币',
  },
  quests: {
    title: '任务表',
    hint: '任务 ID 供指令「任务|接取|任务:…」与条件「任务||任务:…;运算符:=;结果:1」的下拉使用。',
    placeholder: '例如：凑齐医药费',
  },
  images: {
    title: '立绘 / 图片表',
    hint: '图片 ID 供指令「剧情|图片|图片:…」的下拉使用；每张图选一个分类，导出「图片」子表时按分类的存储路径拼资源路径。',
    placeholder: '例如：夜晚的城市',
  },
  sounds: {
    title: '音效表',
    hint: '音效 ID 供指令「剧情|音效|音效:…」的下拉使用。',
    placeholder: '例如：按键提示音',
  },
};

interface Props {
  project: Project;
  kind: LookupKind;
  onAdd: (kind: LookupKind) => void;
  onRemove: (kind: LookupKind, uid: string) => void;
  onUpdate: (kind: LookupKind, uid: string, patch: Partial<LookupRow>) => void;
  /** 图片分类（只有立绘页用） */
  onAddCategory: () => void;
  onRemoveCategory: (uid: string) => void;
  onUpdateCategory: (uid: string, patch: Partial<ImageCategoryRow>) => void;
  /** 全局搜索跳过来的那一行：交给上层滚过去，这里只负责高亮它 */
  focusUid?: string | null;
}

/**
 * 立绘页顶部的图片分类表。
 *
 * 分类存成独立一行（带 uid），图片行只记 uid，所以分类改名不会把图片写坏；
 * 导出「图片」子表时用分类名与存储路径拼资源路径。
 */
function ImageCategoryTable({
  rows,
  onAdd,
  onRemove,
  onUpdate,
}: {
  rows: ImageCategoryRow[];
  onAdd: () => void;
  onRemove: (uid: string) => void;
  onUpdate: (uid: string, patch: Partial<ImageCategoryRow>) => void;
}) {
  return (
    <section className="image-categories">
      <div className="lookup-subhead">
        <h3>图片分类</h3>
        <span className="hint">
          每张图属于一个分类；导出「图片」子表时拼成「存储路径/图片ID.图片ID」。
          新分类默认放在 /Game/GameContent/Asset/Image/分类名 下，路径可以自己改。
        </span>
        <button type="button" className="primary" onClick={onAdd}>
          ＋ 新增分类
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          还没有图片分类。先建一个（比如「对话背景」），下面的图片才能选它。
        </div>
      ) : (
        <table className="lines">
          <thead>
            <tr>
              <th style={{ width: '26%' }}>分类名</th>
              <th>存储路径</th>
              <th style={{ width: 86 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="line-row" key={row.uid}>
                <td>
                  <input
                    value={row.name}
                    placeholder="例如：对话背景"
                    onChange={(event) => onUpdate(row.uid, { name: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={row.path}
                    placeholder="/Game/GameContent/Asset/Image/分类名"
                    onChange={(event) => onUpdate(row.uid, { path: event.target.value })}
                  />
                </td>
                <td>
                  <button type="button" onClick={() => onRemove(row.uid)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function LookupEditor({
  project,
  kind,
  onAdd,
  onRemove,
  onUpdate,
  onAddCategory,
  onRemoveCategory,
  onUpdateCategory,
  focusUid = null,
}: Props) {
  const editorRef = useScrollMemory(`lookup:${kind}`);
  const rows = project[kind];
  const meta = TITLES[kind];
  const isImages = kind === 'images';
  const categories = project.imageCategories;
  const categoryByUid = new Map(categories.map((row) => [row.uid, row]));

  const idCounts = new Map<string, number>();
  for (const row of rows) idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);

  return (
    <div className="editor" ref={editorRef}>
      {isImages && (
        <ImageCategoryTable
          rows={categories}
          onAdd={onAddCategory}
          onRemove={onRemoveCategory}
          onUpdate={onUpdateCategory}
        />
      )}

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
              <th style={{ width: isImages ? '26%' : '36%' }}>ID</th>
              {isImages && <th style={{ width: 170 }}>图片分类</th>}
              <th>说明</th>
              <th style={{ width: 86 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const categoryUid = row.categoryUid ?? '';
              const category = categoryByUid.get(categoryUid);
              return (
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
                  {isImages && (
                    <td>
                      <select
                        value={categoryUid}
                        title="这张图属于哪个分类（导出「图片」列按分类的存储路径拼）"
                        onChange={(event) =>
                          onUpdate(kind, row.uid, { categoryUid: event.target.value })
                        }
                      >
                        <option value="">（未选分类）</option>
                        {categories.map((item) => (
                          <option key={item.uid} value={item.uid}>
                            {item.name.trim() === '' ? '（未命名分类）' : item.name}
                          </option>
                        ))}
                        {categoryUid !== '' && category === undefined && (
                          <option value={categoryUid}>（分类已删除）</option>
                        )}
                      </select>
                    </td>
                  )}
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
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

import type { AssetCategoryRow, LookupRow, Project } from '../core/types';
import { collectExpressionImages } from '../core/expression-images';
import type { CategoryKind, LookupKind } from '../state/operations';
import { OrderCell, useRowDrag } from './battle/row-drag';
import { useScrollMemory } from './view-memory';

interface LookupMeta {
  title: string;
  hint: string;
  placeholder: string;
  /** 这一页顶部有没有分类表（立绘的图片分类 / 音效的音效类型） */
  category?: { kind: CategoryKind; title: string; column: string; hint: string };
}

const TITLES: Record<LookupKind, LookupMeta> = {
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
    category: {
      kind: 'imageCategories',
      title: '图片分类',
      column: '图片分类',
      hint:
        '每张图属于一个分类；导出「图片」子表时拼成「存储路径/图片ID.图片ID」。' +
        '新分类默认放在 /Game/GameContent/Asset/Image/分类名 下，路径可以自己改。',
    },
  },
  sounds: {
    title: '音效表',
    hint: '音效 ID 供指令「剧情|音效|音效:…」的下拉使用；每条音效选一个类型，导出「音频」子表时按类型的存储路径拼资源路径。',
    placeholder: '例如：按键提示音',
    category: {
      kind: 'soundCategories',
      title: '音效类型',
      column: '音效类型',
      hint:
        '每条音效属于一个类型；导出「音频」子表时拼成「存储路径/音效ID.音效ID」。' +
        '新类型默认放在 /Game/GameContent/Asset/Sound/类型名 下，路径可以自己改。',
    },
  },
};

interface Props {
  project: Project;
  kind: LookupKind;
  onAdd: (kind: LookupKind) => void;
  onRemove: (kind: LookupKind, uid: string) => void;
  onUpdate: (kind: LookupKind, uid: string, patch: Partial<LookupRow>) => void;
  /** 表格行拖拽排序 */
  onReorder: (kind: LookupKind, from: number, to: number) => void;
  /** 分类表（只有立绘 / 音效页有） */
  onAddCategory: (kind: CategoryKind) => void;
  onRemoveCategory: (kind: CategoryKind, uid: string) => void;
  onUpdateCategory: (kind: CategoryKind, uid: string, patch: Partial<AssetCategoryRow>) => void;
  /** 全局搜索跳过来的那一行：交给上层滚过去，这里只负责高亮它 */
  focusUid?: string | null;
}

/**
 * 立绘 / 音效页顶部的分类表。
 *
 * 分类存成独立一行（带 uid），资源行只记 uid，所以分类改名不会把资源写坏；
 * 导出「图片」「音频」子表时用分类名与存储路径拼资源路径。
 */
function AssetCategoryTable({
  title,
  hint,
  column,
  rows,
  onAdd,
  onRemove,
  onUpdate,
}: {
  title: string;
  hint: string;
  column: string;
  rows: AssetCategoryRow[];
  onAdd: () => void;
  onRemove: (uid: string) => void;
  onUpdate: (uid: string, patch: Partial<AssetCategoryRow>) => void;
}) {
  return (
    <section className="image-categories">
      <div className="lookup-subhead">
        <h3>{title}</h3>
        <span className="hint">{hint}</span>
        <button type="button" className="primary" onClick={onAdd}>
          ＋ 新增分类
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          还没有{title}。先建一个，下面的{column === '图片分类' ? '图片' : '音效'}才能选它。
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
                    placeholder="/Game/GameContent/Asset/…/分类名"
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

/**
 * 表情图片列表（只在立绘页出现）。
 *
 * 角色模块里勾了哪些表情，这里就自动有一条图片：ID = PIC_<角色ID>-<表情标识>，
 * 分类固定是「角色立绘」，路径是「分类路径/<角色ID>/<图片ID>」。
 * 这张表不存盘，供核对与导出用。
 */
function ExpressionImageTable({ project }: { project: Project }) {
  const images = collectExpressionImages(project);

  return (
    <section className="image-categories expression-images">
      <div className="lookup-subhead">
        <h3>表情图片（自动收集）</h3>
        <span className="hint">
          角色模块里勾了表情，这里就自动有一条：ID = PIC_角色ID-表情标识，分类「角色立绘」，
          路径「分类路径/角色ID/图片ID」。导出「图片」子表时会自动接在下面。
        </span>
      </div>

      {images.length === 0 ? (
        <div className="empty-state">
          还没有表情图片。去角色模块给角色勾几个表情差分，这里就会自动出现。
        </div>
      ) : (
        <table className="lines">
          <thead>
            <tr>
              <th style={{ width: '30%' }}>图片 ID</th>
              <th style={{ width: 120 }}>角色</th>
              <th style={{ width: 100 }}>表情</th>
              <th style={{ width: 120 }}>图片分类</th>
              <th>图片路径</th>
            </tr>
          </thead>
          <tbody>
            {images.map((image) => (
              <tr className="line-row" key={image.id}>
                <td className="command-cell">{image.id}</td>
                <td className="command-cell">{image.characterName}</td>
                <td className="command-cell">{image.expression}</td>
                <td className="command-cell">{image.categoryName}</td>
                <td className="command-cell">{image.path}</td>
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
  onReorder,
  onAddCategory,
  onRemoveCategory,
  onUpdateCategory,
  focusUid = null,
}: Props) {
  const editorRef = useScrollMemory(`lookup:${kind}`);
  const rows = project[kind];
  const meta = TITLES[kind];
  const categoryMeta = meta.category;
  const categories: AssetCategoryRow[] =
    categoryMeta === undefined ? [] : project[categoryMeta.kind];
  const categoryByUid = new Map(categories.map((row) => [row.uid, row]));
  const drag = useRowDrag((from, to) => onReorder(kind, from, to));

  const idCounts = new Map<string, number>();
  for (const row of rows) idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);

  return (
    <div className="editor" ref={editorRef}>
      {categoryMeta !== undefined && (
        <AssetCategoryTable
          title={categoryMeta.title}
          hint={categoryMeta.hint}
          column={categoryMeta.column}
          rows={categories}
          onAdd={() => onAddCategory(categoryMeta.kind)}
          onRemove={(uid) => onRemoveCategory(categoryMeta.kind, uid)}
          onUpdate={(uid, patch) => onUpdateCategory(categoryMeta.kind, uid, patch)}
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
              <th className="cell-order" title="按住把手上下拖动可调整顺序" />
              <th style={{ width: categoryMeta === undefined ? '34%' : '24%' }}>ID</th>
              {categoryMeta !== undefined && <th style={{ width: 170 }}>{categoryMeta.column}</th>}
              <th>说明</th>
              <th style={{ width: 86 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const categoryUid = row.categoryUid ?? '';
              const category = categoryByUid.get(categoryUid);
              return (
                <tr
                  key={row.uid}
                  {...drag.rowProps(index, focusUid === row.uid ? 'flash' : '')}
                  data-search-uid={row.uid}
                >
                  <OrderCell index={index} drag={drag} />
                  <td>
                    <input
                      value={row.id}
                      onChange={(event) => onUpdate(kind, row.uid, { id: event.target.value })}
                    />
                    {(idCounts.get(row.id) ?? 0) > 1 && <div className="field-error">ID 重复</div>}
                  </td>
                  {categoryMeta !== undefined && (
                    <td>
                      <select
                        value={categoryUid}
                        title={`这一行属于哪个${categoryMeta.column}（导出的资源路径按它拼）`}
                        onChange={(event) =>
                          onUpdate(kind, row.uid, { categoryUid: event.target.value })
                        }
                      >
                        <option value="">（未选{categoryMeta.column}）</option>
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

      {kind === 'images' && <ExpressionImageTable project={project} />}
    </div>
  );
}

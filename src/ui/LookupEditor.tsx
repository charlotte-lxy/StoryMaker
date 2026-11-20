import { useRef } from 'react';

import type { AssetCategoryRow, LookupRow, Project } from '../core/types';
import type { HostApi } from '../core/host';
import { collectExpressionImages } from '../core/expression-images';
import { collectWeaponIcons } from '../core/weapon-icons';
import type { CategoryKind, LookupKind } from '../state/operations';
import { ImageAssetCell, SoundAssetCell } from './AssetManager';
import { OrderCell, useRowDrag } from './battle/row-drag';
import type { AssetLibrary } from './use-asset-library';
import { useScrollMemory } from './view-memory';

/** 表格要显示「素材管理」列时传进来的东西 */
export interface AssetColumnProps {
  library: AssetLibrary;
  host: HostApi | undefined;
}

interface LookupMeta {
  title: string;
  hint: string;
  placeholder: string;
  /** 这一页顶部有没有分类表（音效的音效类型） */
  category?: { kind: CategoryKind; title: string; column: string; hint: string };
}

const TITLES: Record<LookupKind, LookupMeta> = {
  items: {
    title: '物品表',
    hint:
      '物品 ID 供指令「背包||物品:…;运算符:+;数量:」与条件「背包||物品:…;运算符:>=」的下拉使用。' +
      '物品名称 / 物品描述会作为中文收进本地化「物品本地化」页，导出「物品」子表时写 TXT_ItemName_物品ID / TXT_ItemInfo_物品ID。',
    placeholder: '例如：金币',
  },
  quests: {
    title: '任务表',
    hint: '任务 ID 供指令「任务|接取|任务:…」与条件「任务||任务:…;运算符:=;结果:1」的下拉使用。',
    placeholder: '例如：凑齐医药费',
  },
  images: {
    title: '自定义图片',
    hint: '图片 ID 供指令「剧情|图片|图片:…」的下拉使用；每张图选一个分类，导出「图片」子表时按分类的存储路径拼资源路径。',
    placeholder: '例如：夜晚的城市',
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

/**
 * 分类表（立绘的图片分类 / 音效的音效类型）。
 *
 * 分类存成独立一行（带 uid），资源行只记 uid，所以分类改名不会把资源写坏；
 * 导出「图片」「音频」子表时用分类名与存储路径拼资源路径。
 */
export function AssetCategoryTable({
  title,
  hint,
  rows,
  onAdd,
  onRemove,
  onUpdate,
}: {
  title: string;
  hint: string;
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
        <div className="empty-state">还没有{title}。先建一个，数据表里才能选它。</div>
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
                    placeholder="/Game/GameContent/Asset/…"
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

/** 数据表的行（物品 / 任务 / 图片 / 音效共用；有分类的那两张表多一列下拉） */
export function LookupRowsTable({
  kind,
  project,
  rows,
  column,
  categoryKind,
  onUpdate,
  onRemove,
  onReorder,
  focusUid = null,
  assets,
  onRenameAsset,
}: {
  kind: LookupKind;
  project: Project;
  rows: LookupRow[];
  /** 有分类时这一列的标题（图片分类 / 音效类型） */
  column?: string;
  categoryKind?: CategoryKind;
  onUpdate: (kind: LookupKind, uid: string, patch: Partial<LookupRow>) => void;
  onRemove: (kind: LookupKind, uid: string) => void;
  onReorder: (kind: LookupKind, from: number, to: number) => void;
  focusUid?: string | null;
  /** 传了就多一列「素材管理」（立绘 / 音效用），不传就是普通表 */
  assets?: AssetColumnProps;
  /** 条目 ID 改完后把素材文件跟着改名（只有立绘 / 音效有） */
  onRenameAsset?: (uid: string, oldId: string, newId: string, kind: 'image' | 'sound') => void;
}) {
  const meta = TITLES[kind];
  /** 物品表多一列物品描述，名称那一列也改叫「物品名称」 */
  const isItem = kind === 'items';
  const hasAssets = assets !== undefined;
  /** ID 输入框聚焦时记下原值，失焦时比一次——只在真正改过名时通知上层 */
  const idAtFocus = useRef(new Map<string, string>());
  const assetKind = kind === 'sounds' ? 'sound' : kind === 'images' ? 'image' : null;
  const categories: AssetCategoryRow[] =
    categoryKind === undefined ? [] : project[categoryKind];
  const categoryByUid = new Map(categories.map((row) => [row.uid, row]));
  const drag = useRowDrag((from, to) => onReorder(kind, from, to));

  const idCounts = new Map<string, number>();
  for (const row of rows) idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);

  return (
    <table className="lines">
      <thead>
        <tr>
          <th className="cell-order" title="按住把手上下拖动可调整顺序" />
          <th style={{ width: isItem ? '24%' : column === undefined ? '34%' : '24%' }}>ID</th>
          {column !== undefined && <th style={{ width: 170 }}>{column}</th>}
          <th>{isItem ? '物品名称' : '说明'}</th>
          {isItem && <th>物品描述</th>}
          {hasAssets && <th style={{ width: 280 }}>素材管理</th>}
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
                  onFocus={() => idAtFocus.current.set(row.uid, row.id)}
                  onChange={(event) => onUpdate(kind, row.uid, { id: event.target.value })}
                  onBlur={(event) => {
                    // 只有真正改过名才通知：聚焦进来又原样出去不算
                    const previous = idAtFocus.current.get(row.uid);
                    idAtFocus.current.delete(row.uid);
                    if (previous === undefined || assetKind === null || onRenameAsset === undefined) {
                      return;
                    }
                    const next = event.currentTarget.value;
                    if (previous === next) return;
                    // 空 ID 拼不出素材名，先不动文件
                    if (previous.trim() === '' || next.trim() === '') return;
                    onRenameAsset(row.uid, previous, next, assetKind);
                  }}
                />
                {(idCounts.get(row.id) ?? 0) > 1 && <div className="field-error">ID 重复</div>}
              </td>
              {column !== undefined && (
                <td>
                  <select
                    value={categoryUid}
                    title={`这一行属于哪个${column}（导出的资源路径按它拼）`}
                    onChange={(event) =>
                      onUpdate(kind, row.uid, { categoryUid: event.target.value })
                    }
                  >
                    <option value="">（未选{column}）</option>
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
              {isItem && (
                <td>
                  <input
                    value={row.description ?? ''}
                    placeholder="物品描述（译文在本地化「物品本地化」页里填）"
                    onChange={(event) =>
                      onUpdate(kind, row.uid, { description: event.target.value })
                    }
                  />
                </td>
              )}
              {hasAssets && (
                <td>
                  {kind === 'sounds' ? (
                    <SoundAssetCell
                      row={row}
                      library={assets.library}
                      host={assets.host}
                      onUpdate={(patch) => onUpdate(kind, row.uid, patch)}
                    />
                  ) : (
                    <ImageAssetCell id={row.id} library={assets.library} host={assets.host} />
                  )}
                </td>
              )}
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
  );
}

/**
 * 表情图片列表（立绘页的「表情立绘」）。
 *
 * 角色模块里勾了哪些表情，这里就自动有一条图片：ID = PIC_<角色ID>-<表情标识>，
 * 分类固定是「角色立绘」，路径是「分类路径/<角色ID>/<图片ID>」。
 * 这张表不存盘，供核对与导出用。
 */
export function ExpressionImageTable({
  project,
  assets,
}: {
  project: Project;
  assets?: AssetColumnProps;
}) {
  const images = collectExpressionImages(project);

  return (
    <section className="expression-images">
      <div className="lookup-subhead">
        <h3>表情立绘（自动收集）</h3>
        <span className="hint">
          角色模块里勾了表情，这里就自动有一条：ID = PIC_角色ID-表情标识，分类「角色立绘」，
          路径「分类路径/角色ID/图片ID」。这张表只读，要改角色或表情请去角色模块。
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
              <th style={{ width: '24%' }}>图片 ID</th>
              <th style={{ width: 170 }}>图片分类</th>
              <th>说明</th>
              {assets !== undefined && <th style={{ width: 280 }}>素材管理</th>}
            </tr>
          </thead>
          <tbody>
            {images.map((image) => (
              <tr className="line-row" key={image.id}>
                <td>
                  <input readOnly value={image.id} title={image.path} />
                </td>
                <td>
                  <input readOnly value={image.categoryName} />
                </td>
                <td>
                  <input readOnly value={image.note} />
                </td>
                {assets !== undefined && (
                  <td>
                    <ImageAssetCell id={image.id} library={assets.library} host={assets.host} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * 武器图标列表（立绘页的「武器图标」）。
 *
 * 每把武器自动一条：ID = PIC_<武器ID>，分类「武器图标」，路径「分类路径/图片ID」。
 */
export function WeaponIconTable({
  project,
  assets,
}: {
  project: Project;
  assets?: AssetColumnProps;
}) {
  const icons = collectWeaponIcons(project);

  return (
    <section className="expression-images">
      <div className="lookup-subhead">
        <h3>武器图标（自动收集）</h3>
        <span className="hint">
          战斗模块里每把武器自动一条：ID = PIC_武器ID，分类「武器图标」，
          路径「分类路径/图片ID」。这张表只读，要改武器请去战斗模块。
        </span>
      </div>

      {icons.length === 0 ? (
        <div className="empty-state">
          还没有武器图标。去战斗模块的武器表加武器，这里就会自动出现。
        </div>
      ) : (
        <table className="lines">
          <thead>
            <tr>
              <th style={{ width: '24%' }}>图片 ID</th>
              <th style={{ width: 170 }}>图片分类</th>
              <th>说明</th>
              {assets !== undefined && <th style={{ width: 280 }}>素材管理</th>}
            </tr>
          </thead>
          <tbody>
            {icons.map((icon) => (
              <tr className="line-row" key={icon.id}>
                <td>
                  <input readOnly value={icon.id} title={icon.path} />
                </td>
                <td>
                  <input readOnly value={icon.categoryName} />
                </td>
                <td>
                  <input readOnly value={icon.note} />
                </td>
                {assets !== undefined && (
                  <td>
                    <ImageAssetCell id={icon.id} library={assets.library} host={assets.host} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface Props {
  project: Project;
  kind: LookupKind;
  onAdd: (kind: LookupKind) => void;
  onRemove: (kind: LookupKind, uid: string) => void;
  onUpdate: (kind: LookupKind, uid: string, patch: Partial<LookupRow>) => void;
  /** 表格行拖拽排序 */
  onReorder: (kind: LookupKind, from: number, to: number) => void;
  /** 分类表（只有音效页有；立绘页拆成子模块了，见 ImagesEditor） */
  onAddCategory: (kind: CategoryKind) => void;
  onRemoveCategory: (kind: CategoryKind, uid: string) => void;
  onUpdateCategory: (kind: CategoryKind, uid: string, patch: Partial<AssetCategoryRow>) => void;
  /** 全局搜索跳过来的那一行：交给上层滚过去，这里只负责高亮它 */
  focusUid?: string | null;
  /** 传了就多一列「素材管理」（音效页用） */
  assets?: AssetColumnProps;
  /** 条目 ID 改完后把素材文件跟着改名 */
  onRenameAsset?: (uid: string, oldId: string, newId: string, kind: 'image' | 'sound') => void;
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
  assets,
  onRenameAsset,
}: Props) {
  const editorRef = useScrollMemory(`lookup:${kind}`);
  const rows = project[kind];
  const meta = TITLES[kind];
  const categoryMeta = meta.category;

  return (
    <div className="editor" ref={editorRef}>
      {categoryMeta !== undefined && (
        <AssetCategoryTable
          title={categoryMeta.title}
          hint={categoryMeta.hint}
          rows={project[categoryMeta.kind]}
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
        <LookupRowsTable
          kind={kind}
          project={project}
          rows={rows}
          column={categoryMeta?.column}
          categoryKind={categoryMeta?.kind}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onReorder={onReorder}
          focusUid={focusUid}
          assets={assets}
          onRenameAsset={onRenameAsset}
        />
      )}
    </div>
  );
}

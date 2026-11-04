import { useEffect } from 'react';

import type { AssetCategoryRow, LookupRow, Project } from '../core/types';
import { collectExpressionImages } from '../core/expression-images';
import { collectWeaponIcons } from '../core/weapon-icons';
import type { CategoryKind, LookupKind } from '../state/operations';
import {
  AssetCategoryTable,
  ExpressionImageTable,
  LookupRowsTable,
  WeaponIconTable,
} from './LookupEditor';
import { useRememberedChoice, useScrollMemory } from './view-memory';

type ImagesPage = 'categories' | 'images' | 'expressions' | 'weaponIcons';

const PAGES: { key: ImagesPage; label: string }[] = [
  { key: 'categories', label: '图片分类' },
  { key: 'images', label: '自定义图片' },
  { key: 'expressions', label: '表情立绘' },
  { key: 'weaponIcons', label: '武器图标' },
];

interface Props {
  project: Project;
  onAdd: () => void;
  onRemove: (kind: LookupKind, uid: string) => void;
  onUpdate: (kind: LookupKind, uid: string, patch: Partial<LookupRow>) => void;
  onReorder: (kind: LookupKind, from: number, to: number) => void;
  onAddCategory: (kind: CategoryKind) => void;
  onRemoveCategory: (kind: CategoryKind, uid: string) => void;
  onUpdateCategory: (kind: CategoryKind, uid: string, patch: Partial<AssetCategoryRow>) => void;
  /** 全局搜索 / 校验条跳过来的那一行：切到「自定义图片」页并高亮它 */
  focusUid?: string | null;
}

/**
 * 立绘模块。
 *
 * 左边一条窄栏分四个子模块：
 *   图片分类  —— 分类名 + 存储路径（自定义图片行里选的就是这里）
 *   自定义图片 —— 策划自己填的立绘 / 背景图
 *   表情立绘  —— 角色模块勾的表情自动收出来的图（PIC_角色ID-表情标识）
 *   武器图标  —— 战斗模块每把武器自动一条（PIC_武器ID）
 *
 * 后两页只读：数据从别的模块现算，导出「图片」子表时自动接在自定义图片后面。
 */
export function ImagesEditor({
  project,
  onAdd,
  onRemove,
  onUpdate,
  onReorder,
  onAddCategory,
  onRemoveCategory,
  onUpdateCategory,
  focusUid = null,
}: Props) {
  const [page, setPage] = useRememberedChoice<ImagesPage>('images:page', 'images');
  const editorRef = useScrollMemory(`lookup:images:${page}`);
  const rows = project.images;

  // 搜索 / 校验跳过来的是某一行的 uid：切到自定义图片页再滚过去
  useEffect(() => {
    if (focusUid === null) return;
    if (rows.some((row) => row.uid === focusUid)) setPage('images');
  }, [focusUid]);

  const counts: Record<ImagesPage, number> = {
    categories: project.imageCategories.length,
    images: rows.length,
    expressions: collectExpressionImages(project).length,
    weaponIcons: collectWeaponIcons(project).length,
  };

  return (
    <div className="battle-body">
      <aside className="battle-side">
        {PAGES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={page === item.key ? 'battle-nav active' : 'battle-nav'}
            onClick={() => setPage(item.key)}
          >
            {item.label}
            <span className="count">{counts[item.key]}</span>
          </button>
        ))}
      </aside>

      <div className="battle-main">
        {page === 'categories' && (
          <div className="editor">
            <AssetCategoryTable
              title="图片分类"
              hint="每张图属于一个分类；导出「图片」子表时拼成「存储路径/图片ID.图片ID」。新分类默认放在 /Game/GameContent/Asset/Image/分类名 下，路径可以自己改。"
              rows={project.imageCategories}
              onAdd={() => onAddCategory('imageCategories')}
              onRemove={(uid) => onRemoveCategory('imageCategories', uid)}
              onUpdate={(uid, patch) => onUpdateCategory('imageCategories', uid, patch)}
            />
          </div>
        )}

        {page === 'images' && (
          <div className="editor" ref={editorRef}>
            <div className="editor-head">
              <h2>自定义图片</h2>
              <span className="hint">
                图片 ID 供指令「剧情|图片|图片:…」的下拉使用；每张图选一个分类。
              </span>
              <button type="button" className="primary" onClick={onAdd}>
                ＋ 新增一行
              </button>
            </div>

            {rows.length === 0 ? (
              <div className="empty-state">
                还没有图片。先在这里建好，写剧情时指令的下拉框才有内容可选。
              </div>
            ) : (
              <LookupRowsTable
                kind="images"
                project={project}
                rows={rows}
                column="图片分类"
                categoryKind="imageCategories"
                onUpdate={onUpdate}
                onRemove={onRemove}
                onReorder={onReorder}
                focusUid={focusUid}
              />
            )}
          </div>
        )}

        {page === 'expressions' && (
          <div className="editor" ref={editorRef}>
            <ExpressionImageTable project={project} />
          </div>
        )}

        {page === 'weaponIcons' && (
          <div className="editor" ref={editorRef}>
            <WeaponIconTable project={project} />
          </div>
        )}
      </div>
    </div>
  );
}

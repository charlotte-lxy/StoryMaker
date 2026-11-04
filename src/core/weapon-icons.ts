/**
 * 武器图标（每把武器一张图）。
 *
 * 武器表里不单独存图标 ID：它是按武器 ID 现算的 `PIC_<武器ID>`，
 * 立绘模块的「武器图标」页把它们收集起来，导出「图片」子表时接在手填图片与表情图片后面。
 *
 *   分类 = 「武器图标」（立绘页的分类表里可以改名 / 改路径）
 *   路径 = `<分类存储路径>/<图片ID>.<图片ID>`（图标直接放在分类这一层，不按武器分子文件夹）
 */

import { texturePath } from './asset-path';
import type { AssetCategoryRow, Project } from './types';

/** 武器图标默认用的分类名 */
export const WEAPON_ICON_CATEGORY = '武器图标';

/** 武器图标分类的默认存储路径 */
export const WEAPON_ICON_ROOT = '/Game/GameContent/Asset/Image/WeaponIcon';

/** 一条武器图标 */
export interface WeaponIcon {
  /** 图片 ID，也是导出「图片」子表的行名 */
  id: string;
  weaponUid: string;
  weaponId: string;
  weaponName: string;
  categoryUid: string;
  categoryName: string;
  /** 完整的 Texture2D 资源路径；分类或武器 ID 缺一个时为空串 */
  path: string;
  /** 备注列：武器名 */
  note: string;
}

/** 武器图标的图片 ID：PIC_<武器ID> */
export function weaponIconId(weaponId: string): string {
  const id = weaponId.trim();
  return id === '' ? '' : `PIC_${id}`;
}

/** 找武器图标那个分类（先认标记，老数据按名字兜底） */
export function weaponIconCategoryOf(project: Project): AssetCategoryRow | undefined {
  return project.imageCategories.find(
    (row) => row.system === 'weaponIcons' || row.name.trim() === WEAPON_ICON_CATEGORY,
  );
}

/** 收集全部武器的图标（按武器表顺序） */
export function collectWeaponIcons(project: Project): WeaponIcon[] {
  const category = weaponIconCategoryOf(project);
  const out: WeaponIcon[] = [];

  for (const weapon of project.battle.weapons) {
    const weaponId = weapon.id.trim();
    if (weaponId === '') continue;
    const id = weaponIconId(weaponId);
    if (id === '') continue;
    out.push({
      id,
      weaponUid: weapon.uid,
      weaponId,
      weaponName: weapon.name.trim() === '' ? weaponId : weapon.name.trim(),
      categoryUid: category?.uid ?? '',
      categoryName: category?.name ?? '',
      path: texturePath(category?.path ?? '', id),
      note: weapon.name.trim() === '' ? weaponId : weapon.name.trim(),
    });
  }

  return out;
}

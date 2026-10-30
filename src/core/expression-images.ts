/**
 * 表情图片（角色 × 表情差分）自动收集。
 *
 * 角色模块里勾了哪些表情差分，立绘模块就有一张对应的图片：
 *
 *   图片 ID = `PIC_<角色ID>-<表情标识>`（表情标识在角色页顶部的表情表里配，默认等于表情名）
 *   分类    = 「角色立绘」（立绘页的分类表里可以改名 / 改路径）
 *   路径    = `<分类存储路径>/<角色ID>/<图片ID>.<图片ID>`
 *
 * 这张表不存盘：每次都按角色与表情现算，角色改 ID、表情改名之后自动跟着变。
 * 导出「图片」子表时接在普通图片后面（同 ID 的以手填那行为准）。
 */

import { texturePath } from './asset-path';
import type { AssetCategoryRow, Project } from './types';

/** 表情图片默认用的分类名 */
export const EXPRESSION_IMAGE_CATEGORY = '角色立绘';

/** 表情图片分类的默认存储路径（每个角色在它下面有一个同名子文件夹） */
export const EXPRESSION_IMAGE_ROOT = '/Game/GameContent/Asset/Image/CharacterIllusion';

/** 一条表情图片 */
export interface ExpressionImage {
  /** 图片 ID，也是导出「图片」子表的行名 */
  id: string;
  characterUid: string;
  characterId: string;
  characterName: string;
  /** 表情名，如「微笑」 */
  expression: string;
  categoryUid: string;
  categoryName: string;
  /** 完整的 Texture2D 资源路径；分类或角色 ID 缺一个时为空串 */
  path: string;
  /** 备注列：角色名 · 表情名 */
  note: string;
}

/**
 * 找表情图片的分类。
 *
 * 优先认system 标记（分类改名之后仍然认得），老数据没有标记时按名字「角色立绘」兜底。
 * 都没有时返回 undefined（由迁移负责补上）。
 */
export function expressionCategoryOf(project: Project): AssetCategoryRow | undefined {
  return project.imageCategories.find(
    (row) =>
      row.system === 'expressionImages' || row.name.trim() === EXPRESSION_IMAGE_CATEGORY,
  );
}

/** 表情标识：配置里没填就用表情名 */
export function expressionIdOf(row: { name: string; id: string }): string {
  const id = row.id.trim();
  return id === '' ? row.name.trim() : id;
}

/** 拼一条表情图片的 ID：PIC_角色ID-表情标识 */
export function expressionPictureId(characterId: string, expressionId: string): string {
  const character = characterId.trim();
  const expression = expressionId.trim();
  if (character === '' || expression === '') return '';
  return `PIC_${character}-${expression}`;
}

/** 收集全部角色的表情图片（按角色顺序、每个角色按表情顺序） */
export function collectExpressionImages(project: Project): ExpressionImage[] {
  const category = expressionCategoryOf(project);
  const byName = new Map(project.expressions.map((row) => [row.name.trim(), row]));
  const out: ExpressionImage[] = [];

  for (const character of project.characters) {
    const characterId = character.id.trim();
    if (characterId === '') continue;
    // 每个角色一个同名子文件夹：<分类路径>/<角色ID>
    const folder =
      category === undefined || category.path.trim() === ''
        ? ''
        : `${category.path.trim().replace(/\/+$/, '')}/${characterId}`;

    for (const expression of character.expressions) {
      const name = expression.trim();
      if (name === '') continue;
      const row = byName.get(name);
      const id = expressionPictureId(characterId, expressionIdOf(row ?? { name, id: '' }));
      if (id === '') continue;
      out.push({
        id,
        characterUid: character.uid,
        characterId,
        characterName: character.name.trim() === '' ? characterId : character.name.trim(),
        expression: name,
        categoryUid: category?.uid ?? '',
        categoryName: category?.name ?? '',
        path: texturePath(folder, id),
        note: `${character.name.trim() === '' ? characterId : character.name.trim()} · ${name}`,
      });
    }
  }

  return out;
}

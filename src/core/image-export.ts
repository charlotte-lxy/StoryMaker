/**
 * 「图片」子表。
 *
 * 一张 DataTable 一行图，行名是图片 ID；图片路径由「分类的存储路径 + 图片 ID」拼出来：
 *
 *   ---       - 行名，图片 ID，如 SCE_Black
 *   图片分类  - 分类名，如「对话背景」
 *   备注      - 图片表里那一行的「说明」（纯文本，和「特殊指令」的备注一个写法）
 *   图片      - /Script/Engine.Texture2D'<分类存储路径>/<图片ID>.<图片ID>'
 *
 * 分类路径在「立绘」页的图片分类表里配置；图片行存的是分类的 uid，
 * 所以分类改名不会把图片行写坏。
 */

import type { Project } from './types';

export const IMAGE_SHEET = '图片';

export const IMAGE_HEADER: readonly string[] = ['', '图片分类', '备注', '图片'];

/** 分类存储路径的默认根：新分类默认放在它下面，并按分类名分子文件夹 */
export const DEFAULT_IMAGE_ASSET_ROOT = '/Game/GameContent/Asset/Image';

/** 新分类的默认存储路径：根目录 + 分类名 */
export function defaultImageCategoryPath(name: string): string {
  const folder = name.trim();
  return folder === '' ? `${DEFAULT_IMAGE_ASSET_ROOT}/` : `${DEFAULT_IMAGE_ASSET_ROOT}/${folder}`;
}

/**
 * 拼一条 Unreal 的 Texture2D 资源路径。
 *
 * 分类路径或图片 ID 缺一个就返回空串（导出「图片」列留空，由校验条提醒）。
 */
export function imageAssetPath(categoryPath: string, imageId: string): string {
  const folder = categoryPath.trim().replace(/\/+$/, '');
  const id = imageId.trim();
  if (folder === '' || id === '') return '';
  return `/Script/Engine.Texture2D'${folder}/${id}.${id}'`;
}

/** 生成「图片」子表的行（表头 + 数据行） */
export function buildImageRows(project: Project): string[][] {
  const categories = new Map(project.imageCategories.map((row) => [row.uid, row]));

  return [
    [...IMAGE_HEADER],
    ...project.images
      .filter((row) => row.id.trim() !== '')
      .map((row) => {
        const category = categories.get(row.categoryUid ?? '');
        return [
          row.id.trim(),
          category?.name ?? '',
          row.name,
          imageAssetPath(category?.path ?? '', row.id),
        ];
      }),
  ];
}

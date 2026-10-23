/**
 * 「音频」子表。
 *
 * 一张 DataTable 一行音效，行名是音效 ID；音频路径由「分类的存储路径 + 音效 ID」拼出来：
 *
 *   ---       - 行名，音效 ID，如 S_dididi
 *   音频      - /Script/Engine.SoundWave'<分类存储路径>/<音效ID>.<音效ID>'
 *   音效类型  - 分类名，如「背景音乐」「音效」
 *   备注      - 音效表里那一行的「说明」（纯文本，和图片子表一个写法）
 *
 * 分类路径在「音效」页的音效类型表里配置；音效行存的是分类的 uid，
 * 所以分类改名不会把音效行写坏。
 */

import type { Project } from './types';

export const SOUND_SHEET = '音频';

export const SOUND_HEADER: readonly string[] = ['', '音频', '音效类型', '备注'];

/** 分类存储路径的默认根：新分类默认放在它下面，并按分类名分子文件夹 */
export const DEFAULT_SOUND_ASSET_ROOT = '/Game/GameContent/Asset/Sound';

/** 新分类的默认存储路径：根目录 + 分类名 */
export function defaultSoundCategoryPath(name: string): string {
  const folder = name.trim();
  return folder === '' ? `${DEFAULT_SOUND_ASSET_ROOT}/` : `${DEFAULT_SOUND_ASSET_ROOT}/${folder}`;
}

/**
 * 拼一条 Unreal 的 SoundWave 资源路径。
 *
 * 分类路径或音效 ID 缺一个就返回空串（导出「音频」列留空，由校验条提醒）。
 */
export function soundAssetPath(categoryPath: string, soundId: string): string {
  const folder = categoryPath.trim().replace(/\/+$/, '');
  const id = soundId.trim();
  if (folder === '' || id === '') return '';
  return `/Script/Engine.SoundWave'${folder}/${id}.${id}'`;
}

/** 生成「音频」子表的行（表头 + 数据行） */
export function buildSoundRows(project: Project): string[][] {
  const categories = new Map(project.soundCategories.map((row) => [row.uid, row]));

  return [
    [...SOUND_HEADER],
    ...project.sounds
      .filter((row) => row.id.trim() !== '')
      .map((row) => {
        const category = categories.get(row.categoryUid ?? '');
        return [
          row.id.trim(),
          soundAssetPath(category?.path ?? '', row.id),
          category?.name ?? '',
          row.name,
        ];
      }),
  ];
}

/**
 * 预览要用的素材：把项目里的引用翻成「素材文件夹里的那个文件」。
 *
 * 素材文件名就是条目 ID（和导入规则一致），所以这里只做三件事：
 * 1. 引用（存的是 uid）→ 条目 → 条目 ID；
 * 2. 表情图按 `PIC_<角色ID>-<表情标识>` 拼 ID；
 * 3. 在素材库（按 ID 归类的文件列表）里找第一个文件。
 *
 * 找不到文件不是错误：预览会画一个占位框，并告诉策划是缺素材还是缺图。
 */

import { expressionIdOf, expressionPictureId } from './expression-images';
import type { AssetFileInfo } from './host';
import { soundPitchOf, soundVolumeOf } from './sound-export';
import type { Project } from './types';

/** 一个预览素材：要匹配的 ID 加找到的文件（文件可能不在） */
export interface PreviewAsset {
  id: string;
  file?: AssetFileInfo;
  /** 音效的音量 / 音调倍率（图片没有） */
  volume?: number;
  pitch?: number;
}

/** 素材文件夹里的文件，按「文件名去掉扩展名」归类（和 use-asset-library 的 byId 同构） */
export type AssetFilesById = Map<string, AssetFileInfo[]>;

function firstFile(byId: AssetFilesById, id: string): AssetFileInfo | undefined {
  const files = byId.get(id);
  return files === undefined || files.length === 0 ? undefined : files[0];
}

/** `剧情|图片` 指向的图片行 → 素材 */
export function imageAssetOf(
  project: Project,
  byId: AssetFilesById,
  imageUid: string,
): PreviewAsset | undefined {
  const row = project.images.find((item) => item.uid === imageUid);
  if (row === undefined) return undefined;
  return { id: row.id, file: firstFile(byId, row.id) };
}

/** `剧情|音效` 指向的音效行 → 素材 */
export function soundAssetOf(
  project: Project,
  byId: AssetFilesById,
  soundUid: string,
): PreviewAsset | undefined {
  const row = project.sounds.find((item) => item.uid === soundUid);
  if (row === undefined) return undefined;
  return {
    id: row.id,
    file: firstFile(byId, row.id),
    volume: soundVolumeOf(row),
    pitch: soundPitchOf(row),
  };
}

/**
 * 角色立绘：先找当前表情的图，再找 `PIC_<角色ID>`，最后退到该角色任何一张表情图。
 *
 * 找不到任何文件时仍返回一个带 ID 的对象——界面用那个 ID 画占位框。
 */
export function characterAssetOf(
  project: Project,
  byId: AssetFilesById,
  characterUid: string,
  expression: string,
): PreviewAsset | undefined {
  const character = project.characters.find((item) => item.uid === characterUid);
  if (character === undefined) return undefined;

  const characterId = character.id.trim();
  if (characterId === '') return undefined;

  const expressionName = expression.trim();
  const wanted: string[] = [];
  if (expressionName !== '') {
    const row = project.expressions.find((item) => item.name.trim() === expressionName);
    wanted.push(
      expressionPictureId(characterId, expressionIdOf(row ?? { name: expressionName, id: '' })),
    );
  }
  wanted.push(`PIC_${characterId}`);

  for (const id of wanted) {
    if (id === '') continue;
    const file = firstFile(byId, id);
    if (file !== undefined) return { id, file };
  }

  for (const name of character.expressions) {
    const row = project.expressions.find((item) => item.name.trim() === name.trim());
    const id = expressionPictureId(characterId, expressionIdOf(row ?? { name, id: '' }));
    if (id === '') continue;
    const file = firstFile(byId, id);
    if (file !== undefined) return { id, file };
  }

  return { id: wanted[0] ?? `PIC_${characterId}` };
}

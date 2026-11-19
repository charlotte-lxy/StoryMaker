import { describe, expect, it } from 'vitest';

import { characterAssetOf, imageAssetOf, soundAssetOf } from './preview-assets';
import type { AssetFileInfo } from './host';
import type { Project } from './types';
import { createEmptyProject } from '../state/operations';

function fileFor(baseName: string, kind: 'image' | 'sound' = 'image'): AssetFileInfo {
  const extension = kind === 'image' ? 'png' : 'wav';
  return {
    filePath: `D:\\素材\\${baseName}.${extension}`,
    fileName: `${baseName}.${extension}`,
    baseName,
    kind,
    size: 1,
    mtimeMs: 1,
  };
}

function mapOf(...names: string[]): Map<string, AssetFileInfo[]> {
  const map = new Map<string, AssetFileInfo[]>();
  for (const name of names) map.set(name, [fileFor(name)]);
  return map;
}

function projectWithCharacter(): Project {
  const project = createEmptyProject();
  project.characters.push({
    uid: 'cha1',
    id: 'CHA_雪',
    name: '西园寺雪',
    nameEn: '',
    nameJa: '',
    playPosition: '',
    aliases: [],
    expressions: ['微笑', '悲伤'],
    actions: [],
  });
  project.expressions.push({ uid: 'e1', name: '微笑', id: 'smile' });
  return project;
}

describe('imageAssetOf', () => {
  it('图片行 uid → 条目 ID → 素材文件', () => {
    const project = createEmptyProject();
    project.images.push({ uid: 'img1', id: 'PIC_海边', name: '海边' });

    const asset = imageAssetOf(project, mapOf('PIC_海边'), 'img1');
    expect(asset?.id).toBe('PIC_海边');
    expect(asset?.file?.fileName).toBe('PIC_海边.png');
  });

  it('引用的行不在了时返回 undefined', () => {
    const project = createEmptyProject();
    expect(imageAssetOf(project, mapOf('PIC_海边'), 'uid-悬空')).toBeUndefined();
  });

  it('有行但没素材：仍然给出 ID 供占位', () => {
    const project = createEmptyProject();
    project.images.push({ uid: 'img1', id: 'PIC_海边', name: '海边' });

    const asset = imageAssetOf(project, mapOf(), 'img1');
    expect(asset?.id).toBe('PIC_海边');
    expect(asset?.file).toBeUndefined();
  });
});

describe('soundAssetOf', () => {
  it('音效行 uid → 条目 ID → 素材文件', () => {
    const project = createEmptyProject();
    project.sounds.push({ uid: 'snd1', id: 'S_风', name: '风声' });

    const asset = soundAssetOf(project, mapOf('S_风'), 'snd1');
    expect(asset?.id).toBe('S_风');
    expect(asset?.file?.baseName).toBe('S_风');
  });
});

describe('characterAssetOf', () => {
  it('优先用当前表情的图（表情标识从表情表取）', () => {
    const project = projectWithCharacter();
    const byId = new Map<string, AssetFileInfo[]>();
    byId.set('PIC_CHA_雪-smile', [fileFor('PIC_CHA_雪-smile')]);
    byId.set('PIC_CHA_雪', [fileFor('PIC_CHA_雪')]);

    const asset = characterAssetOf(project, byId, 'cha1', '微笑');
    expect(asset?.id).toBe('PIC_CHA_雪-smile');
    expect(asset?.file?.fileName).toBe('PIC_CHA_雪-smile.png');
  });

  it('表情没图时退到 PIC_<角色ID>', () => {
    const project = projectWithCharacter();
    const byId = new Map<string, AssetFileInfo[]>();
    byId.set('PIC_CHA_雪', [fileFor('PIC_CHA_雪')]);

    const asset = characterAssetOf(project, byId, 'cha1', '微笑');
    expect(asset?.id).toBe('PIC_CHA_雪');
    expect(asset?.file?.fileName).toBe('PIC_CHA_雪.png');
  });

  it('什么都没配时退到该角色第一张表情图', () => {
    const project = projectWithCharacter();
    const byId = new Map<string, AssetFileInfo[]>();
    byId.set('PIC_CHA_雪-悲伤', [fileFor('PIC_CHA_雪-悲伤')]);

    const asset = characterAssetOf(project, byId, 'cha1', '');
    expect(asset?.id).toBe('PIC_CHA_雪-悲伤');
    expect(asset?.file?.fileName).toBe('PIC_CHA_雪-悲伤.png');
  });

  it('一张图都没有：给出想要的表情图 ID，file 为空', () => {
    const project = projectWithCharacter();
    const asset = characterAssetOf(project, mapOf(), 'cha1', '悲伤');
    expect(asset?.id).toBe('PIC_CHA_雪-悲伤');
    expect(asset?.file).toBeUndefined();
  });

  it('角色不在表里、或角色没有 ID 时返回 undefined', () => {
    const project = projectWithCharacter();
    expect(characterAssetOf(project, mapOf(), 'uid-没有', '')).toBeUndefined();

    project.characters[0].id = '  ';
    expect(characterAssetOf(project, mapOf(), 'cha1', '')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SOUND_ASSET_ROOT,
  buildSoundRows,
  defaultSoundCategoryPath,
  soundAssetPath,
} from './sound-export';
import { buildAllSheets } from './export';
import { createEmptyProject } from '../state/operations';
import type { Project } from './types';

/** 两条音效：一条选了类型，一条没选 */
function makeProject(): Project {
  const project = createEmptyProject();
  project.soundCategories = [
    { uid: 'cat-bgm', name: '背景音乐', path: '/Game/GameContent/Asset/Sound/BackgroundMusic' },
    { uid: 'cat-sfx', name: '音效', path: '/Game/GameContent/Asset/Sound/BackgroundSound/' },
  ];
  project.sounds = [
    { uid: 'snd-1', id: 'S_dididi', name: '滴滴滴效果音', categoryUid: 'cat-sfx' },
    { uid: 'snd-2', id: 'BGM_Title', name: '标题曲', categoryUid: 'cat-bgm' },
    { uid: 'snd-3', id: 'S_No_Category', name: '没选类型的音效' },
  ];
  return project;
}

describe('音频资源路径', () => {
  it('拼成 /Script/Engine.SoundWave\'<分类路径>/<音效ID>.<音效ID>\'', () => {
    expect(soundAssetPath('/Game/GameContent/Asset/Sound/BackgroundSound', 'S_di_1')).toBe(
      "/Script/Engine.SoundWave'/Game/GameContent/Asset/Sound/BackgroundSound/S_di_1.S_di_1'",
    );
  });

  it('分类路径末尾多写了斜杠也不出双斜杠', () => {
    expect(soundAssetPath('/Game/A/Sound/CG/', 'S_1')).toBe(
      "/Script/Engine.SoundWave'/Game/A/Sound/CG/S_1.S_1'",
    );
  });

  it('分类路径或音效 ID 缺一个就留空', () => {
    expect(soundAssetPath('', 'S_1')).toBe('');
    expect(soundAssetPath('/Game/A/Sound', '  ')).toBe('');
  });

  it('新类型的默认存储路径是根目录 + 类型名', () => {
    expect(defaultSoundCategoryPath('背景音乐')).toBe(`${DEFAULT_SOUND_ASSET_ROOT}/背景音乐`);
    expect(DEFAULT_SOUND_ASSET_ROOT).toBe('/Game/GameContent/Asset/Sound');
  });
});

describe('「音频」子表', () => {
  it('表头是 行名 / 音频 / 音效类型 / 备注', () => {
    expect(buildSoundRows(createEmptyProject())[0]).toEqual(['', '音频', '音效类型', '备注']);
  });

  it('没有音效时只有表头', () => {
    expect(buildSoundRows(createEmptyProject())).toHaveLength(1);
  });

  it('一行一条音效：行名是音效 ID，音频按类型路径拼，再写类型名与说明', () => {
    const rows = buildSoundRows(makeProject());

    expect(rows.slice(1)).toEqual([
      [
        'S_dididi',
        "/Script/Engine.SoundWave'/Game/GameContent/Asset/Sound/BackgroundSound/S_dididi.S_dididi'",
        '音效',
        '滴滴滴效果音',
      ],
      [
        'BGM_Title',
        "/Script/Engine.SoundWave'/Game/GameContent/Asset/Sound/BackgroundMusic/BGM_Title.BGM_Title'",
        '背景音乐',
        '标题曲',
      ],
      // 没选类型：音频与音效类型两列都留空，由校验条提醒
      ['S_No_Category', '', '', '没选类型的音效'],
    ]);
  });

  it('音效 ID 空着的行不导出', () => {
    const project = makeProject();
    project.sounds.push({ uid: 'snd-4', id: '  ', name: '空 ID', categoryUid: 'cat-sfx' });
    expect(buildSoundRows(project)).toHaveLength(4);
  });

  it('导出的子表清单里有「音频」，紧跟在「图片」后面', () => {
    const sheets = buildAllSheets(makeProject());
    const names = sheets.map((sheet) => sheet.name);
    expect(names.indexOf('音频')).toBe(names.indexOf('图片') + 1);
  });
});

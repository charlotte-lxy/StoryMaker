import { describe, expect, it } from 'vitest';

import type { Project } from '../core/types';
import { addBattleRow, updateBattleRow } from './battle-operations';
import { createEmptyProject, mutate } from './operations';
import { searchProject } from './search';

/**
 * 全局搜索的取值与行号。
 *
 * 「第几行」必须和界面上看到的一致：剧情按段落里的行序、战斗按各表的行序、
 * 本地化按本地化页面的行序，所以这里连行号一起断言。
 */

/** 一份各模块都放了一点数据的项目：序章 / 开场里有一行对话，外加角色、物品、UI 文本、一个属性 */
function makeProject(): Project {
  const base = mutate(createEmptyProject('搜索测试'), (draft) => {
    draft.chapters[0].groups[0].lines[0].text.zh = '我们该走了';
    draft.chapters[0].groups[0].lines[0].characterId = 'CHA_伊芙';
    draft.characters.push({
      uid: 'c1',
      id: 'CHA_伊芙',
      name: '伊芙',
      expressions: ['微笑'],
      actions: [],
    });
    draft.items.push({ uid: 'i1', id: 'Item_Coin', name: '金币' });
    draft.uiTexts.push({
      uid: 'u1',
      key: 'TXT_Widget_开始游戏',
      text: { zh: '开始游戏', en: 'Start Game', ja: '' },
    });
  });

  const withAttribute = addBattleRow(base, 'attributes');
  return updateBattleRow(withAttribute, 'attributes', withAttribute.battle.attributes[0].uid, {
    name: '生命值',
  });
}

const project = makeProject();
const lineUid = project.chapters[0].groups[0].lines[0].uid;

describe('全局搜索', () => {
  it('空关键词不搜，什么都不返回', () => {
    expect(searchProject(project, '')).toEqual([]);
    expect(searchProject(project, '   ')).toEqual([]);
  });

  it('命中对话行：标明子模块、第几行与行标识，目标是那一行', () => {
    // 台词同时命中剧情和本地化（那条对话的译文就是同一句）
    const groups = searchProject(project, '该走');
    expect(groups.map((group) => group.module)).toEqual(['story', 'locale']);

    const hit = groups[0].hits[0];
    expect(hit.submodule).toBe('序章 / 开场');
    expect(hit.rowNumber).toBe(1);
    expect(hit.rowLabel).toBe('Dia_ch01_001-1');
    expect(hit.text).toBe('我们该走了');
    expect(hit.target).toEqual({ kind: 'line', uid: lineUid });
  });

  it('章节名与段落名也能搜到，各自给出跳到哪一章 / 哪一段', () => {
    const [chapterHit] = searchProject(project, '序章')[0].hits;
    expect(chapterHit.submodule).toBe('章节');
    expect(chapterHit.target).toEqual({
      kind: 'chapter',
      uid: project.chapters[0].uid,
    });

    const [groupHit] = searchProject(project, '开场')[0].hits;
    expect(groupHit.submodule).toBe('序章');
    expect(groupHit.target).toEqual({
      kind: 'group',
      uid: project.chapters[0].groups[0].uid,
    });
  });

  it('一个词同时命中好几个模块时，按模块分组返回', () => {
    // 「伊芙」既是那一行的角色 ID，也是角色表里的一条
    expect(searchProject(project, '伊芙').map((group) => group.module)).toEqual([
      'story',
      'character',
    ]);
  });

  it('模块筛选只搜指定的那一个模块', () => {
    expect(searchProject(project, '伊芙', 'character').map((group) => group.module)).toEqual([
      'character',
    ]);
    expect(searchProject(project, '该走', 'character')).toEqual([]);
  });

  it('战斗表命中时给出子页面与表内行号', () => {
    const groups = searchProject(project, '生命值');
    expect(groups.map((group) => group.module)).toEqual(['battle']);

    const hit = groups[0].hits[0];
    expect(hit.submodule).toBe('属性表（AS）');
    expect(hit.rowNumber).toBe(1);
    expect(hit.rowLabel).toBe('生命值');
    expect(hit.target).toEqual({
      kind: 'battle',
      page: 'attributes',
      uid: project.battle.attributes[0].uid,
    });
  });

  it('本地化的行号跟本地化页面上数出来的一样', () => {
    const groups = searchProject(project, 'TXT_');
    expect(groups.map((group) => group.module)).toEqual(['locale']);
    expect(groups[0].hits.map((hit) => [hit.submodule, hit.rowNumber, hit.rowLabel])).toEqual([
      ['剧情本地化', 1, 'TXT_Dia_ch01_001-1'],
      ['UI 本地化', 1, 'TXT_Widget_开始游戏'],
    ]);
  });

  it('数据表命中：子模块名与行标识都跟着表里的内容走', () => {
    const [hit] = searchProject(project, '金币')[0].hits;
    expect(hit.submodule).toBe('物品表');
    expect(hit.rowNumber).toBe(1);
    expect(hit.rowLabel).toBe('Item_Coin');
    expect(hit.text).toBe('金币');
    expect(hit.target).toEqual({ kind: 'row', module: 'items', uid: 'i1' });
  });

  it('搜索结果里带的 uid 就是那一行的 uid', () => {
    const [hit] = searchProject(project, '微笑')[0].hits;
    expect(hit.submodule).toBe('角色表');
    expect(hit.target).toEqual({ kind: 'row', module: 'character', uid: 'c1' });
  });
});

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

/** 一份各模块都放了一点数据的项目：序章 / 开场里有一行对话，外加角色、物品、UI 文本、两条属性 */
function makeProject(): Project {
  const base = mutate(createEmptyProject('搜索测试'), (draft) => {
    draft.chapters[0].groups[0].lines[0].text.zh = '我们该走了';
    // 角色那一格存的是角色 uid：搜索要能把这一行按角色名 / 角色 ID 找出来
    draft.chapters[0].groups[0].lines[0].characterUid = 'c1';
    draft.characters.push({
      uid: 'c1',
      id: 'CHA_伊芙',
      name: '伊芙',
      playPosition: '剧情对话框', nameEn: '', nameJa: '', aliases: [],
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

  // 属性表放两条：一条平常的，一条用来试「空格隔开多个关键词」
  let battle = addBattleRow(base, 'attributes');
  battle = addBattleRow(battle, 'attributes');
  battle = updateBattleRow(battle, 'attributes', battle.battle.attributes[0].uid, {
    name: '生命值',
  });
  return updateBattleRow(battle, 'attributes', battle.battle.attributes[1].uid, {
    name: 'Like_田中美代子',
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
    expect(hit.target).toEqual({ kind: 'line', uid: lineUid });

    // 行标识里没有这个词，命中的是台词：片段带着要高亮的位置
    expect(hit.labelMarks).toEqual([]);
    expect(hit.snippets).toEqual([{ text: '我们该走了', marks: [[2, 4]] }]);
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
    // 「伊芙」既是那一行的角色 ID，也是角色表里的一条，
    // 还是本地化表里那条角色名的 key（TXT_CHA_伊芙_DefaultName）
    expect(searchProject(project, '伊芙').map((group) => group.module)).toEqual([
      'story',
      'character',
      'locale',
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
      // 角色名 / 显示名的 key 也是 TXT_ 开头
      ['角色名本地化', 1, 'TXT_CHA_伊芙_DefaultName'],
    ]);
  });

  it('数据表命中：子模块名与行标识都跟着表里的内容走', () => {
    const [hit] = searchProject(project, '金币')[0].hits;
    expect(hit.submodule).toBe('物品表');
    expect(hit.rowNumber).toBe(1);
    expect(hit.rowLabel).toBe('Item_Coin');
    expect(hit.snippets).toEqual([{ text: '金币', marks: [[0, 2]] }]);
    expect(hit.target).toEqual({ kind: 'row', module: 'items', uid: 'i1' });
  });

  it('空格隔开的多个关键词：每一个都要命中，但不必挤在同一个字段里', () => {
    const groups = searchProject(project, 'Like 中');
    expect(groups.map((group) => group.module)).toEqual(['battle']);
    expect(groups[0].hits.map((hit) => hit.rowLabel)).toEqual(['Like_田中美代子']);

    // 词只命中一部分的，一条都不出
    expect(searchProject(project, 'Like 中村')).toEqual([]);

    // 两个词分散在两个字段里也算命中：属性名里有 Like，备注里有中村
    const spread = mutate(project, (draft) => {
      draft.battle.attributes[1].note = '参考中村的人设';
    });
    expect(searchProject(spread, 'Like 中村')[0].hits[0].rowLabel).toBe('Like_田中美代子');
  });

  it('命中的每一个词都标出来，位置按各自所在的串算', () => {
    const [hit] = searchProject(project, 'Like 中')[0].hits;
    expect(hit.rowLabel).toBe('Like_田中美代子');
    // L0 i1 k2 e3 _4 田5 中6 → Like 是 [0,4]，中是 [6,7]
    expect(hit.labelMarks).toEqual([
      [0, 4],
      [6, 7],
    ]);
  });

  it('太长的一句话按命中点开窗，不会把命中的字截掉', () => {
    const long = mutate(project, (draft) => {
      draft.items[0].name = `${'前'.repeat(100)}金币`;
    });
    const [snippet] = searchProject(long, '金币')[0].hits[0].snippets;

    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.endsWith('金币')).toBe(true);
    const [from, to] = snippet.marks[0];
    expect(snippet.text.slice(from, to)).toBe('金币');
  });

  it('搜索结果里带的 uid 就是那一行的 uid', () => {
    const [hit] = searchProject(project, '微笑')[0].hits;
    expect(hit.submodule).toBe('角色表');
    expect(hit.target).toEqual({ kind: 'row', module: 'character', uid: 'c1' });
  });
});

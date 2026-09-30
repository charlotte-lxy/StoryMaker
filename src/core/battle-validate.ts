/**
 * 战斗模块（GAS）的校验。
 *
 * 报的都是「导进 Unreal 才会炸」的问题：重名的 Tag 互相覆盖、
 * 修改器引用了一个不存在的属性、技能锁定的 GA 已经被删掉等等。
 */

import { modifierText } from './battle';
import { attributeNameOf, looksLikeUid, resolveAttribute, resolveEvent, resolveSkill } from './refs';
import type { Issue, IssueCode, ValidationReport } from './validate';
import type { BattleData, GasModifier, GasPair, Project } from './types';

/**
 * 引用在提示里怎么写给人看。
 *
 * 战斗模块的引用存的是 uid，uid 读不出是哪一条，所以能查出名字就写名字、
 * 查不出名字且看起来是 uid 就干脆不写（说「已经不在表里了」就够明白了），
 * 老数据里按名字 / ID 存的原样写出来。
 */
function refText(raw: string, name = ''): string {
  if (name !== '') return `「${name}」`;
  return looksLikeUid(raw) ? '' : `「${raw.trim()}」`;
}

/** 一条问题：带上是哪个子页面、哪一行，界面点一下就能跳过去 */
function issue(
  level: 'error' | 'warning',
  code: IssueCode,
  where: string,
  message: string,
  targetId: string,
  battlePage: string,
  battleUid: string,
): Issue {
  return {
    level,
    code,
    targetId,
    where,
    message,
    lineUid: '',
    groupUid: '',
    battlePage,
    battleUid,
  };
}

/** 找出重名的行；同一个名字只报一条 */
function duplicates(names: readonly string[]): { name: string; count: number; index: number }[] {
  const counts = new Map<string, { count: number; index: number }>();
  names.forEach((raw, index) => {
    const name = raw.trim();
    if (name === '') return;
    const found = counts.get(name);
    if (found === undefined) counts.set(name, { count: 1, index });
    else found.count += 1;
  });
  return [...counts.entries()]
    .filter(([, value]) => value.count > 1)
    .map(([name, value]) => ({ name, count: value.count, index: value.index }));
}

/** 数值列：填了就必须是数字（-1 表示无限也走这里） */
function checkNumber(
  issues: Issue[],
  value: string,
  label: string,
  where: string,
  targetId: string,
  battlePage: string,
  battleUid: string,
): void {
  const trimmed = value.trim();
  if (trimmed === '') return;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return;
  issues.push(
    issue('warning', 'battle-not-number', where, `${label}「${trimmed}」不是数字`, targetId, battlePage, battleUid),
  );
}

/** 修改器列表：属性必须来自属性表，值不能空 */
function checkModifiers(
  issues: Issue[],
  modifiers: readonly GasModifier[],
  battle: BattleData,
  where: string,
  targetId: string,
  battlePage: string,
  battleUid: string,
): void {
  for (const modifier of modifiers) {
    const ref = modifier.attributeUid.trim();
    const attribute = resolveAttribute(battle, ref);
    const value = modifier.value.trim();
    if (ref === '' || value === '') {
      issues.push(
        issue('warning', 'battle-empty-modifier', where, '修改器还没填完（属性名与值都要有）', targetId, battlePage, battleUid),
      );
      continue;
    }
    if (attribute === undefined) {
      issues.push(
        issue(
          'error',
          'battle-unknown-attribute',
          where,
          `修改器引用了属性表里没有的属性${refText(ref)}`,
          targetId,
          battlePage,
          battleUid,
        ),
      );
      continue;
    }
    if (modifierText(modifier, attributeNameOf(battle, ref)) === '') {
      issues.push(
        issue('warning', 'battle-empty-modifier', where, '修改器还没填完', targetId, battlePage, battleUid),
      );
    }
  }
}

/** 键值对列表：键不能空、同一个列表里键不能重复 */
function checkPairs(
  issues: Issue[],
  pairs: readonly GasPair[],
  label: string,
  keyLabel: (key: string) => string,
  where: string,
  targetId: string,
  battlePage: string,
  battleUid: string,
): void {
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key === '' && pair.value.trim() === '') continue;
    if (key === '') {
      issues.push(
        issue('warning', 'battle-empty-pair', where, `${label}有一行没填名字`, targetId, battlePage, battleUid),
      );
      continue;
    }
    if (seen.has(key)) {
      issues.push(
        issue(
          'error',
          'battle-duplicate-pair',
          where,
          `${label}里有重复的条目${keyLabel(key)}`,
          targetId,
          battlePage,
          battleUid,
        ),
      );
      continue;
    }
    seen.add(key);
  }
}

/** 引用的行必须还在对应表里；uid 与老数据里的名字 / ID 都认 */
function checkRefs(
  issues: Issue[],
  refs: readonly string[],
  resolve: (ref: string) => { uid: string } | undefined,
  nameOf: (ref: string) => string,
  label: string,
  missingLabel: string,
  where: string,
  targetId: string,
  battlePage: string,
  battleUid: string,
): void {
  for (const raw of refs) {
    const value = raw.trim();
    if (value === '' || resolve(value) !== undefined) continue;
    issues.push(
      issue(
        'error',
        'battle-dangling-ref',
        where,
        `${label}里的${missingLabel}${refText(value, nameOf(value))}已经不在表里了`,
        targetId,
        battlePage,
        battleUid,
      ),
    );
  }
}

export function validateBattle(project: Project): ValidationReport {
  const battle = project.battle;
  const issues: Issue[] = [];

  /** 引用在提示里显示成对应的名字（查不到就按 refText 的规矩处理） */
  const attributeLabel = (ref: string): string => refText(ref, resolveAttribute(battle, ref)?.name.trim() ?? '');
  const skillLabel = (ref: string): string => refText(ref, resolveSkill(battle, ref)?.name.trim() ?? '');
  const eventLabel = (ref: string): string => refText(ref, resolveEvent(battle, ref)?.name.trim() ?? '');

  /* 属性 */
  for (const found of duplicates(battle.attributes.map((row) => row.name))) {
    const row = battle.attributes[found.index];
    issues.push(
      issue('error', 'battle-duplicate-name', '属性', `属性名「${found.name}」有 ${found.count} 条，Tag 会撞车`, found.name, 'attributes', row.uid),
    );
  }
  for (const row of battle.attributes) {
    if (row.name.trim() === '') {
      issues.push(issue('error', 'battle-empty-name', '属性', '这一条属性还没有名字，Tag 合成不出来', '(空)', 'attributes', row.uid));
    }
  }

  /* 事件 */
  for (const found of duplicates(battle.events.map((row) => row.name))) {
    const row = battle.events[found.index];
    issues.push(
      issue('error', 'battle-duplicate-name', '事件', `事件名「${found.name}」有 ${found.count} 条，Tag 会撞车`, found.name, 'events', row.uid),
    );
  }
  for (const row of battle.events) {
    if (row.name.trim() === '') {
      issues.push(issue('error', 'battle-empty-name', '事件', '这一条事件还没有名字，Tag 合成不出来', '(空)', 'events', row.uid));
    }
  }

  /* 效果 */
  for (const found of duplicates(battle.effects.map((row) => row.name))) {
    const row = battle.effects[found.index];
    issues.push(
      issue('error', 'battle-duplicate-name', '效果', `效果名「${found.name}」有 ${found.count} 条，Tag 会撞车`, found.name, 'effects', row.uid),
    );
  }
  for (const row of battle.effects) {
    const target = row.name.trim() === '' ? '(空)' : row.name.trim();
    if (row.name.trim() === '') {
      issues.push(issue('error', 'battle-empty-name', '效果', '这一条效果还没有名字，Tag 合成不出来', '(空)', 'effects', row.uid));
    }
    if (row.className.trim() === '') {
      issues.push(issue('warning', 'battle-empty-class', '效果', '还没填类名，导出的 GE类 会是空的', target, 'effects', row.uid));
    }
    checkNumber(issues, row.duration, '总时长', '效果', target, 'effects', row.uid);
    checkNumber(issues, row.period, '周期时长', '效果', target, 'effects', row.uid);
    checkNumber(issues, row.reduceStacks, '触发后减少层数', '效果', target, 'effects', row.uid);
    checkNumber(issues, row.maxStacks, '最大堆叠层数', '效果', target, 'effects', row.uid);
    checkModifiers(issues, row.modifiers, battle, '效果', target, 'effects', row.uid);
  }

  /* 技能 */
  for (const found of duplicates(battle.skills.map((row) => row.name))) {
    const row = battle.skills[found.index];
    issues.push(
      issue('error', 'battle-duplicate-name', '技能', `技能名「${found.name}」有 ${found.count} 条，Tag 会撞车`, found.name, 'skills', row.uid),
    );
  }
  for (const row of battle.skills) {
    const target = row.name.trim() === '' ? '(空)' : row.name.trim();
    if (row.name.trim() === '') {
      issues.push(issue('error', 'battle-empty-name', '技能', '这一条技能还没有名字，Tag 合成不出来', '(空)', 'skills', row.uid));
    }
    if (row.className.trim() === '') {
      issues.push(issue('warning', 'battle-empty-class', '技能', '还没填类名，导出的 GA类 会是空的', target, 'skills', row.uid));
    }
    checkRefs(issues, row.lockSkillUids, (ref) => resolveSkill(battle, ref), skillLabel, '锁定GA列表', '技能', '技能', target, 'skills', row.uid);
    checkRefs(issues, row.listenEventUids, (ref) => resolveEvent(battle, ref), eventLabel, '监听事件列表', '事件', '技能', target, 'skills', row.uid);
    checkPairs(issues, row.parameters, '参数赋值列表', (key) => `：「${key}」`, '技能', target, 'skills', row.uid);
  }

  /* 角色预设 */
  for (const found of duplicates(battle.characters.map((row) => row.id))) {
    const row = battle.characters[found.index];
    issues.push(
      issue('error', 'battle-duplicate-id', '角色预设', `角色 ID「${found.name}」有 ${found.count} 条，导入时会互相覆盖`, found.name, 'characters', row.uid),
    );
  }
  for (const row of battle.characters) {
    const target = row.id.trim() === '' ? row.name.trim() : row.id.trim();
    if (row.id.trim() === '') {
      issues.push(issue('error', 'battle-empty-id', '角色预设', '这一条还没有角色 ID，导入时无法命名', target === '' ? '(空)' : target, 'characters', row.uid));
    }
    if (row.name.trim() === '') {
      issues.push(issue('warning', 'battle-empty-name', '角色预设', '还没填角色名', target, 'characters', row.uid));
    }
    // 属性列表的下拉本来就只列属性表里的行，这里再挡一次手改过的数据
    for (const pair of row.attributes) {
      const key = pair.key.trim();
      if (key !== '' && resolveAttribute(battle, key) === undefined) {
        issues.push(
          issue('error', 'battle-unknown-attribute', '角色预设', `属性列表引用了属性表里没有的属性${attributeLabel(key)}`, target, 'characters', row.uid),
        );
      }
    }
    checkPairs(issues, row.attributes, '属性列表', attributeLabel, '角色预设', target, 'characters', row.uid);
    checkRefs(issues, row.skillUids, (ref) => resolveSkill(battle, ref), skillLabel, '技能列表', '技能', '角色预设', target, 'characters', row.uid);
  }

  /* 武器 */
  for (const found of duplicates(battle.weapons.map((row) => row.id))) {
    const row = battle.weapons[found.index];
    issues.push(
      issue('error', 'battle-duplicate-id', '武器', `武器 ID「${found.name}」有 ${found.count} 条，导入时会互相覆盖`, found.name, 'weapons', row.uid),
    );
  }
  for (const row of battle.weapons) {
    const target = row.id.trim() === '' ? row.name.trim() : row.id.trim();
    if (row.id.trim() === '') {
      issues.push(issue('error', 'battle-empty-id', '武器', '这一条还没有武器 ID，导入时无法命名', target === '' ? '(空)' : target, 'weapons', row.uid));
    }
    checkNumber(issues, row.magazine, '弹匣容量', '武器', target, 'weapons', row.uid);
    checkNumber(issues, row.attackSpeed, '攻击速度', '武器', target, 'weapons', row.uid);
    checkModifiers(issues, row.modifiers, battle, '武器', target, 'weapons', row.uid);
    checkRefs(issues, row.skillUids, (ref) => resolveSkill(battle, ref), skillLabel, '技能列表', '技能', '武器', target, 'weapons', row.uid);
  }

  return {
    issues,
    errors: issues.filter((item) => item.level === 'error').length,
    warnings: issues.filter((item) => item.level === 'warning').length,
  };
}

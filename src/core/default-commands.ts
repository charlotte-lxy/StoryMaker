/**
 * 默认指令字典，整理自 tb-gal.xlsx 的【条件指令汇总】。
 *
 * 每条指令 = 主指令 + 分支 + 参数列表：`剧情.演出# 角色.表情=悲伤` 这种老写法
 * 现在拆成「剧情 / 演出」一条，动作全部变成参数。
 * 「条件」用于选项的出现/可用条件，「指令」用于对话行的指令栏。
 *
 * 迁移老项目时也拿它当目标：老项目里那份默认字典会按主指令 + 分支换成这里的条目。
 */

import { newUid } from './ids';
import type { CommandDef, CommandParamDef, ParamSource } from './types';

function param(
  name: string,
  source: ParamSource,
  options: string[] = [],
  required = true,
  note = '',
): CommandParamDef {
  return { uid: newUid(), name, source, options, required, note };
}

function def(
  category: '条件' | '指令',
  head: string,
  branch: string,
  note: string,
  params: CommandParamDef[],
): CommandDef {
  return { uid: newUid(), category, head, branch, params, note };
}

const ITEM = (): CommandParamDef => param('物品', 'item', [], true, '物品表里的那一行');
const COUNT = (): CommandParamDef => param('数量', 'number', [], true, '填数字');
const TASK = (): CommandParamDef => param('任务', 'quest', [], true, '任务表里的那一行');

export function defaultCommandDefs(): CommandDef[] {
  return [
    // ---- 条件 ----
    def('条件', '背包', '', '物品数量判断', [
      ITEM(),
      param('运算符', 'fixed', ['>=', '<=', '==', '>', '<'], true, '比大还是比小'),
      COUNT(),
    ]),
    def('条件', '任务', '', '任务完成判断：结果填 1 表示完成、0 表示未完成', [
      TASK(),
      param('运算符', 'fixed', ['='], true, '固定是等号'),
      param('结果', 'number', [], true, '1 = 完成，0 = 未完成'),
    ]),
    def('条件', '剧情', '', '对话完成判断：结果填 1 表示完成、0 表示未完成', [
      param('对话', 'line', [], true, '对话表里的那一句'),
      param('运算符', 'fixed', ['='], true, '固定是等号'),
      param('结果', 'number', [], true, '1 = 完成，0 = 未完成'),
    ]),
    def('条件', '特殊', '', '正常表达式判断不了的条件，需和程序提前沟通', [
      param('特殊条件', 'text', [], true, '程序那边约定的条件名'),
      param('运算符', 'fixed', ['='], true, '固定是等号'),
      param('结果', 'number', [], true, '1 = 成立，0 = 不成立'),
    ]),

    // ---- 指令 ----
    def('指令', '剧情', '演出', '角色需先进入后才能操作表情与动作；只填用得到的那几项', [
      param('角色', 'character', [], true, '要操作哪个角色'),
      param('立绘位移', 'fixed', ['进入', '退出'], false, '让角色上场 / 下场'),
      param('表情', 'expression', [], false, '表情清单在角色表里配置'),
      param('动作', 'action', [], false, '动作清单在角色表里配置'),
    ]),
    def('指令', '剧情', '图片', '展示图片；不填图片就是清掉当前图片', [
      param('图片', 'image', [], false, '立绘表里的那一行'),
    ]),
    def('指令', '剧情', 'CG', '播放 CG；不填 CG 就是停止播放', [
      param('CG', 'text', [], false, 'CG 的 ID，如 CG_Test_01'),
    ]),
    def('指令', '剧情', '播放对话', '直接跳去播另一段对话', [
      param('对话', 'line', [], true, '要跳过去的对话'),
    ]),
    def('指令', '剧情', '音效', '播放音效', [param('音效', 'sound', [], true, '音效表里的那一行')]),
    def('指令', '背包', '', '改物品数量：运算符 + 增加、- 减少、= 直接设置', [
      ITEM(),
      param('运算符', 'fixed', ['+', '-', '='], true, '加 / 减 / 直接设置'),
      COUNT(),
    ]),
    def('指令', '任务', '接取', '接取任务', [TASK()]),
    def('指令', '地图', '进入', '进入地图', [
      param('地图', 'text', [], true, '地图 ID，如 Map_Room_001'),
    ]),
    def('指令', '地图', '时间', '改游戏内时间：运算符 + 增加、= 设置', [
      param('运算符', 'fixed', ['+', '='], true, '加 / 直接设置'),
      param('小时', 'number', [], true, '填小时数'),
    ]),
    def('指令', '地图', '天数', '改游戏内天数：运算符 + 增加、= 设置', [
      param('运算符', 'fixed', ['+', '='], true, '加 / 直接设置'),
      param('天数', 'number', [], true, '填天数'),
    ]),
    // 「其他」是兜底主指令：特殊演出效果、延时这类由脚本块现拼的指令都挂在这里
    def('指令', '其他', '特殊', '正常表达式写不出来的指令（特殊演出效果），需和程序提前沟通', [
      param('特殊指令ID', 'text', [], true, '程序那边约定的指令名，如 SP_001'),
    ]),
    def('指令', '其他', '延时', '等这么多秒再继续往下播', [
      param('时长', 'number', [], true, '秒数，可以带小数，比如 0.5'),
    ]),
  ];
}

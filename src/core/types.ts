/**
 * StoryMaker 核心数据模型
 *
 * 两个 ID 的分工（重要）：
 *   uid        - 内部稳定主键，所有引用都指向它，永不改变
 *   readableId - 导出用的可读 ID，如 Dia_ch01_001-1，可在导出前重排
 *
 * 这样插入/删除行不会打断跳转引用，也不会让本地化 key 错位。
 */

/**
 * 脚本行的类型。
 *
 * 三种类型在段落里各占一行，顺序就是执行顺序：
 *   对话 - 一个角色说一句台词
 *   选项 - 弹出一个选项框，玩家选完跳去别的对话
 *   指令 - 改游戏数据或播演出效果
 */
export type LineKind = '对话' | '选项' | '指令';

/** 语言键，与本地化表的列顺序一致 */
export type LangKey = 'zh' | 'en' | 'ja';

export type LocalizedText = Record<LangKey, string>;

/** 段落里的一行。只有「对话」行会用到文本与角色，其余字段各归其类型。 */
export interface Line {
  uid: string;
  readableId: string;
  kind: LineKind;
  /** 角色 ID，如 CHA_伊芙；只有「对话」行使用 */
  characterId: string;
  /** 角色显示名称，可覆盖角色本名（如未识别身份时显示 unknown｛声纹识别中…｝）；只有「对话」行使用 */
  displayName: string;
  /** 台词（中英日）；只有「对话」行使用 */
  text: LocalizedText;
  /** 强制自动播放下一对话；只有「对话」行使用 */
  autoAdvance: boolean;
  /** 一条演出指令，如「剧情.人物# CHA_Q版伊芙.差分 = 挥手」；只有「指令」行使用，一行一条 */
  command: string;
  /** 本行挂着的选项 ID 列表；只有「选项」行使用 */
  optionIds: string[];
  /** 备注，只给自己看，不导出 */
  note: string;
}

/** 一个选项。已从对话表中独立出来，跳转目标也在这里。 */
export interface StoryOption {
  uid: string;
  readableId: string;
  text: LocalizedText;
  /** 跳转目标对话 ID */
  nextId: string;
  /**
   * 出现条件：是否显示该选项。内容是条件文本，如「背包#Item_Coin>=10」。
   * 和指令一样按条目填写，只是可选范围限定为字典里的「条件」。
   */
  appearConditions: string[];
  /** 可用条件：显示但置灰不可选 */
  enableConditions: string[];
  /**
   * 结果列表：选中该选项后执行的指令。
   * 它和对话行的「指令」是同一种东西，因此也走指令字典的下拉。
   */
  results: string[];
}

/** 段落，对应可读 ID 中的组号，如 001 */
export interface Group {
  uid: string;
  /** 组号，如 "001" */
  id: string;
  title: string;
  /** 段落注释，只在流程图里显示，不导出 */
  note: string;
  lines: Line[];
  options: StoryOption[];
}

/** 章节，对应可读 ID 中的章节段，如 ch01 */
export interface Chapter {
  uid: string;
  /** 章节标识，如 "ch01" */
  id: string;
  title: string;
  groups: Group[];
}

/**
 * 变量声明。后期「模块 → 物品」表单选择的数据源。
 * 目前只留数据结构，不做增删改查界面。
 */
export interface VariableDecl {
  /** 模块名，如「背包」 */
  module: string;
  /** 物品 ID，如 Item_Coin */
  targetId: string;
  /** 显示名，如「金币」 */
  label: string;
}

/** 角色表中的一条角色 */
export interface Character {
  uid: string;
  /** 角色 ID，以 CHA_ 开头。导出时写入对话表的「角色ID」列。 */
  id: string;
  /** 默认名称。只在编辑界面的下拉框里显示，不直接参与导出。 */
  name: string;
  /**
   * 该角色的表情差分清单，供指令「剧情.演出# 角色.表情=」的下拉使用。
   * 不同角色的差分可以不同，所以挂在角色上而不是做成全局清单。
   */
  expressions: string[];
  /** 该角色的动作清单，供指令「剧情.演出# 角色.动作=」的下拉使用 */
  actions: string[];
}

/**
 * 数据表里的一行：一个 ID 加一句说明。
 * 物品、任务、立绘、音效都用这个结构，界面也可以共用一个组件。
 */
export interface LookupRow {
  uid: string;
  /** 导出时写进指令的 ID，如 Item_Coin、Task_Test_01、SCE_Home_001、S_dididi */
  id: string;
  /** 说明文字，只在界面下拉里显示 */
  name: string;
}

/** 指令的目标对象可以来自哪张表 */
export type TargetKind =
  | 'character'
  | 'item'
  | 'quest'
  | 'image'
  | 'sound'
  | 'line'
  | 'manual'
  | 'none';

/** 指令的结果怎么填 */
export type ValueKind =
  | 'expression'
  | 'action'
  | 'number'
  | 'fixed'
  | 'none';

/** 一条指令定义，驱动指令编辑时的逐级下拉 */
export interface CommandDef {
  uid: string;
  /** 属于条件还是指令 */
  category: '条件' | '指令';
  /** 主指令，如「剧情.演出」「背包」「特殊」 */
  head: string;
  /** 分支，无分支时为空 */
  branch: string;
  /** 目标对象来源 */
  target: TargetKind;
  /** 目标属性，无属性时为空，如「表情」 */
  attribute: string;
  /** 运算符，无运算符时为空，如「=」 */
  operator: string;
  /** 结果来源 */
  value: ValueKind;
  /** 结果为固定选项时的候选值 */
  fixedValues: string[];
  note: string;
}

export interface Project {
  version: 1;
  name: string;
  characters: Character[];
  /** 数据表：物品、任务、立绘、音效 */
  items: LookupRow[];
  quests: LookupRow[];
  images: LookupRow[];
  sounds: LookupRow[];
  /** 指令字典 */
  commands: CommandDef[];
  chapters: Chapter[];
  /** 变量声明，暂未实装界面 */
  variables: VariableDecl[];
}

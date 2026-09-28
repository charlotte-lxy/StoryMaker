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

/**
 * UI 本地化表里的一行：界面文案的 key 加三语文本，如
 * TXT_Widget_开始游戏 = 开始游戏 / Start Game / ゲーム開始。
 *
 * 与对话、选项的文本不同，这些条目不是从剧本里收上来的，得在界面上自己维护。
 */
export interface UiTextRow {
  uid: string;
  /** 本地化 key，由程序定，如 TXT_Widget_开始游戏 */
  key: string;
  text: LocalizedText;
}

/**
 * GAS 修改器：持续类型 # 属性名 运算符 值，如「基础#生命值-Damage」。
 *
 *   基础 - 瞬时修改基础值，受层数影响
 *   临时 - 持续修改临时值，受层数影响
 *   固定 - 持续修改临时值，不受层数影响
 */
export interface GasModifier {
  uid: string;
  /** 持续类型：基础 / 临时 / 固定 */
  duration: string;
  /** 属性名，从属性表里选 */
  attribute: string;
  /** 运算符：+ - * / = */
  operator: string;
  /** GA 参数名或固定值，如 Damage、40 */
  value: string;
}

/** 键值对：技能的参数赋值、角色预设的属性数值都用它 */
export interface GasPair {
  uid: string;
  key: string;
  value: string;
}

/**
 * 带 GameplayTag 的一张表（属性 / 事件）。
 *
 * note      - 这张表自己的备注
 * tagNote   - GameplayTags 表里那一栏备注，导出成 DevComment（两边互相独立）
 */
export interface GasAttribute {
  uid: string;
  /** 属性名，合成 Tag：GAS.属性.<属性名> */
  name: string;
  note: string;
  tagNote: string;
}

export interface GasEvent {
  uid: string;
  /** 事件名，合成 Tag：GAS.事件.<事件名> */
  name: string;
  note: string;
  tagNote: string;
}

/** 效果（GE） */
export interface GasEffect {
  uid: string;
  /** 效果名，合成 Tag：GAS.效果.<效果名> */
  name: string;
  /** 效果描述，导出到「备注」列 */
  note: string;
  /** 类名，如 BP_GameEffect_Base，导出时补成 GE类 全路径 */
  className: string;
  /** 总时长：空=瞬时，-1=无限，其它为秒 */
  duration: string;
  /** 周期-时长，0 表示不周期触发 */
  period: string;
  /** 周期-首次立即触发 */
  periodImmediate: boolean;
  /** 触发-减少层数 */
  reduceStacks: string;
  /** 堆叠-最大层数 */
  maxStacks: string;
  /** 堆叠-获得层数时刷新总时长 */
  refreshDuration: boolean;
  /** 堆叠-获得层数时刷新周期时长 */
  refreshPeriod: boolean;
  /** 修改器列表 */
  modifiers: GasModifier[];
  tagNote: string;
}

/** 技能（GA） */
export interface GasSkill {
  uid: string;
  /** 技能名，合成 Tag：GAS.技能.<技能名> */
  name: string;
  /** 类名，如 BP_GA_Heal，导出时补成 GA类 全路径 */
  className: string;
  /** 锁定 GA 列表：技能名 */
  lockSkills: string[];
  /** 监听事件列表：事件名 */
  listenEvents: string[];
  /** 参数赋值列表 */
  parameters: GasPair[];
  tagNote: string;
}

/** 角色预设：GAS 的属性与技能配置，导出成 GAS角色 */
export interface GasCharacter {
  uid: string;
  /** 角色 ID，如 CHA_测试主角 */
  id: string;
  name: string;
  /** 属性列表：属性名下挂数值 */
  attributes: GasPair[];
  /** 技能列表：技能名 */
  skills: string[];
}

/** 武器，导出成 GAS武器 */
export interface GasWeapon {
  uid: string;
  /** 武器 ID，如 WEA_测试-手枪 */
  id: string;
  name: string;
  description: string;
  /** 弹匣容量，-1 表示无限 */
  magazine: string;
  attackSpeed: string;
  modifiers: GasModifier[];
  skills: string[];
}

/**
 * 战斗模块（GAS）的全部数据。
 *
 * 各种 Tag 都是由「模块前缀 + 名字」合成出来的，不单独存，
 * 这样改名不会留下旧 Tag；GameplayTags 表里的备注单独存在各表的 tagNote 上。
 */
export interface BattleData {
  /** 技能类名的路径前缀，导出 GA类 用；换项目不用改代码 */
  skillClassPrefix: string;
  /** 效果类名的路径前缀，导出 GE类 用 */
  effectClassPrefix: string;
  attributes: GasAttribute[];
  effects: GasEffect[];
  skills: GasSkill[];
  events: GasEvent[];
  characters: GasCharacter[];
  weapons: GasWeapon[];
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
  /** UI 本地化表：界面文案，导出时接在本地化表的对话 / 选项文本后面 */
  uiTexts: UiTextRow[];
  /** 战斗模块（GAS）的数据，导出成 GAS 开头的几张子表 */
  battle: BattleData;
}

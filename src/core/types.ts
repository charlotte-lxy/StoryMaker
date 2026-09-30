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
  /** 角色表那一行的 **uid**；只有「对话」行使用。 */
  characterUid: string;
  /**
   * 这一行要显示的**别名** uid（'' = 用角色的默认名称）；只有「对话」行使用。
   *
   * 老数据里这里是自由文本（显示名），迁移时会收进角色表的别名里；
   * 收不进去的（比如没选角色）原样留着，由校验条报出来。
   */
  displayAliasUid: string;
  /** 台词（中英日）；只有「对话」行使用 */
  text: LocalizedText;
  /** 强制自动播放下一对话；只有「对话」行使用 */
  autoAdvance: boolean;
  /** 一条演出指令，如「剧情.人物# CHA_Q版伊芙.差分 = 挥手」；只有「指令」行使用，一行一条 */
  command: string;
  /**
   * 「跳转到段落」行专用的段落引用（其它行是 null）。
   *
   * 存的是段落 uid，导出时现拼成「剧情.播放对话# <该段落第一句的对话ID>」，
   * 这样段落里插行、拖拽、删行之后跳转自动跟着新的第一句走。
   * 空串表示"是跳转行，但还没选段落"。
   */
  jumpGroupUid: string | null;
  /**
   * 「跳转到段落」行的可用条件：全部满足才跳（只有 jumpGroupUid 不为 null 时才有意义）。
   * 与选项的可用条件同一种东西，导出到对话表的「可用条件列表」列。
   */
  jumpConditions: string[];
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

/**
 * 角色对话的「播放位置」：这一句台词在哪儿显示。
 *
 * 存的就是中文选项名——导出时直接写进单元格，Unreal 那边认这三个串。
 */
export const PLAY_POSITIONS = ['剧情对话框', '战斗对话框', '屏幕中间'] as const;

export type PlayPosition = (typeof PLAY_POSITIONS)[number];

/** 新建角色时的默认播放位置 */
export const DEFAULT_PLAY_POSITION: PlayPosition = '剧情对话框';

/**
 * 角色的一个别名（「显示名称」里除默认名称之外的那些写法）。
 *
 * 别名带 uid：对话行选中的是它，所以改别名文字不会让对话行断。
 * 英文日文挂在别名自己身上（中文就是 text）。
 */
export interface CharacterAlias {
  uid: string;
  /** 别名文字，如 unknown、HUD */
  text: string;
  en: string;
  ja: string;
}

/** 角色表中的一条角色 */
export interface Character {
  uid: string;
  /** 角色 ID，以 CHA_ 开头。导出时写入对话表的「角色ID」列。 */
  id: string;
  /** 「显示名称」里的默认名称（中文）。界面上的下拉框显示的就是它。 */
  name: string;
  /** 默认名称的英文 */
  nameEn: string;
  /** 默认名称的日文 */
  nameJa: string;
  /** 播放位置：剧情对话框 / 战斗对话框 / 屏幕中间 */
  playPosition: PlayPosition;
  /** 别名列表：同一角色的其他显示名（如「unknown」「HUD」） */
  aliases: CharacterAlias[];
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
  /** 属性表那一行的 uid，导出时按它取属性名再合成 Tag */
  attributeUid: string;
  /** 运算符：+ - * / = */
  operator: string;
  /** GA 参数名或固定值，如 Damage、40 */
  value: string;
}

/**
 * 键值对：技能的参数赋值、角色预设的属性数值都用它。
 *
 * `key` 的含义看它挂在哪儿：
 *   - 技能「参数赋值列表」：手填的参数名（不是引用，导出原样写出）
 *   - 角色预设「属性列表」：属性表那一行的 **uid**（改属性名也不会断）
 */
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
  /** 锁定 GA 列表：技能表那一行的 uid，导出成技能 Tag */
  lockSkillUids: string[];
  /** 监听事件列表：事件表那一行的 uid，导出成事件 Tag */
  listenEventUids: string[];
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
  /**
   * 属性列表：键值对里的 key 是**属性表那一行的 uid**（改属性名也不会断），
   * 值就是这一行要填的数值。
   */
  attributes: GasPair[];
  /** 技能列表：技能表那一行的 uid */
  skillUids: string[];
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
  /** 技能列表：技能表那一行的 uid */
  skillUids: string[];
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

/**
 * Unreal 导入设置里的一行：一张 DataTable 注册到哪、内容来自我们的哪个子表。
 *
 *   数据表引用   = /Script/Engine.DataTable'/Game/<文件夹>/<表名>.<表名>'
 *   csv 文件名   = TB_BSGame_<子表名>.csv
 * 这两列都由前三个字段推出来，和策划原来 Excel 里的公式列一样，不单独存。
 */
export interface ExportSettingRow {
  uid: string;
  /** 数据表名，如 TB_GAS_Ability，导出时也是行名 */
  tableName: string;
  /** 数据表文件夹路径，如 GameContent/BP/GAS/GA */
  folder: string;
  /** 内容来自哪个子表，如「技能」 */
  subTable: string;
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
  /** Unreal 导入设置，导出成「导入设置」子表 */
  exportSettings: ExportSettingRow[];
}

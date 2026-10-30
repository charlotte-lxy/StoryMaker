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
  /**
   * 一条指令，格式是「主指令|分支|参数名:值;参数名:值」，如 `剧情|演出|角色:CHA_x;表情:悲伤`。
   * 只有「指令」行使用，一行一条。
   */
  command: string;
  /**
   * 「特殊演出效果」行（脚本块里那一种）的指令内容：只给自己看，不导出。
   *
   * 这一栏**不参与指令拼装**——这一行的指令就是 `特殊||特殊指令:<特殊指令名称>`
   * （名称存在 command 里）。
   * null 表示这一行不是「特殊演出效果」（普通「指令」行也是 null）；空串表示是，但还没填内容。
   */
  specialContent: string | null;
  /**
   * 「跳转到段落」行专用的段落引用（其它行是 null）。
   *
   * 存的是段落 uid，导出时现拼成「剧情|播放对话|对话:<该段落第一句的对话ID>」，
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
   * 出现条件：是否显示该选项。内容是条件文本，如「背包||物品:Item_Coin;运算符:>=;数量:10」。
   * 和指令一样按条目填写，只是可选范围限定为字典里的「条件」。
   */
  appearConditions: string[];
  /** 可用条件：显示但置灰不可选 */
  enableConditions: string[];
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
 * 位置可以在角色页顶部那张小表里增删改；角色行存的是它的 uid，
 * 所以改位置名不会把角色写坏。导出时把 uid 翻回名字写进「角色」子表。
 */
export interface PlayPositionRow {
  uid: string;
  /** 位置名，如「剧情对话框」 */
  name: string;
}

/** 新建项目时预置的三个播放位置（和以前写死的三个一样，Unreal 那边认这几个串） */
export const DEFAULT_PLAY_POSITION_NAMES = ['剧情对话框', '战斗对话框', '屏幕中间'] as const;

/**
 * 表情差分配置（全局一张表）。
 *
 * 角色行里勾选自己有哪些表情差分（存表情名）；
 * `id` 是图片 ID 里「-」后面那一段：图片 ID = `PIC_<角色ID>-<id>`，
 * 所以「微笑」的 id 默认也叫「微笑」，想用英文（smile）就在这里改。
 */
export interface ExpressionRow {
  uid: string;
  /** 表情名，如「微笑」；角色行与指令「剧情|演出|…;表情:」里写的就是它 */
  name: string;
  /** 图片 ID 里那一段标识；空着就用表情名 */
  id: string;
}

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
  /** 播放位置：存 PlayPositionRow 的 uid（改位置名不会断），导出时翻回名字 */
  playPosition: string;
  /** 别名列表：同一角色的其他显示名（如「unknown」「HUD」） */
  aliases: CharacterAlias[];
  /**
   * 该角色有哪些表情差分（存表达式名，如「微笑」），从全局表情表里勾选。
   * 供指令「剧情|演出|…;表情:」这个参数的下拉使用，也用来收集立绘里的表情图片。
   */
  expressions: string[];
  /** 该角色的动作清单，供指令「剧情|演出|…;动作:」这个参数的下拉使用 */
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
  /** 说明文字，只在界面下拉里显示（立绘表里这一格同时是「备注」列） */
  name: string;
  /**
   * 资源分类（立绘的「图片分类」、音效的「音效类型」，存 AssetCategoryRow 的 uid）。
   *
   * 存 uid 而不是分类名：分类改名之后这一行仍然指着它。
   * 物品 / 任务表不用这个字段（空串 / 不写）。
   */
  categoryUid?: string;
}

/**
 * 资源分类：立绘的「图片分类」与音效的「音效类型」都用这一套。
 *
 * 导出图片 / 音频子表时按分类拼资源路径：`<存储路径>/<ID>.<ID>`，
 * 外面再包一层 `/Script/Engine.Texture2D'…'` 或 `/Script/Engine.SoundWave'…'`。
 * 资源行存的是这里的 uid，所以改分类名不会把引用写坏。
 */
export interface AssetCategoryRow {
  uid: string;
  /** 分类名，如「对话背景」「背景音乐」；导出到「图片分类」「音效类型」列 */
  name: string;
  /** 这一类资源在 Unreal 里的文件夹，如 /Game/GameContent/Asset/Image/StoryBackground */
  path: string;
  /**
   * 系统保留的分类：现在只有表情图片用的「角色立绘」。
   *
   * 名字和路径都能改，靠这个标记认出来——改完名表情图片仍然挂在它下面。
   */
  system?: 'expressionImages';
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

/**
 * 参数的值从哪儿来。
 *
 * 前 6 个是各张表里的行（存 uid，导出时才翻成可读 ID）；
 * 「该角色表情 / 该角色动作」取同一条指令里「角色表」那个参数所选角色的清单；
 * 手填数字 / 手填文本是自由输入；固定选项是字典里自己填的候选值。
 */
export type ParamSource =
  | 'character'
  | 'item'
  | 'quest'
  | 'image'
  | 'sound'
  | 'line'
  | 'expression'
  | 'action'
  | 'number'
  | 'text'
  | 'fixed';

/** 一条指令（或条件）的一个参数 */
export interface CommandParamDef {
  uid: string;
  /**
   * 参数名，策划自己填的中文，如「角色」「运算符」「数量」。
   *
   * 它同时是导出文本里的键（`运算符:+`），改了它老数据的值就对不上了，
   * 所以上表之后不要再改名。
   */
  name: string;
  /** 值来源 */
  source: ParamSource;
  /** 固定选项的候选值（只有 source === 'fixed' 时用） */
  options: string[];
  /** 必填：没填时校验报错；非必填可以不填（导出文本里整项省略） */
  required: boolean;
  /** 参数说明，只在界面上显示 */
  note: string;
}

/**
 * 一条指令定义，驱动指令编辑时的逐级下拉。
 *
 * 指令文本的格式是「主指令|分支|参数名:值;参数名:值」，
 * 主指令 + 分支唯一确定一条定义；这条定义再决定参数有几个、每个怎么填。
 */
export interface CommandDef {
  uid: string;
  /** 属于条件还是指令 */
  category: '条件' | '指令';
  /** 主指令，如「剧情」「背包」「特殊」 */
  head: string;
  /** 分支，无分支时为空，如「演出」「接取」 */
  branch: string;
  /** 参数列表：界面按这个顺序从左到右摆控件 */
  params: CommandParamDef[];
  /** 指令说明，只在界面上显示 */
  note: string;
}

export interface Project {
  version: 1;
  name: string;
  characters: Character[];
  /** 播放位置配置（角色行用 uid 指着这里的某一条） */
  playPositions: PlayPositionRow[];
  /** 表情差分配置（全局一张表；角色行勾选自己有哪些） */
  expressions: ExpressionRow[];
  /** 数据表：物品、任务、立绘、音效 */
  items: LookupRow[];
  quests: LookupRow[];
  images: LookupRow[];
  sounds: LookupRow[];
  /** 立绘的图片分类（图片行用 categoryUid 指着这里的某一条） */
  imageCategories: AssetCategoryRow[];
  /** 音效的音效类型（音效行用 categoryUid 指着这里的某一条） */
  soundCategories: AssetCategoryRow[];
  /** 指令字典 */
  commands: CommandDef[];
  chapters: Chapter[];
  /** 变量声明，暂未实装界面 */
  variables: VariableDecl[];
  /** UI 本地化表：界面文案，导出时接在本地化表的对话 / 选项文本后面 */
  uiTexts: UiTextRow[];
  /** 战斗模块（GAS）的数据，导出成 GAS 开头的几张子表 */
  battle: BattleData;
  /**
   * 「特殊指令」子表里 Command类 的路径前缀。
   *
   * Command类 = 前缀 + `BP_Command_<行名>.BP_Command_<行名>_C'`，
   * 跟战斗模块的 GA类 / GE类 前缀一个套路；换项目时在「Unreal导入设置」里改。
   */
  specialCommandClassPrefix: string;
  /**
   * 界面配置，跟着项目文件走：换台机器、换个浏览器打开，看到的还是同样的界面。
   *
   * 老项目里没有这一栏（缺省 = 用本机设置）。
   */
  ui?: ProjectUi;
  /** Unreal 导入设置，导出成「导入设置」子表 */
  exportSettings: ExportSettingRow[];
}

/** 界面主题 */
export type ThemeName = 'light' | 'dark';

/**
 * 存在项目文件里的界面配置。
 *
 * 现在只有主题；以后要记别的界面状态（比如分栏比例）也往这里加。
 */
export interface ProjectUi {
  /** 主题；空串表示还没记录过（打开时用本机设置） */
  theme: ThemeName | '';
}

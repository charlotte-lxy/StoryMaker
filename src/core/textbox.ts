import { newUid } from './ids';
import type {
  AnchorCell,
  Rect,
  TextBoxAlign,
  TextBoxControl,
  TextBoxControlKind,
  TextBoxPortraitLayout,
  TextBoxPortraitMode,
  TextBoxPortraitPreview,
  TextBoxReveal,
  TextBoxRow,
  TextBoxTextContent,
  TextBoxVerticalAlign,
} from './types';

/** 排版用的设计稿尺寸：界面缩放时整块画布按比例缩，位置和尺寸都按这个尺寸算 */
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

/** 新建文本框的默认位置：贴在画面下方、横向占满 */
export const DEFAULT_TEXT_BOX_RECT: Rect = { x: 0.05, y: 0.66, w: 0.9, h: 0.28 };

/** 文本框里人物名称 / 台词相对外框的默认位置（新建时换算成画布坐标） */
const DEFAULT_NAME_RECT: Rect = { x: 0.02, y: 0.04, w: 0.96, h: 0.2 };
const DEFAULT_TEXT_RECT: Rect = { x: 0.02, y: 0.28, w: 0.96, h: 0.68 };

/** 拖动缩放时框的最小边长（相对画面） */
export const MIN_RECT_SIDE = 0.02;
/** 允许控件拖到画布外面，但别拖到天边：左上角夹在这个范围内（相对画面） */
export const MIN_RECT_OFFSET = -1;
export const MAX_RECT_OFFSET = 2;
/** 宽高最大给到两倍画面，够做整屏背景和出血 */
export const MAX_RECT_SIDE = 2;

export const DEFAULT_ANCHOR: AnchorCell = { col: 0, row: 0 };

export const TEXT_BOX_ALIGNS = ['left', 'center', 'right'] as const;

/** 文字在控件里的垂直对齐 */
export const TEXT_BOX_VERTICAL_ALIGNS = ['top', 'middle', 'bottom'] as const;
export const TEXT_BOX_VERTICAL_ALIGN_LABELS: Record<TextBoxVerticalAlign, string> = {
  top: '上对齐',
  middle: '居中',
  bottom: '下对齐',
};

/** 多张立绘怎么摆 */
export const TEXT_BOX_PORTRAIT_LAYOUTS = ['fill', 'pack'] as const;
export const TEXT_BOX_PORTRAIT_LAYOUT_LABELS: Record<TextBoxPortraitLayout, string> = {
  fill: '控件填充（平分宽度）',
  pack: '紧贴并排（按原比例）',
};

export const LINE_HEIGHT_MIN = 0.8;
export const LINE_HEIGHT_MAX = 3;

/** 对齐（UMG 的 Alignment）的默认值：控件中心落在位置上 */
export const DEFAULT_PIVOT = 0.5;

/** 字体样式：先给常用的三个，后面还会加 */
export const TEXT_BOX_FONTS = ['微软雅黑', '黑体', '宋体'] as const;

export const DEFAULT_FONT_FAMILY = '微软雅黑';
export const DEFAULT_COLOR = '#FFFFFF';

/** 出现效果：立即 / 淡入淡出 / 逐字 */
export const TEXT_BOX_REVEALS = ['instant', 'fade', 'typewriter'] as const;
export const DEFAULT_FADE_IN = 0.3;
export const DEFAULT_FADE_OUT = 0.2;
export const DEFAULT_TYPE_SPEED = 30;
export const DEFAULT_PUNCTUATION_PAUSE = 0.15;
export const FADE_MAX = 5;
export const TYPE_SPEED_MIN = 1;
export const TYPE_SPEED_MAX = 200;
export const PUNCTUATION_PAUSE_MAX = 3;
/** 逐字时遇到这些标点多停一下 */
export const REVEAL_PUNCTUATION = '，。！？；：、…—,.!?;:';

/** 文本框层级默认 0：数字大的画在上层 */
export const DEFAULT_LAYER = 0;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 把相对外框的矩形换算成画布坐标（老项目迁移用） */
export function composeRect(box: Rect, inner: Rect): Rect {
  return {
    x: box.x + inner.x * box.w,
    y: box.y + inner.y * box.h,
    w: inner.w * box.w,
    h: inner.h * box.h,
  };
}

/** 文本框 ID 的前缀：导出的行名，角色表「文本框」列也写它 */
export const TEXT_BOX_ID_PREFIX = 'TB_';

/** 生成一个还没被用掉的文本框 ID（TB_1、TB_2…） */
export function nextTextBoxId(rows: readonly { id: string }[]): string {
  const taken = new Set(rows.map((row) => row.id.trim()));
  let n = 1;
  while (taken.has(`${TEXT_BOX_ID_PREFIX}${n}`)) n += 1;
  return `${TEXT_BOX_ID_PREFIX}${n}`;
}

/** 控件类型（「添加控件」里能选的三种） */
export const TEXT_BOX_CONTROL_KINDS = ['image', 'text', 'portrait'] as const;
export const TEXT_BOX_CONTROL_LABELS: Record<TextBoxControlKind, string> = {
  image: '图片',
  text: '文本',
  portrait: '立绘弹窗',
};

/** 文本控件显示什么 */
export const TEXT_BOX_CONTENTS = ['speaker', 'line'] as const;
export const TEXT_BOX_CONTENT_LABELS: Record<TextBoxTextContent, string> = {
  speaker: '说话人名字',
  line: '台词',
};

/** 立绘弹窗：单张 / 多张 */
export const TEXT_BOX_PORTRAIT_MODES = ['single', 'multi'] as const;
export const TEXT_BOX_PORTRAIT_MODE_LABELS: Record<TextBoxPortraitMode, string> = {
  single: '仅展示单张',
  multi: '多张同时展示',
};

/** 一个控件的默认值：三种控件共用这一套，各类型再覆盖自己那几项 */
export function createControlBase(
  rect: Rect,
  kind: TextBoxControlKind,
  name: string,
): TextBoxControl {
  return {
    uid: newUid(),
    kind,
    name,
    anchor: { ...DEFAULT_ANCHOR },
    rect: { ...rect },
    pivotX: DEFAULT_PIVOT,
    pivotY: DEFAULT_PIVOT,
    imageUid: '',
    content: 'line',
    fontFamily: '',
    fontSize: 0,
    color: '#000000',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.5,
    sampleText: '',
    reveal: 'instant',
    fadeIn: DEFAULT_FADE_IN,
    fadeOut: DEFAULT_FADE_OUT,
    typeSpeed: DEFAULT_TYPE_SPEED,
    punctuationPause: DEFAULT_PUNCTUATION_PAUSE,
    multiLine: false,
    portraitMode: 'single',
    portraitLayout: 'fill',
    portraitLimit: false,
    portraits: [],
  };
}

/** 新建一个图片控件 */
export function createImageControl(rect: Rect, name = '图片'): TextBoxControl {
  return createControlBase(rect, 'image', name);
}

/** 新建一个文字控件：默认微软雅黑、白色，字号与示例文本传进来 */
export function createTextControl(
  rect: Rect,
  content: TextBoxTextContent,
  fontSize: number,
  sampleText: string,
  name = '文本',
): TextBoxControl {
  return {
    ...createControlBase(rect, 'text', name),
    content,
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize,
    color: DEFAULT_COLOR,
    sampleText,
  };
}

/** 新建一个立绘弹窗控件：默认单张，先给一行空的预览角色 */
export function createPortraitControl(rect: Rect, name = '立绘弹窗'): TextBoxControl {
  return {
    ...createControlBase(rect, 'portrait', name),
    portraits: [{ characterUid: '', expression: '' }],
  };
}

/** 每种控件加进来时的默认位置：图片贴底部整条，文本在框里，立绘在画面中间 */
export function defaultRectFor(kind: TextBoxControlKind): Rect {
  if (kind === 'image') return { ...DEFAULT_TEXT_BOX_RECT };
  if (kind === 'text') return composeRect(DEFAULT_TEXT_BOX_RECT, DEFAULT_TEXT_RECT);
  return { x: 0.3, y: 0.08, w: 0.4, h: 0.84 };
}

/** 按类型新建一个控件 */
export function createControl(
  kind: TextBoxControlKind,
  rect: Rect,
  name: string,
): TextBoxControl {
  if (kind === 'image') return createImageControl(rect, name);
  if (kind === 'portrait') return createPortraitControl(rect, name);
  return createTextControl(rect, 'line', 42, '这是一段示例台词。', name);
}

/** 新控件的默认名字：同类型往后排（图片 1、文本 2…） */
export function nextControlName(
  controls: readonly TextBoxControl[],
  kind: TextBoxControlKind,
): string {
  const label = TEXT_BOX_CONTROL_LABELS[kind];
  const taken = new Set(controls.map((control) => control.name));
  let n = 1;
  while (taken.has(`${label} ${n}`)) n += 1;
  return `${label} ${n}`;
}

/** 新建一条文本框：默认摆一个背景图 + 人物名称 + 台词，名字可以传（列表里显示用） */
export function createDefaultTextBox(name = '文本框 1', id = 'TB_1'): TextBoxRow {
  const box = { ...DEFAULT_TEXT_BOX_RECT };
  return {
    uid: newUid(),
    id,
    name,
    layer: DEFAULT_LAYER,
    rectSpace: 'canvas',
    controls: [
      createImageControl(box, '背景图'),
      createTextControl(composeRect(box, DEFAULT_NAME_RECT), 'speaker', 40, '角色名', '人物名称'),
      createTextControl(
        composeRect(box, DEFAULT_TEXT_RECT),
        'line',
        42,
        '这是一段示例台词。',
        '台词',
      ),
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * 把一个矩形收进允许的范围（手改过的 JSON 可能越界）。
 * 宽高太小会让把手挤在一起，所以有一个最小边长；位置允许越出画布。
 */
export function clampRect(raw: unknown, fallback: Rect): Rect {
  const record = isRecord(raw) ? raw : {};
  const w = clamp(asNumber(record.w, fallback.w), MIN_RECT_SIDE, MAX_RECT_SIDE);
  const h = clamp(asNumber(record.h, fallback.h), MIN_RECT_SIDE, MAX_RECT_SIDE);
  const x = clamp(asNumber(record.x, fallback.x), MIN_RECT_OFFSET, MAX_RECT_OFFSET);
  const y = clamp(asNumber(record.y, fallback.y), MIN_RECT_OFFSET, MAX_RECT_OFFSET);
  return { x, y, w, h };
}

/** 锚点选择器的 3 列 / 3 行参考线在画面上的比例：左 / 中 / 右（上 / 中 / 下） */
export function anchorFraction(index: number): number {
  return index === 1 ? 0.5 : index === 2 ? 1 : 0;
}

export function isStretchX(anchor: AnchorCell): boolean {
  return anchor.col === 3;
}

export function isStretchY(anchor: AnchorCell): boolean {
  return anchor.row === 3;
}

/**
 * 右侧面板上的三组数字（设计稿像素）。
 *
 * 不拉伸的锚点：`posX` / `posY` 是控件的对齐点相对锚点的偏移（对齐点由 pivot 决定），
 * `sizeX` / `sizeY` 是尺寸；拉伸的锚点：`posX` / `posY` 是左边距 / 上边距，
 * `sizeX` / `sizeY` 写负数表示右边距 / 下边距（跟 Unreal 的槽位一样）。
 */
export interface SlotValues {
  posX: number;
  posY: number;
  sizeX: number;
  sizeY: number;
}

/** 画布矩形 → 右侧面板数字 */
export function rectToSlot(
  rect: Rect,
  anchor: AnchorCell,
  pivotX = DEFAULT_PIVOT,
  pivotY = DEFAULT_PIVOT,
): SlotValues {
  const left = rect.x * CANVAS_WIDTH;
  const top = rect.y * CANVAS_HEIGHT;
  const width = rect.w * CANVAS_WIDTH;
  const height = rect.h * CANVAS_HEIGHT;
  return {
    posX: isStretchX(anchor)
      ? left
      : left - anchorFraction(anchor.col) * CANVAS_WIDTH + pivotX * width,
    posY: isStretchY(anchor)
      ? top
      : top - anchorFraction(anchor.row) * CANVAS_HEIGHT + pivotY * height,
    sizeX: isStretchX(anchor) ? -(CANVAS_WIDTH - left - width) : width,
    sizeY: isStretchY(anchor) ? -(CANVAS_HEIGHT - top - height) : height,
  };
}

/** 右侧面板数字 → 画布矩形（越界、反向都交给 clampRect 收） */
export function slotToRect(
  slot: SlotValues,
  anchor: AnchorCell,
  fallback: Rect,
  pivotX = DEFAULT_PIVOT,
  pivotY = DEFAULT_PIVOT,
): Rect {
  const stretchX = isStretchX(anchor);
  const stretchY = isStretchY(anchor);
  const width = stretchX
    ? CANVAS_WIDTH - slot.posX + slot.sizeX
    : slot.sizeX;
  const height = stretchY
    ? CANVAS_HEIGHT - slot.posY + slot.sizeY
    : slot.sizeY;
  const x = stretchX
    ? slot.posX / CANVAS_WIDTH
    : anchorFraction(anchor.col) + (slot.posX - pivotX * slot.sizeX) / CANVAS_WIDTH;
  const y = stretchY
    ? slot.posY / CANVAS_HEIGHT
    : anchorFraction(anchor.row) + (slot.posY - pivotY * slot.sizeY) / CANVAS_HEIGHT;
  return clampRect({ x, y, w: width / CANVAS_WIDTH, h: height / CANVAS_HEIGHT }, fallback);
}

function readAnchorValue(value: unknown): 0 | 1 | 2 | 3 {
  const index = Math.round(asNumber(value, 0));
  return (index <= 0 ? 0 : index >= 3 ? 3 : index) as 0 | 1 | 2 | 3;
}

function readAnchor(raw: unknown): AnchorCell {
  const record = isRecord(raw) ? raw : {};
  return { col: readAnchorValue(record.col), row: readAnchorValue(record.row) };
}

function readAlign(value: unknown): TextBoxAlign {
  return value === 'center' || value === 'right' ? value : 'left';
}

/** 颜色统一成 `#RRGGBB`（大写），读不出来的用兜底色 */
export function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const hex = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toUpperCase();
  }
  return fallback;
}

function readControlKind(value: unknown, fallback: TextBoxControlKind): TextBoxControlKind {
  return value === 'image' || value === 'text' || value === 'portrait' ? value : fallback;
}

function readContent(value: unknown, fallback: TextBoxTextContent): TextBoxTextContent {
  return value === 'speaker' || value === 'line' ? value : fallback;
}

function readPortraitMode(value: unknown, fallback: TextBoxPortraitMode): TextBoxPortraitMode {
  return value === 'single' || value === 'multi' ? value : fallback;
}

function readPortraits(raw: unknown, fallback: TextBoxPortraitPreview[]): TextBoxPortraitPreview[] {
  if (!Array.isArray(raw)) return fallback.map((item) => ({ ...item }));
  return raw.filter(isRecord).map((item) => ({
    characterUid: asString(item.characterUid, ''),
    expression: asString(item.expression, ''),
  }));
}

function readControl(raw: unknown, fallback: TextBoxControl): TextBoxControl {
  const record = isRecord(raw) ? raw : {};
  return {
    uid: asString(record.uid, '') === '' ? newUid() : (record.uid as string),
    kind: readControlKind(record.kind, fallback.kind),
    name: asString(record.name, fallback.name),
    anchor: readAnchor(record.anchor),
    rect: clampRect(record.rect, fallback.rect),
    pivotX: readPivot(record.pivotX, fallback.pivotX),
    pivotY: readPivot(record.pivotY, fallback.pivotY),
    imageUid: asString(record.imageUid, fallback.imageUid),
    content: readContent(record.content, fallback.content),
    fontFamily: asString(record.fontFamily, fallback.fontFamily),
    fontSize: asNumber(record.fontSize, fallback.fontSize),
    color: normalizeColor(record.color, fallback.color),
    align: readAlign(record.align ?? fallback.align),
    verticalAlign: readVerticalAlign(record.verticalAlign, fallback.verticalAlign),
    lineHeight: clamp(
      asNumber(record.lineHeight, fallback.lineHeight),
      LINE_HEIGHT_MIN,
      LINE_HEIGHT_MAX,
    ),
    sampleText: asString(record.sampleText, fallback.sampleText),
    reveal: readReveal(record.reveal, fallback.reveal),
    fadeIn: clamp(asNumber(record.fadeIn, fallback.fadeIn), 0, FADE_MAX),
    fadeOut: clamp(asNumber(record.fadeOut, fallback.fadeOut), 0, FADE_MAX),
    typeSpeed: clamp(
      asNumber(record.typeSpeed, fallback.typeSpeed),
      TYPE_SPEED_MIN,
      TYPE_SPEED_MAX,
    ),
    punctuationPause: clamp(
      asNumber(record.punctuationPause, fallback.punctuationPause),
      0,
      PUNCTUATION_PAUSE_MAX,
    ),
    multiLine: typeof record.multiLine === 'boolean' ? record.multiLine : fallback.multiLine,
    portraitMode: readPortraitMode(record.portraitMode, fallback.portraitMode),
    portraitLayout: readPortraitLayout(record.portraitLayout, fallback.portraitLayout),
    portraitLimit:
      typeof record.portraitLimit === 'boolean' ? record.portraitLimit : fallback.portraitLimit,
    portraits: readPortraits(record.portraits, fallback.portraits),
  };
}

function readVerticalAlign(value: unknown, fallback: TextBoxVerticalAlign): TextBoxVerticalAlign {
  return value === 'top' || value === 'middle' || value === 'bottom' ? value : fallback;
}

function readPortraitLayout(value: unknown, fallback: TextBoxPortraitLayout): TextBoxPortraitLayout {
  return value === 'fill' || value === 'pack' ? value : fallback;
}

function readReveal(value: unknown, fallback: TextBoxReveal): TextBoxReveal {
  return value === 'fade' || value === 'typewriter' || value === 'instant' ? value : fallback;
}

/** 对齐值：0–1，读不出来就用默认的 0.5 */
function readPivot(value: unknown, fallback: number): number {
  return clamp(asNumber(value, fallback), 0, 1);
}

/**
 * 老项目里的文本框是「外框 + 名字 + 台词」三个矩形 + 一个共享的对齐 / 行距，
 * 现在控件由用户自己增删。这里把老数据摊成三个控件：图片 + 人物名称 + 台词。
 */
function readLegacyControls(raw: Record<string, unknown>, fallback: TextBoxRow): TextBoxControl[] {
  const box = clampRect(raw.box, defaultRectFor('image'));
  const anchorsRaw = isRecord(raw.anchors) ? raw.anchors : {};
  // 更老的项目里名字 / 台词存的是「相对外框」，后来才改成相对画布
  const relative = raw.rectSpace !== 'canvas';
  const readPart = (value: unknown, inner: Rect, absolute: Rect): Rect => {
    if (!relative) return clampRect(value, absolute);
    return clampRect(composeRect(box, clampRect(value, inner)), absolute);
  };
  const align = readAlign(raw.align);
  const lineHeight = clamp(asNumber(raw.lineHeight, 1.5), LINE_HEIGHT_MIN, LINE_HEIGHT_MAX);
  const sampleName = asString(raw.sampleName, '角色名');
  const sampleText = asString(raw.sampleText, '这是一段示例台词。');
  const fallbackImage = fallback.controls[0] ?? createImageControl(box);
  const fallbackSpeaker = fallback.controls[1] ?? createTextControl(box, 'speaker', 40, sampleName);
  const fallbackLine = fallback.controls[2] ?? createTextControl(box, 'line', 42, sampleText);

  return [
    {
      ...createImageControl(box, '背景图'),
      anchor: readAnchor(anchorsRaw.bg),
      imageUid: asString(raw.imageUid, fallbackImage.imageUid),
    },
    {
      ...createTextControl(
        readPart(raw.nameRect, DEFAULT_NAME_RECT, fallbackSpeaker.rect),
        'speaker',
        40,
        sampleName,
        '人物名称',
      ),
      anchor: readAnchor(anchorsRaw.name),
      align,
      lineHeight,
    },
    {
      ...createTextControl(
        readPart(raw.textRect, DEFAULT_TEXT_RECT, fallbackLine.rect),
        'line',
        42,
        sampleText,
        '台词',
      ),
      anchor: readAnchor(anchorsRaw.text),
      align,
      lineHeight,
    },
  ];
}

function readTextBox(raw: Record<string, unknown>, index: number): TextBoxRow {
  const fallback = createDefaultTextBox(`文本框 ${index + 1}`);
  const uid = typeof raw.uid === 'string' && raw.uid !== '' ? raw.uid : fallback.uid;
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : fallback.name;
  const three = [fallback.controls[0]!, fallback.controls[1]!, fallback.controls[2]!];
  const controls = Array.isArray(raw.controls)
    ? raw.controls.filter(isRecord).map((item, i) => readControl(item, three[i] ?? three[0]!))
    : isRecord(raw.bg) || isRecord(raw.speaker) || isRecord(raw.text)
      ? [
          readControl(raw.bg, three[0]!),
          readControl(raw.speaker, three[1]!),
          readControl(raw.text, three[2]!),
        ]
      : readLegacyControls(raw, fallback);

  return {
    uid,
    id: typeof raw.id === 'string' ? raw.id.trim() : '',
    name,
    layer: Math.round(asNumber(raw.layer, DEFAULT_LAYER)),
    rectSpace: 'canvas',
    controls,
  };
}

/**
 * 读取项目里的文本框列表。
 *
 * 老项目根本没有这一栏（undefined）→ 补一条默认的，让「文本框」页一打开就有东西可编辑；
 * 项目里显式存了空数组 → 说明用户把文本框删光了，保持空的。
 */
export function normalizeTextBoxes(raw: unknown): TextBoxRow[] {
  if (!Array.isArray(raw)) return [createDefaultTextBox()];
  const rows = raw.filter(isRecord).map((row, index) => readTextBox(row, index));
  // 文本框 ID 是后加的：老项目里没有，按顺序补 TB_1、TB_2…
  for (const row of rows) {
    if (row.id !== '') continue;
    row.id = nextTextBoxId(rows);
  }
  return rows;
}

/**
 * 章节流程图的数据整理与布局。
 *
 * 一个段落 = 图上的一个块。段落里的「选项」行跳到了**本章别的段落**，
 * 就连一条带箭头的线；同一对段落之间的多个选项合并成一条线，标签写「选项内容 ×N」。
 * 跳回本段落自己、跳到本章之外的都不画（后者由校验层提示）。
 *
 * 布局按下单规则算，不依赖 DOM：
 *   横轴 = 连接深度（没被任何选项跳进来的排第一列，被第一列跳进来的排第二列……）
 *   纵轴 = 段落顺序（纵向位置永远等于段落顺序，找段落不会迷路）
 * 这样前进的线是短横线，不再全部挤在一侧。
 */

import { groupUidOfFirstLine } from './ids';
import type { Project } from './types';

export interface FlowBlock {
  uid: string;
  /** 段落编号，如 001 */
  id: string;
  title: string;
  /** 块下面那行小字，如「22 行 · 2 个选项」 */
  meta: string;
  /** 段落注释，块会因为它变高 */
  note: string;
  /**
   * 属于第几"串"。
   *
   * 有跳转关系的段落（不管方向）算同一串，孤立的段落各成一串；
   * 排布时一串占一块纵向区域，串与串之间不会混在同一行里。
   */
  component: number;
  /** 在这一串里的第几层（往下） */
  layer: number;
}

export interface FlowEdge {
  /** 唯一 key：from→to */
  key: string;
  from: string;
  to: string;
  /** 标签：单个选项就是它的文字，合并后是「文字 ×N」 */
  label: string;
  /** 悬浮提示 */
  note: string;
  /** 这条线包含的选项，点标签跳到第一个 */
  optionUids: string[];
}

export interface ChapterFlow {
  chapterUid: string;
  blocks: FlowBlock[];
  edges: FlowEdge[];
}

/** 整理一章的流程图；章节不存在时返回 null */
export function buildChapterFlow(project: Project, chapterUid: string): ChapterFlow | null {
  const chapter = project.chapters.find((item) => item.uid === chapterUid);
  if (chapter === undefined) return null;

  const blocks: FlowBlock[] = chapter.groups.map((group) => ({
    uid: group.uid,
    id: group.id,
    title: group.title || group.id,
    meta: `${group.lines.length} 行 · ${group.options.length} 个选项`,
    note: group.note ?? '',
    component: 0,
    layer: 0,
  }));
  const titleOf = new Map(blocks.map((block) => [block.uid, block.title]));

  /** 对话行 uid → 它所在的段落 uid（只看本章） */
  const groupOfLine = new Map<string, string>();
  for (const group of chapter.groups) {
    for (const line of group.lines) groupOfLine.set(line.uid, group.uid);
  }

  /** 同一对段落之间的线先攒起来，最后合并成一条 */
  interface Bundle {
    from: string;
    to: string;
    first: string;
    optionUids: string[];
    lines: string[];
  }
  const bundles = new Map<string, Bundle>();

  for (const group of chapter.groups) {
    for (const line of group.lines) {
      if (line.kind !== '选项') continue;

      for (const optionUid of line.optionIds) {
        const option = group.options.find((item) => item.uid === optionUid);
        if (option === undefined || option.nextId === '') continue;

        // 「跳转到首句对话」记的是段落 uid，直接就是线上的终点
        const target =
          groupUidOfFirstLine(option.nextId) ?? groupOfLine.get(option.nextId);
        if (target === undefined || target === null || target === group.uid) continue;

        const key = `${group.uid}->${target}`;
        const text = option.text.zh.trim() === '' ? option.readableId : option.text.zh.trim();
        const bundle = bundles.get(key);

        if (bundle === undefined) {
          bundles.set(key, {
            from: group.uid,
            to: target,
            first: text,
            optionUids: [option.uid],
            lines: [`${group.title || group.id} · ${line.readableId}：${text}`],
          });
          continue;
        }
        bundle.optionUids.push(option.uid);
        bundle.lines.push(`${group.title || group.id} · ${line.readableId}：${text}`);
      }
    }
  }

  const edges: FlowEdge[] = [...bundles.entries()].map(([key, bundle]) => {
    const count = bundle.optionUids.length;
    return {
      key,
      from: bundle.from,
      to: bundle.to,
      label: count > 1 ? `${bundle.first} ×${count}` : bundle.first,
      note: [`跳到「${titleOf.get(bundle.to) ?? ''}」`, ...bundle.lines].join('\n'),
      optionUids: bundle.optionUids,
    };
  });

  assignComponents(blocks, edges);

  return { chapterUid, blocks, edges };
}

/**
 * 把段落分成一串一串，并在每串内部定"第几层"。
 *
 * 有跳转关系的段落（不管方向）算同一串：连通分量。孤立的段落各成一串。
 * 串的顺序按"串里最靠前的那个段落"，所以图上从上往下就是段落顺序的大致走向。
 */
function assignComponents(blocks: FlowBlock[], edges: FlowEdge[]): void {
  const position = new Map(blocks.map((block, index) => [block.uid, index]));
  const neighbors = new Map<string, string[]>(blocks.map((block) => [block.uid, []]));
  for (const edge of edges) {
    neighbors.get(edge.from)?.push(edge.to);
    neighbors.get(edge.to)?.push(edge.from);
  }

  const visited = new Set<string>();
  let component = 0;

  for (const start of blocks) {
    if (visited.has(start.uid)) continue;

    const members: FlowBlock[] = [];
    const queue = [start.uid];
    visited.add(start.uid);

    while (queue.length > 0) {
      const uid = queue.shift() as string;
      const block = blocks[position.get(uid) ?? 0];
      members.push(block);
      for (const next of neighbors.get(uid) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }

    members.sort((a, b) => (position.get(a.uid) ?? 0) - (position.get(b.uid) ?? 0));
    assignLayers(members, edges, component);
    component += 1;
  }
}

/**
 * 给一串内的段落定层：从"没有被跳进来"的段落出发做广度优先，跳数就是层。
 * 整串都在环里（互相跳）时没有入口，一律留在第一层。
 */
function assignLayers(members: FlowBlock[], edges: FlowEdge[], component: number): void {
  const inComponent = new Set(members.map((member) => member.uid));
  const inner = edges.filter(
    (edge) => inComponent.has(edge.from) && inComponent.has(edge.to),
  );
  const UNREACHED = Number.POSITIVE_INFINITY;

  const layer = new Map<string, number>();
  const hasIncoming = new Set(inner.map((edge) => edge.to));

  const outgoing = new Map<string, string[]>();
  for (const edge of inner) {
    const list = outgoing.get(edge.from);
    if (list === undefined) outgoing.set(edge.from, [edge.to]);
    else list.push(edge.to);
  }

  const queue = members.filter((member) => !hasIncoming.has(member.uid)).map((m) => m.uid);
  const seen = new Set(queue);
  for (const uid of queue) layer.set(uid, 0);

  while (queue.length > 0) {
    const uid = queue.shift() as string;
    const next = (layer.get(uid) ?? 0) + 1;
    for (const target of outgoing.get(uid) ?? []) {
      layer.set(target, Math.min(layer.get(target) ?? UNREACHED, next));
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }

  for (const member of members) {
    const value = layer.get(member.uid) ?? UNREACHED;
    member.component = component;
    member.layer = Number.isFinite(value) ? value : 0;
  }
}

export interface FlowGeometry {
  blockWidth: number;
  /** 块的基础高度：标题 + 说明行 */
  blockHeight: number;
  /** 注释每行的高度（估算用；渲染后会用实测高度覆盖） */
  noteLineHeight: number;
  /** 同一层内折行时的行距 */
  rowGap: number;
  /** 同一层内、同一行的块间距 */
  columnGap: number;
  /** 层与层之间留出的间距：标签就摆在这条带子里 */
  layerGap: number;
  pad: number;
  /** 同一行内绕行的车道，从块右侧起算 */
  laneStart: number;
  laneStep: number;
  /** 画布可用的宽度，用来决定一层里放几个块 */
  availableWidth: number;
  /** 渲染后量到的真实块高（注释换行几行只有渲染后才知道） */
  measuredHeights?: Record<string, number>;
}

export interface PositionedBlock {
  block: FlowBlock;
  x: number;
  y: number;
  height: number;
}

export interface RoutedEdge {
  edge: FlowEdge;
  /** SVG path 的 d */
  d: string;
  labelX: number;
  labelY: number;
}

export interface FlowLayout {
  blocks: PositionedBlock[];
  edges: RoutedEdge[];
  width: number;
  height: number;
  /** 块的尺寸，渲染时直接用，免得再算一遍 */
  blockWidth: number;
  blockHeight: number;
}

/** 标签按这个宽度估算，用来错开重叠与算画布宽度 */
const LABEL_WIDTH = 190;
const LABEL_HEIGHT = 20;

/**
 * 块的实际高度。
 *
 * 渲染后量到的真实高度优先（注释换行几行只有浏览器知道）；
 * 还没量到时按注释字数估一个，估得偏一点也只是箭头位置差几像素。
 */
function heightOf(block: FlowBlock, geo: FlowGeometry): number {
  const measured = geo.measuredHeights?.[block.uid];
  if (measured !== undefined && measured > 0) return measured;
  if (block.note.trim() === '') return geo.blockHeight;

  // 中文按一个字约 12px 估，两侧留出内边距
  const perLine = Math.max(6, Math.floor((geo.blockWidth - 24) / 12));
  const lines = Math.min(5, Math.ceil(block.note.trim().length / perLine));
  return geo.blockHeight + lines * geo.noteLineHeight;
}

/**
 * 算每个块和每条线的坐标。
 *
 * 竖向排布：连接深度决定第几"层"（往下走），同一层里的段落按段落顺序横向铺开、
 * 一行放不下就折到下一行；每个块的高度按内容来，同一行里按最高的那个占位。
 * 线是从块的上下边中间进出的竖向 S 弯，所以"往下演"走向下的线、"跳回去"走向上的线。
 *
 * 纯计算，不碰 DOM，所以可以直接单测。
 */
export function layoutChapterFlow(flow: ChapterFlow, geo: FlowGeometry): FlowLayout {
  const perRow = Math.max(
    1,
    Math.floor(
      (geo.availableWidth - geo.pad * 2 + geo.columnGap) / (geo.blockWidth + geo.columnGap),
    ),
  );

  const heights = new Map(flow.blocks.map((block) => [block.uid, heightOf(block, geo)]));

  const blocks: PositionedBlock[] = [];
  let cursor = geo.pad;

  // 一串一串地往下排：每串内部按层分行，串与串之间紧接下一行
  const componentIndexes = [...new Set(flow.blocks.map((block) => block.component))].sort(
    (a, b) => a - b,
  );

  for (const component of componentIndexes) {
    const members = flow.blocks.filter((block) => block.component === component);
    const layers = [...new Set(members.map((member) => member.layer))].sort((a, b) => a - b);

    layers.forEach((layer, layerIndex) => {
      const row = members.filter((member) => member.layer === layer);
      const chunks: FlowBlock[][] = [];
      for (let start = 0; start < row.length; start += perRow) {
        chunks.push(row.slice(start, start + perRow));
      }

      const lastLayer = layerIndex === layers.length - 1;
      chunks.forEach((chunk, chunkIndex) => {
        let rowHeight = 0;
        for (const block of chunk) rowHeight = Math.max(rowHeight, heights.get(block.uid) ?? 0);

        chunk.forEach((block, column) => {
          blocks.push({
            block,
            x: geo.pad + column * (geo.blockWidth + geo.columnGap),
            y: cursor,
            height: heights.get(block.uid) ?? geo.blockHeight,
          });
        });

        // 层与层之间留出标签的位置；折行与换个串只要普通行距
        const lastChunk = chunkIndex === chunks.length - 1;
        cursor += rowHeight + (lastChunk && !lastLayer ? geo.layerGap : geo.rowGap);
      });
    });

    // 串与串之间多留一点，让"这是两串"看得出来
    if (component !== componentIndexes[componentIndexes.length - 1]) cursor += geo.rowGap;
  }

  const placed = new Map(blocks.map((item) => [item.block.uid, item]));
  const sameRowUsed = new Map<string, number>();
  const routes: RoutedEdge[] = [];

  for (const edge of flow.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (from === undefined || to === undefined) continue;

    const centerX = (item: PositionedBlock): number => item.x + geo.blockWidth / 2;
    let d = '';
    let labelX = 0;
    let labelY = 0;

    if (Math.abs(to.y - from.y) < 1) {
      // 同一行：从右侧绕一个小弯
      const laneIndex = sameRowUsed.get(edge.from) ?? 0;
      sameRowUsed.set(edge.from, laneIndex + 1);
      const lane = from.x + geo.blockWidth + geo.laneStart + laneIndex * geo.laneStep;
      const right = from.x + geo.blockWidth;
      const y1 = from.y + from.height / 2;
      const y2 = to.y + to.height / 2;
      d = `M ${right} ${y1} C ${lane} ${y1}, ${lane} ${y2}, ${right} ${y2}`;
      labelX = (right + 3 * lane + 3 * lane + right) / 8;
      labelY = (y1 + y2) / 2;
    } else {
      // 往下（或往回往上）：从块的上下边中间进出
      const downward = to.y > from.y;
      const y1 = downward ? from.y + from.height : from.y;
      const y2 = downward ? to.y : to.y + to.height;
      const midY = (y1 + y2) / 2;
      d = `M ${centerX(from)} ${y1} C ${centerX(from)} ${midY}, ${centerX(to)} ${midY}, ${centerX(to)} ${y2}`;
      labelX = (centerX(from) + centerX(to)) / 2;
      labelY = midY;
    }

    routes.push({ edge, d, labelX, labelY });
  }

  // 标签互相错开，别叠在一起（横向让位）
  const taken: { x: number; y: number }[] = [];
  for (const route of routes) {
    for (let guard = 0; guard < 8; guard += 1) {
      const clash = taken.some(
        (item) =>
          Math.abs(item.y - route.labelY) < LABEL_HEIGHT &&
          Math.abs(item.x - route.labelX) < LABEL_WIDTH,
      );
      if (!clash) break;
      route.labelX += LABEL_WIDTH * 0.6;
    }
    taken.push({ x: route.labelX, y: route.labelY });
  }

  const width = Math.max(
    ...blocks.map((item) => item.x + geo.blockWidth + geo.pad),
    ...routes.map((route) => route.labelX + LABEL_WIDTH / 2 + geo.pad),
    geo.pad * 2 + geo.blockWidth,
  );
  const height = Math.max(
    ...blocks.map((item) => item.y + item.height + geo.pad),
    ...routes.map((route) => route.labelY + LABEL_HEIGHT),
    geo.pad * 2 + geo.blockHeight,
  );

  return {
    blocks,
    edges: routes,
    width,
    height,
    blockWidth: geo.blockWidth,
    blockHeight: geo.blockHeight,
  };
}
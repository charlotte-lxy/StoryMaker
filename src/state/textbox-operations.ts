import { clampRect, createDefaultTextBox } from '../core/textbox';
import type { AnchorCell, Project, Rect, TextBoxRow } from '../core/types';
import { mutate } from './operations';

/** 画布上的三个控件：外框（背景图）/ 名字 / 台词 */
export type TextBoxPart = 'box' | 'nameRect' | 'textRect';

const ANCHOR_KEY = { box: 'bg', nameRect: 'name', textRect: 'text' } as const;

/** 项目里的文本框列表；老项目还没归一化时按空表处理 */
export function textBoxesOf(project: Project): TextBoxRow[] {
  return project.textBoxes ?? [];
}

export function addTextBox(project: Project): Project {
  return mutate(project, (draft) => {
    const list = draft.textBoxes ?? (draft.textBoxes = []);
    list.push(createDefaultTextBox(`文本框 ${list.length + 1}`));
  });
}

export function removeTextBox(project: Project, uid: string): Project {
  return mutate(project, (draft) => {
    if (draft.textBoxes === undefined) return;
    draft.textBoxes = draft.textBoxes.filter((row) => row.uid !== uid);
    if (draft.ui?.textBoxUid === uid) delete draft.ui.textBoxUid;
  });
}

export function updateTextBox(
  project: Project,
  uid: string,
  patch: Partial<Omit<TextBoxRow, 'uid'>>,
): Project {
  return mutate(project, (draft) => {
    const row = draft.textBoxes?.find((item) => item.uid === uid);
    if (row === undefined) return;
    Object.assign(row, patch);
  });
}

/** 拖动 / 缩放改一个矩形：三个控件都相对画布 */
export function setTextBoxRect(
  project: Project,
  uid: string,
  which: TextBoxPart,
  rect: Rect,
): Project {
  return mutate(project, (draft) => {
    const row = draft.textBoxes?.find((item) => item.uid === uid);
    if (row === undefined) return;
    row[which] = clampRect(rect, row[which]);
  });
}

/** 换一个控件的锚点：矩形不动，只换成新的参考点（跟 Unreal 一样） */
export function setTextBoxAnchor(
  project: Project,
  uid: string,
  which: TextBoxPart,
  anchor: AnchorCell,
): Project {
  return mutate(project, (draft) => {
    const row = draft.textBoxes?.find((item) => item.uid === uid);
    if (row === undefined) return;
    row.anchors = { ...row.anchors, [ANCHOR_KEY[which]]: { ...anchor } };
  });
}

/** 记住上次编辑的是哪一条（存在项目文件的 ui 里，换台机器也接着看同一张） */
export function rememberTextBox(project: Project, uid: string): Project {
  if (project.ui?.textBoxUid === uid) return project;
  return mutate(project, (draft) => {
    draft.ui = { ...(draft.ui ?? { theme: '' }), textBoxUid: uid };
  });
}

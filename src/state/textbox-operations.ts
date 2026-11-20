import { clampRect, createDefaultTextBox } from '../core/textbox';
import type { Project, Rect, TextBoxRow } from '../core/types';
import { mutate } from './operations';

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

/** 拖动 / 缩放改一个矩形：box 相对画面，nameRect / textRect 相对外框 */
export function setTextBoxRect(
  project: Project,
  uid: string,
  which: 'box' | 'nameRect' | 'textRect',
  rect: Rect,
): Project {
  return mutate(project, (draft) => {
    const row = draft.textBoxes?.find((item) => item.uid === uid);
    if (row === undefined) return;
    row[which] = clampRect(rect, row[which]);
  });
}

/** 记住上次编辑的是哪一条（存在项目文件的 ui 里，换台机器也接着看同一张） */
export function rememberTextBox(project: Project, uid: string): Project {
  if (project.ui?.textBoxUid === uid) return project;
  return mutate(project, (draft) => {
    draft.ui = { ...(draft.ui ?? { theme: '' }), textBoxUid: uid };
  });
}

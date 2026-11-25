import {
  clampRect,
  createControl,
  createDefaultTextBox,
  defaultRectFor,
  nextControlName,
  nextTextBoxId,
} from '../core/textbox';
import type {
  AnchorCell,
  Project,
  Rect,
  TextBoxControl,
  TextBoxControlKind,
  TextBoxRow,
} from '../core/types';
import { mutate } from './operations';

/** 项目里的文本框列表；老项目还没归一化时按空表处理 */
export function textBoxesOf(project: Project): TextBoxRow[] {
  return project.textBoxes ?? [];
}

export function addTextBox(project: Project): Project {
  return mutate(project, (draft) => {
    const list = draft.textBoxes ?? (draft.textBoxes = []);
    list.push(
      createDefaultTextBox(`文本框 ${list.length + 1}`, nextTextBoxId(list)),
    );
  });
}

/**
 * 删一个文本框。
 *
 * 角色存的是 uid，所以用着它的角色要挪到剩下的第一个文本框，
 * 不然导出的「文本框」列会空着。
 */
export function removeTextBox(project: Project, uid: string): Project {
  return mutate(project, (draft) => {
    if (draft.textBoxes === undefined) return;
    draft.textBoxes = draft.textBoxes.filter((row) => row.uid !== uid);
    const fallback = draft.textBoxes[0]?.uid ?? '';
    for (const character of draft.characters) {
      if (character.textBoxUid === uid) character.textBoxUid = fallback;
    }
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

function findControl(
  row: TextBoxRow,
  controlUid: string,
): TextBoxControl | undefined {
  return row.controls.find((control) => control.uid === controlUid);
}

/** 改一个控件的属性（字体、颜色、示例文本、图片、预览角色…） */
export function setControlProps(
  project: Project,
  textBoxUid: string,
  controlUid: string,
  patch: Partial<TextBoxControl>,
): Project {
  return mutate(project, (draft) => {
    const row = draft.textBoxes?.find((item) => item.uid === textBoxUid);
    if (row === undefined) return;
    const control = findControl(row, controlUid);
    if (control === undefined) return;
    Object.assign(control, patch);
  });
}

/** 拖动 / 缩放改一个控件的矩形：所有控件都相对画布 */
export function setControlRect(
  project: Project,
  textBoxUid: string,
  controlUid: string,
  rect: Rect,
): Project {
  return mutate(project, (draft) => {
    const row = draft.textBoxes?.find((item) => item.uid === textBoxUid);
    if (row === undefined) return;
    const control = findControl(row, controlUid);
    if (control === undefined) return;
    control.rect = clampRect(rect, control.rect);
  });
}

/** 换一个控件的锚点：矩形不动，只换成新的参考点（跟 Unreal 一样） */
export function setControlAnchor(
  project: Project,
  textBoxUid: string,
  controlUid: string,
  anchor: AnchorCell,
): Project {
  return mutate(project, (draft) => {
    const row = draft.textBoxes?.find((item) => item.uid === textBoxUid);
    if (row === undefined) return;
    const control = findControl(row, controlUid);
    if (control === undefined) return;
    control.anchor = { ...anchor };
  });
}

/** 「添加控件」：在控件列表末尾加一个，名字自动排（图片 1、文本 2…） */
export function addControl(
  project: Project,
  textBoxUid: string,
  kind: TextBoxControlKind,
): Project {
  return mutate(project, (draft) => {
    const row = draft.textBoxes?.find((item) => item.uid === textBoxUid);
    if (row === undefined) return;
    const name = nextControlName(row.controls, kind);
    row.controls.push(createControl(kind, defaultRectFor(kind), name));
  });
}

/** 删掉一个控件（只删控件，不动文本框） */
export function removeControl(project: Project, textBoxUid: string, controlUid: string): Project {
  return mutate(project, (draft) => {
    const row = draft.textBoxes?.find((item) => item.uid === textBoxUid);
    if (row === undefined) return;
    row.controls = row.controls.filter((control) => control.uid !== controlUid);
  });
}

/** 拖动排序：把第 from 个控件挪到第 to 个位置（数组越靠后画得越上层） */
export function moveControl(
  project: Project,
  textBoxUid: string,
  from: number,
  to: number,
): Project {
  const row = textBoxesOf(project).find((item) => item.uid === textBoxUid);
  if (row === undefined) return project;
  if (from < 0 || from >= row.controls.length) return project;
  if (to < 0 || to >= row.controls.length || from === to) return project;
  return mutate(project, (draft) => {
    const target = draft.textBoxes?.find((item) => item.uid === textBoxUid);
    if (target === undefined) return;
    const [moved] = target.controls.splice(from, 1);
    target.controls.splice(to, 0, moved);
  });
}

/** 记住上次编辑的是哪一条（存在项目文件的 ui 里，换台机器也接着看同一张） */
export function rememberTextBox(project: Project, uid: string): Project {
  if (project.ui?.textBoxUid === uid) return project;
  return mutate(project, (draft) => {
    draft.ui = { ...(draft.ui ?? { theme: '' }), textBoxUid: uid };
  });
}

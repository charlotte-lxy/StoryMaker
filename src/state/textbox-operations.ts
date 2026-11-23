import { clampRect, createDefaultTextBox, nextTextBoxId } from '../core/textbox';
import type { AnchorCell, Project, Rect, TextBoxControl, TextBoxRow } from '../core/types';
import { mutate } from './operations';

/** 画布上的三个控件：背景图 / 人物名称 / 台词 */
export type TextBoxPart = 'bg' | 'speaker' | 'text';

/** 三个控件的顺序（也是右侧选项卡的顺序） */
export const TEXT_BOX_PARTS: readonly TextBoxPart[] = ['bg', 'speaker', 'text'];

export const TEXT_BOX_PART_LABELS: Record<TextBoxPart, string> = {
  bg: '背景图',
  speaker: '人物名称',
  text: '台词',
};

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

/** 改一个控件的属性（字体、颜色、示例文本、隐藏…） */
export function setTextBoxControl(
  project: Project,
  uid: string,
  which: TextBoxPart,
  patch: Partial<TextBoxControl>,
): Project {
  return mutate(project, (draft) => {
    const row = draft.textBoxes?.find((item) => item.uid === uid);
    if (row === undefined) return;
    Object.assign(row[which], patch);
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
    row[which].rect = clampRect(rect, row[which].rect);
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
    row[which].anchor = { ...anchor };
  });
}

/** 记住上次编辑的是哪一条（存在项目文件的 ui 里，换台机器也接着看同一张） */
export function rememberTextBox(project: Project, uid: string): Project {
  if (project.ui?.textBoxUid === uid) return project;
  return mutate(project, (draft) => {
    draft.ui = { ...(draft.ui ?? { theme: '' }), textBoxUid: uid };
  });
}

/**
 * 字体子模块的增删改。
 *
 * 字体文件放在素材文件夹的 Fonts/ 里，这里只维护「显示名称 + 文件名」这一张表；
 * 文本框控件的 `fontFamily` 存的是显示名称，所以改名时要把它一起改掉。
 */

import { newUid } from '../core/ids';
import { DEFAULT_FONT_FAMILY } from '../core/textbox';
import type { FontRow, Project } from '../core/types';
import { mutate } from './operations';

/** 项目里的字体表；老项目还没归一化时按空表处理 */
export function fontsOf(project: Project): FontRow[] {
  return project.fonts ?? [];
}

/** 加一行字体；名字空着时用文件名兜底 */
export function addFont(project: Project, name: string, fileName: string): Project {
  return mutate(project, (draft) => {
    const list = draft.fonts ?? (draft.fonts = []);
    const fallback = fileName.replace(/\.[^.]+$/, '');
    list.push({
      uid: newUid(),
      name: name.trim() === '' ? fallback : name.trim(),
      fileName,
    });
  });
}

/**
 * 改一行的显示名称或文件名。
 *
 * 显示名称变了，文本框里所有用着旧名字的控件一起改，引用不会断。
 */
export function updateFont(
  project: Project,
  uid: string,
  patch: Partial<Omit<FontRow, 'uid'>>,
): Project {
  return mutate(project, (draft) => {
    const row = draft.fonts?.find((item) => item.uid === uid);
    if (row === undefined) return;

    const previous = row.name;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.fileName !== undefined) row.fileName = patch.fileName;

    if (patch.name !== undefined && patch.name !== previous) {
      for (const textBox of draft.textBoxes ?? []) {
        for (const control of textBox.controls) {
          if (control.fontFamily === previous) control.fontFamily = patch.name;
        }
      }
    }
  });
}

/** 删一行字体；用着它的控件退回到默认字体，不至于导出成不存在的名字 */
export function removeFont(project: Project, uid: string): Project {
  return mutate(project, (draft) => {
    const row = draft.fonts?.find((item) => item.uid === uid);
    if (row === undefined) return;

    const name = row.name;
    draft.fonts = (draft.fonts ?? []).filter((item) => item.uid !== uid);
    for (const textBox of draft.textBoxes ?? []) {
      for (const control of textBox.controls) {
        if (control.fontFamily === name) control.fontFamily = DEFAULT_FONT_FAMILY;
      }
    }
  });
}

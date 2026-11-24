/**
 * 剧情 → 字体：导入字体文件、给每个字体起个显示名称、顺手预览一下。
 *
 * 文件进素材文件夹的 Fonts/；这里的「显示名称」就是文本框里字体下拉的选项，
 * 也是导出「字体样式」那一列写出去的东西。
 */

import { useState } from 'react';

import type { HostApi } from '../core/host';
import type { Project } from '../core/types';
import { addFont, fontsOf, removeFont, updateFont } from '../state/font-operations';
import type { AssetLibrary } from './use-asset-library';

const DEFAULT_SAMPLE = '这是字体预览 AaBbCc 0123';

export interface FontEditorProps {
  project: Project;
  assets?: { library: AssetLibrary; host: HostApi | undefined };
  onChange: (next: Project) => void;
}

/** 从完整路径里取文件名（Windows / POSIX 都认） */
function fileNameOf(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return index >= 0 ? filePath.slice(index + 1) : filePath;
}

export function FontEditor({ project, assets, onChange }: FontEditorProps) {
  const rows = fontsOf(project);
  const library = assets?.library;

  /** 每个字体演示用的样例文字（只是界面状态，不进项目文件） */
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  const sampleOf = (uid: string): string => samples[uid] ?? DEFAULT_SAMPLE;

  const handleImport = async (): Promise<void> => {
    if (library === undefined) {
      setMessage('网页版不能导入字体文件，请在桌面版里操作');
      return;
    }

    setMessage('');
    // 字体保留原文件名，id 传空串即可
    const result = await library.upload('', 'font', false);
    if (!result.ok) {
      if (result.message !== undefined && result.message !== '') setMessage(result.message);
      return;
    }

    const fileName = fileNameOf(result.filePath ?? '');
    if (fileName === '') return;
    onChange(addFont(project, fileName.replace(/\.[^.]+$/, ''), fileName));
  };

  return (
    <div className="editor">
      <div className="char-config">
        <section className="config-panel">
          <div className="lookup-subhead">
            <h3>字体</h3>
            <span className="hint">
              字体文件放在素材文件夹的 Fonts 里。这里起的显示名称就是文本框字体下拉里的选项，
              导出时写进「字体样式」。
            </span>
            <button type="button" className="primary" onClick={() => void handleImport()}>
              ＋ 导入字体
            </button>
          </div>

          {message !== '' && <div className="empty-state">{message}</div>}

          {rows.length === 0 ? (
            <div className="empty-state">还没有字体。点「＋ 导入字体」选一个 .ttf 或 .otf。</div>
          ) : (
            <table className="lines">
              <thead>
                <tr>
                  <th>显示名称</th>
                  <th>字体文件</th>
                  <th>预览文字</th>
                  <th>预览</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className="line-row" key={row.uid}>
                    <td>
                      <input
                        value={row.name}
                        aria-label={`字体显示名称 ${row.fileName}`}
                        onChange={(event) =>
                          onChange(updateFont(project, row.uid, { name: event.target.value }))
                        }
                      />
                    </td>
                    <td>
                      <span className="hint">{row.fileName}</span>
                    </td>
                    <td>
                      <input
                        value={sampleOf(row.uid)}
                        aria-label={`预览文字 ${row.fileName}`}
                        onChange={(event) =>
                          setSamples((current) => ({ ...current, [row.uid]: event.target.value }))
                        }
                      />
                    </td>
                    <td>
                      <span style={{ fontFamily: row.name, fontSize: 18 }}>
                        {sampleOf(row.uid)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="mini danger"
                        onClick={() => onChange(removeFont(project, row.uid))}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

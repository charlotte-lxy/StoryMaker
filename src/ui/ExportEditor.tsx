import { useMemo } from 'react';

import { buildAllSheets } from '../core/export';
import type { Project } from '../core/types';
import { ExportPreviewPage } from './export/ExportPreviewPage';
import { ImportSettingsPage } from './export/ImportSettingsPage';
import { useRememberedChoice } from './view-memory';

type ExportPage = 'settings' | 'preview';

interface Props {
  project: Project;
  onChange: (next: Project) => void;
  /** 导出 Excel：按钮在工具列表最下面 */
  onExport: () => void;
}

/**
 * 导出模块。
 *
 * 左边一条窄栏分两段：
 *   上面是导出的全部子表（垂直排列，点哪个右边就显示哪张子表的内容）；
 *   最下面是工具列表——「Unreal导入设置」打开设置页，「导出 Excel」直接导出。
 *
 * 工具列表靠 margin-top:auto 贴在侧边栏最下面，新增的工具按钮加在「导出 Excel」上面，
 * 列表就从下往上长，最常用的那个始终贴在手边。
 */
export function ExportEditor({ project, onChange, onExport }: Props) {
  const sheets = useMemo(() => buildAllSheets(project), [project]);
  const [page, setPage] = useRememberedChoice<ExportPage>('export:page', 'settings');
  const [picked, setPicked] = useRememberedChoice<string>('export:sheet', '');

  // 记住的那张子表可能已经没了（改名、删表），退回第一张
  const current = sheets.some((sheet) => sheet.name === picked) ? picked : (sheets[0]?.name ?? '');

  const openSheet = (name: string): void => {
    setPicked(name);
    setPage('preview');
  };

  return (
    <div className="export-body">
      <aside className="export-side">
        <div className="export-sheets">
          <span className="export-group-head">子表</span>
          {sheets.map((sheet) => (
            <button
              key={sheet.name}
              type="button"
              className={
                page === 'preview' && sheet.name === current ? 'export-nav active' : 'export-nav'
              }
              onClick={() => openSheet(sheet.name)}
            >
              <span>{sheet.name}</span>
              <span className="count">{sheet.rows.length - 1}</span>
            </button>
          ))}
        </div>

        <div className="export-tools">
          <span className="export-group-head">工具</span>
          <button
            type="button"
            className={page === 'settings' ? 'export-tool active' : 'export-tool'}
            onClick={() => setPage('settings')}
          >
            Unreal导入设置
          </button>
          <button type="button" className="primary export-tool" onClick={onExport}>
            导出 Excel
          </button>
        </div>
      </aside>

      <div className="export-main">
        {page === 'settings' ? (
          <ImportSettingsPage project={project} onChange={onChange} />
        ) : (
          <ExportPreviewPage project={project} name={current} />
        )}
      </div>
    </div>
  );
}

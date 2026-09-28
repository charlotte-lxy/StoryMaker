import type { Project } from '../core/types';
import { ExportPreviewPage } from './export/ExportPreviewPage';
import { ImportSettingsPage } from './export/ImportSettingsPage';
import { useRememberedChoice } from './view-memory';

type ExportPage = 'settings' | 'preview';

const PAGES: { key: ExportPage; label: string }[] = [
  { key: 'settings', label: 'Unreal导入设置' },
  { key: 'preview', label: '导出预览' },
];

interface Props {
  project: Project;
  onChange: (next: Project) => void;
  /** 导出 Excel：按钮就放在左边这栏最下面 */
  onExport: () => void;
}

/**
 * 导出模块。
 *
 * 左边一条窄栏：上面是「Unreal导入设置 / 导出预览」两个子页面，
 * 最下面是工具按钮列表——「导出 Excel」在里面置底，以后新增的工具按钮往它上面加，
 * 这样列表是从下往上长的，最常用的那个始终贴在手边。
 */
export function ExportEditor({ project, onChange, onExport }: Props) {
  const [page, setPage] = useRememberedChoice<ExportPage>('export:page', 'settings');

  return (
    <div className="export-body">
      <aside className="export-side">
        {PAGES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={page === item.key ? 'export-nav active' : 'export-nav'}
            onClick={() => setPage(item.key)}
          >
            {item.label}
          </button>
        ))}

        <div className="export-tools">
          <span className="export-tools-head">工具</span>
          {/*
            工具按钮列表：靠 margin-top:auto 贴在侧边栏最下面。
            新增的按钮加在「导出 Excel」上面，列表就从下往上长。
          */}
          <button type="button" className="primary export-tool" onClick={onExport}>
            导出 Excel
          </button>
        </div>
      </aside>

      <div className="export-main">
        {page === 'settings' && <ImportSettingsPage project={project} onChange={onChange} />}
        {page === 'preview' && <ExportPreviewPage project={project} />}
      </div>
    </div>
  );
}

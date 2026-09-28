import type { Issue, ValidationReport } from '../core/validate';
import { useScrollMemory } from './view-memory';

interface Props {
  /** 哪个模块的校验结果，显示在标题上 */
  label: string;
  report: ValidationReport;
  /** 结果列表是否展开；默认收起，平时只在这条上显示条数 */
  expanded: boolean;
  onToggle: () => void;
  /** 点某一条问题时跳过去 */
  onJumpToIssue: (issue: Issue) => void;
}

/**
 * 校验结果面板：贴在模块界面最下方的一条。
 *
 * 校验是随改动自动跑的（结果由上层算好传进来），所以这里没有「手动检查」——
 * 「校验」按钮只负责把结果列表展开 / 收起。平时收起，只在按钮旁边显示条数；
 * 点开之后每一条问题都能点，点了直接切到出问题的地方。
 */
export function IssuePanel({ label, report, expanded, onToggle, onJumpToIssue }: Props) {
  const issues = report.issues;
  // 问题多的时候这一条自己也会滚，切模块回来同样要回到原处
  const panelRef = useScrollMemory<HTMLElement>(`issues:${label}`);

  return (
    <section className={`issues${expanded ? '' : ' collapsed'}`} ref={panelRef}>
      <div className="issues-head">
        <h3>{label}校验结果</h3>
        <button
          type="button"
          className="primary"
          title={expanded ? '收起校验结果' : '展开校验结果'}
          onClick={onToggle}
        >
          校验
        </button>

        {issues.length === 0 ? (
          <span className="badge ok">没有问题</span>
        ) : (
          <>
            {report.errors > 0 && <span className="badge error">必须修复 {report.errors}</span>}
            {report.warnings > 0 && <span className="badge warn">建议检查 {report.warnings}</span>}
          </>
        )}
      </div>

      {expanded &&
        (issues.length === 0 ? (
          <div className="issues-hint">没有发现问题，可以放心导出。</div>
        ) : (
          <ul className="issue-list">
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.targetId}-${index}`} className={issue.level}>
                <button
                  type="button"
                  className="issue-row"
                  title="点一下跳到出问题的地方"
                  onClick={() => onJumpToIssue(issue)}
                >
                  <span className="target">{issue.targetId || '(空)'}</span>
                  <span className="where">{issue.where}</span>
                  <span className="msg">{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

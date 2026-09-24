import { useState } from 'react';

import type { Issue, ValidationReport } from '../core/validate';

interface Props {
  report: ValidationReport;
  hasChecked: boolean;
  /** 点「校验」时跑一遍检查 */
  onCheck: () => void;
  /** 点某一条问题时跳过去 */
  onJumpToIssue: (issue: Issue) => void;
}

/**
 * 校验结果面板。
 *
 * 「校验」按钮就在面板标题旁边，面板本身可以收起（短屏时留出更多编辑空间）。
 * 每一条问题都能点，点了直接切到出问题的那一行并把它高亮出来。
 */
export function IssuePanel({ report, hasChecked, onCheck, onJumpToIssue }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const hasIssues = hasChecked && report.issues.length > 0;

  return (
    <section className={`issues${collapsed ? ' collapsed' : ''}`}>
      <div className="issues-head">
        <h3>校验结果</h3>
        <button type="button" className="primary" onClick={onCheck}>
          校验
        </button>

        {!hasChecked && <span className="hint">检查跳转、ID、空台词与空指令</span>}
        {hasChecked && report.errors === 0 && report.warnings === 0 && (
          <span className="badge ok">没有问题</span>
        )}
        {hasChecked && report.errors > 0 && (
          <span className="badge error">必须修复 {report.errors}</span>
        )}
        {hasChecked && report.warnings > 0 && (
          <span className="badge warn">建议检查 {report.warnings}</span>
        )}

        <span className="spacer" />

        <button
          type="button"
          className="mini"
          title={collapsed ? '展开校验结果' : '收起校验结果'}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? '展开 ▲' : '收起 ▼'}
        </button>
      </div>

      {hasIssues && !collapsed && (
        <ul className="issue-list">
          {report.issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.targetId}-${index}`} className={issue.level}>
              <button
                type="button"
                className="issue-row"
                title="点一下跳到这一段"
                onClick={() => onJumpToIssue(issue)}
              >
                <span className="target">{issue.targetId || '(空)'}</span>
                <span className="where">{issue.where}</span>
                <span className="msg">{issue.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasIssues && collapsed && (
        <div className="issues-hint">
          共 {report.issues.length} 条问题（{report.errors} 个错误 / {report.warnings} 条建议），已收起
        </div>
      )}
    </section>
  );
}

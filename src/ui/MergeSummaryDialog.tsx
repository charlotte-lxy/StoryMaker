import type { Patch } from '../core/collab/protocol';
import type { Project } from '../core/types';
import { describePatchLocation, describePatchValue, patchKindLabel } from './collab-labels';

interface Props {
  project: Project;
  patches: Patch[];
  onClose: () => void;
}

/**
 * 合并摘要：这次连上之后，对方带来了哪些改动。
 *
 * 为什么需要它：没有冲突的时候合并是完全静默的，用户根本不知道别人的改动什么时候
 * 进了自己的项目——章节变了、行没了，都毫无提示。这个框就是把那件事说出来。
 *
 * 只读，不提供任何选择：冲突那些该选的已经在冲突面板里选过了，这里只是"告知"。
 */
export function MergeSummaryDialog({ project, patches, onClose }: Props) {
  return (
    <div className="modal-mask">
      <div className="modal conflict-modal summary-modal" role="dialog" aria-modal="true">
        <header>已从对方同步 {patches.length} 处改动</header>
        <div className="modal-body">
          <p className="collab-note">这些是对方那边的变化，已经并进你的项目了。</p>
          <div className="conflict-scroll">
            <table className="conflict-table">
              <thead>
                <tr>
                  <th>位置</th>
                  <th>类型</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {patches.map((patch, index) => (
                  <tr key={`${patch.kind}-${index}`}>
                    <td className="conflict-where">{describePatchLocation(project, patch)}</td>
                    <td className="summary-kind">{patchKindLabel(patch)}</td>
                    <td>{describePatchValue(project, patch)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <footer>
          <button type="button" className="primary" autoFocus onClick={onClose}>
            知道了
          </button>
        </footer>
      </div>
    </div>
  );
}

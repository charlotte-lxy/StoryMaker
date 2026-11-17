import { useMemo, useState } from 'react';

/**
 * 目录树选择弹窗：从 Content（/Game）开始，点一个文件夹当类名前缀。
 *
 * 前缀不能手填之后就得让人能选到具体目录，但 Unreal 的路径不是本机磁盘路径，
 * 调不出系统文件夹框，所以自己画一棵树——数据来自编辑器里 list_assets 的文件夹清单。
 */

interface FolderNode {
  path: string;
  name: string;
  children: FolderNode[];
}

/** 把扁平路径列表变成树；父目录一定排在子目录前面（先排序再挂） */
export function buildFolderTree(folders: readonly string[]): FolderNode {
  const root: FolderNode = { path: '/Game', name: '/Game', children: [] };
  const index = new Map<string, FolderNode>([['/Game', root]]);

  const paths = [...new Set(folders.map((folder) => folder.replace(/\/+$/, '')))]
    .filter((folder) => folder !== '' && folder !== '/Game')
    .sort();

  for (const path of paths) {
    const slash = path.lastIndexOf('/');
    const parentPath = slash <= 0 ? '/Game' : path.slice(0, slash);
    const parent = index.get(parentPath) ?? root;
    const node: FolderNode = { path, name: path.slice(slash + 1), children: [] };
    parent.children.push(node);
    index.set(path, node);
  }

  return root;
}

interface Props {
  folders: readonly string[];
  /** 当前已经配好的前缀对应的文件夹（用来默认选中） */
  initialPath?: string;
  onPick: (folderPath: string) => void;
  onCancel: () => void;
}

export function FolderTreeDialog({ folders, initialPath, onPick, onCancel }: Props) {
  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const [picked, setPicked] = useState(initialPath ?? '');
  const [open, setOpen] = useState<Set<string>>(() => new Set(['/Game']));

  const toggle = (path: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (node: FolderNode, depth: number): React.ReactNode => {
    const expanded = open.has(node.path);
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.path}>
        <div className="folder-row" style={{ paddingLeft: depth * 16 }}>
          {hasChildren ? (
            <button
              type="button"
              className="folder-toggle"
              onClick={() => toggle(node.path)}
              title={expanded ? '收起' : '展开'}
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="folder-toggle" />
          )}
          <button
            type="button"
            className={picked === node.path ? 'folder-name active' : 'folder-name'}
            onClick={() => setPicked(node.path)}
            title={node.path}
          >
            {depth === 0 ? 'Content（/Game）' : node.name}
          </button>
        </div>
        {expanded && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div
        className="modal folder-tree-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header>选择文件夹</header>
        <div className="modal-body">
          <p className="hint">前缀会拼成 /Script/Engine.BlueprintGeneratedClass&apos;&lt;选中的文件夹&gt;/</p>
          <div className="folder-tree">{renderNode(tree, 0)}</div>
          <div className="hint">当前选择：{picked === '' ? '还没选' : picked}</div>
        </div>
        <footer>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={picked === ''}
            onClick={() => onPick(picked)}
          >
            用这个文件夹
          </button>
        </footer>
      </div>
    </div>
  );
}

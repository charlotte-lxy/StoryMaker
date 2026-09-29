interface Props {
  /** 服务端上那份的项目标识（文件名） */
  foreignName: string;
  /** 本机现在打开的那份 */
  localName: string;
  /** 把服务端那份拉下来存成新文件，然后切过去用它 */
  onAdopt: () => void;
  /** 继续用本机这份（这一次不同步） */
  onKeep: () => void;
}

/**
 * 服务端上挂着另一个项目。
 *
 * 服务端不分房间，所以两台机器各开着不同的项目、连到同一个端口时一定会遇到。
 * 不能默默合并——那是两份不同的东西，硬合只会两败俱伤。所以摆出来让人定：
 * 要么把服务端那份拉下来另存成新文件用，要么继续用自己这份。
 */
export function ForeignProjectDialog({ foreignName, localName, onAdopt, onKeep }: Props) {
  return (
    <div className="modal-mask">
      <div className="modal confirm-modal foreign-project-modal" role="dialog" aria-modal="true">
        <header>服务端上是另一份项目</header>
        <div className="modal-body">
          <p>
            服务端上挂着的是 <strong>{foreignName}</strong>，你这边打开的是{' '}
            <strong>{localName}</strong>，两份不是同一个文件。
          </p>
          <p className="collab-note">
            两边内容不会混在一起（标识对不上的消息都不理会）。你可以把服务端那份拉下来，
            存成一个新文件再切过去用它。
          </p>
        </div>
        <footer>
          <button type="button" onClick={onKeep}>
            继续用我这份
          </button>
          <button type="button" className="primary" onClick={onAdopt}>
            拉取服务端那份
          </button>
        </footer>
      </div>
    </div>
  );
}

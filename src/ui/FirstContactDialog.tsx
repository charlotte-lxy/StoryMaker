import type { FirstContactChoice } from '../core/collab/resolve';

interface Props {
  /** 本机这份项目的名字，让用户知道自己在拿哪份跟服务端比 */
  localName: string;
  onChoose: (choice: FirstContactChoice) => void;
}

/**
 * 首次对账：服务端已经有一份内容，本机也有一份，而两边没有共同起点。
 *
 * 这种情况下做不到三方合并——没有基准就无从判断"对方这条改动是不是改在我这份的基础上"。
 * 所以不猜，摆四个选项让人选。这个框本身就是一次确认，不再套二次确认。
 */
export function FirstContactDialog({ localName, onChoose }: Props) {
  return (
    <div className="modal-mask">
      <div className="modal confirm-modal first-contact-modal" role="dialog" aria-modal="true">
        <header>服务端已经有一份项目</header>
        <div className="modal-body">
          <p>
            服务端那边已经有一份内容，而本机这份（<strong>{localName}</strong>）还没和任何人
            同步过，两边找不到共同起点，没法自动合并。
          </p>
          <p className="collab-note">选哪一份，另一份都不会被删掉——被舍弃的那份会另存一份备份文件。</p>
        </div>
        <footer className="collab-choice-buttons">
          <button type="button" onClick={() => onChoose('remote')}>
            用服务端那份
          </button>
          <button type="button" onClick={() => onChoose('local')}>
            用本机这份
          </button>
          <button type="button" onClick={() => onChoose('both')}>
            两份都保留
          </button>
          <button type="button" onClick={() => onChoose('later')}>
            先不同步
          </button>
        </footer>
      </div>
    </div>
  );
}

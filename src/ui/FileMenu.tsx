import { useState } from 'react';

interface Props {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
}

/**
 * 标题栏左上的「文件」菜单。
 *
 * 四个文件操作原来平铺在标题栏上，占了小半条；收进菜单之后中间才能腾出
 * 一整块地方给全局搜索框。点菜单项就顺手把菜单收起来。
 */
export function FileMenu({ onNew, onOpen, onSave, onSaveAs }: Props) {
  const [open, setOpen] = useState(false);

  const items = [
    { key: 'new', label: '新建', hint: '换一个项目文件，从头开始', run: onNew },
    { key: 'open', label: '打开项目', hint: '打开磁盘上已有的项目 JSON', run: onOpen },
    { key: 'save', label: '保存', hint: '把当前内容写回项目文件（平时会自动保存）', run: onSave },
    { key: 'saveAs', label: '另存为', hint: '换一个文件存，之后的改动都写进新文件', run: onSaveAs },
  ];

  return (
    <div className="file-menu">
      <button
        type="button"
        className={open ? 'file-menu-button active' : 'file-menu-button'}
        title="项目文件：新建 / 打开 / 保存 / 另存为"
        onClick={() => setOpen((current) => !current)}
      >
        文件 ▾
      </button>

      {open && (
        <>
          <div className="file-mask" onClick={() => setOpen(false)} />
          <div className="file-pop">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className="file-item"
                title={item.hint}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

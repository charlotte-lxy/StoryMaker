import { useState } from 'react';

interface Props {
  /** 已经选中的名字 */
  values: string[];
  /** 候选名字，来自对应的表 */
  options: string[];
  /** 一个都没选时按钮上显示的字 */
  placeholder: string;
  title?: string;
  onChange: (next: string[]) => void;
}

/**
 * 多选下拉：按钮上显示已选的名字，点开是勾选清单。
 *
 * 不用 <select multiple>：它要按住 Ctrl 点，策划用起来容易漏选、也看不出选了什么。
 * 已经不在候选里的名字（比如引用的技能被删了）也会列出来并标出来，方便取消勾选。
 */
export function MultiSelect({ values, options, placeholder, title, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const missing = values.filter((value) => !options.includes(value));

  const toggle = (name: string): void => {
    onChange(values.includes(name) ? values.filter((item) => item !== name) : [...values, name]);
  };

  return (
    <div className="multi-select">
      <button
        type="button"
        className="multi-toggle"
        title={title ?? '点开勾选'}
        onClick={() => setOpen((current) => !current)}
      >
        {values.length === 0 ? (
          <span className="multi-placeholder">{placeholder}</span>
        ) : (
          <span className="multi-values">{values.join('、')}</span>
        )}
        <span className="multi-caret">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          <div className="multi-mask" onClick={() => setOpen(false)} />
          <div className="multi-menu">
            {options.length === 0 && missing.length === 0 ? (
              <div className="multi-empty">这张表里还没有条目</div>
            ) : (
              <>
                {options.map((name) => (
                  <label key={name} className="multi-option">
                    <input
                      type="checkbox"
                      checked={values.includes(name)}
                      onChange={() => toggle(name)}
                    />
                    <span>{name}</span>
                  </label>
                ))}
                {missing.map((name) => (
                  <label key={name} className="multi-option missing" title="这个引用已经不在表里了">
                    <input type="checkbox" checked onChange={() => toggle(name)} />
                    <span>{name}（已不在表里）</span>
                  </label>
                ))}
              </>
            )}

            {values.length > 0 && (
              <button type="button" className="mini multi-clear" onClick={() => onChange([])}>
                清空选择
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

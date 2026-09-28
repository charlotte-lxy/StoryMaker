import type { GasPair } from '../../core/types';

interface Props {
  pairs: GasPair[];
  /** 有候选时，左边那一格做成下拉（角色预设的属性名就是这样） */
  keyOptions?: string[];
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  onAdd: () => void;
  onRemove: (pairUid: string) => void;
  onUpdate: (pairUid: string, patch: Partial<GasPair>) => void;
}

/**
 * 键值对列表：「名字 = 值」，技能的参数赋值与角色预设的属性数值共用。
 *
 * 名字那格既可以手填（技能的参数名），也可以是从某张表里选（角色的属性名）。
 */
export function PairList({
  pairs,
  keyOptions,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  onAdd,
  onRemove,
  onUpdate,
}: Props) {
  return (
    <div className="pair-list">
      {pairs.map((pair) => {
        const keyMissing =
          keyOptions !== undefined && pair.key.trim() !== '' && !keyOptions.includes(pair.key.trim());
        return (
          <div className="pair-row" key={pair.uid}>
            {keyOptions === undefined ? (
              <input
                value={pair.key}
                placeholder={keyPlaceholder}
                onChange={(event) => onUpdate(pair.uid, { key: event.target.value })}
              />
            ) : (
              <select
                className={keyMissing ? 'missing' : ''}
                value={pair.key}
                title={keyMissing ? '这个属性已经不在属性表里了' : keyPlaceholder}
                onChange={(event) => onUpdate(pair.uid, { key: event.target.value })}
              >
                <option value="">（{keyPlaceholder}）</option>
                {keyOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                {keyMissing && <option value={pair.key}>{pair.key}（已不在表里）</option>}
              </select>
            )}

            <span className="pair-equals">=</span>

            <input
              value={pair.value}
              placeholder={valuePlaceholder}
              onChange={(event) => onUpdate(pair.uid, { value: event.target.value })}
            />

            <button type="button" className="mini danger" title="删除这一条" onClick={() => onRemove(pair.uid)}>
              ×
            </button>
          </div>
        );
      })}

      <button type="button" className="option-add" onClick={onAdd}>
        {addLabel}
      </button>
    </div>
  );
}

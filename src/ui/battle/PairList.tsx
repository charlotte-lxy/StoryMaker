import { looksLikeUid } from '../../core/refs';
import type { GasPair } from '../../core/types';

interface Props {
  pairs: GasPair[];
  /**
   * 左边那一格做成下拉时给的候选：值是那一行的 uid，标签是给人看的名字。
   *
   * 角色预设的属性列表用它（存属性 uid，改属性名不会断）；
   * 技能的参数赋值不给候选，那一格是手填的参数名（不是引用）。
   */
  keyOptions?: { value: string; label: string }[];
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
 * 名字那格既可以手填（技能的参数名），也可以是从某张表里选（角色的属性）。
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
        const ref = pair.key.trim();
        const keyMissing =
          keyOptions !== undefined &&
          ref !== '' &&
          !keyOptions.some((item) => item.value === ref);
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
                value={ref}
                title={keyMissing ? '这个属性已经不在属性表里了' : keyPlaceholder}
                onChange={(event) => onUpdate(pair.uid, { key: event.target.value })}
              >
                <option value="">（{keyPlaceholder}）</option>
                {keyOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
                {keyMissing && (
                  <option value={ref}>
                    {looksLikeUid(ref) ? '（已不在表里的属性）' : `${ref}（已不在表里）`}
                  </option>
                )}
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

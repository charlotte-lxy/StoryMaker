import { MODIFIER_DURATIONS, MODIFIER_OPERATORS } from '../../core/battle';
import type { GasModifier } from '../../core/types';

interface Props {
  modifiers: GasModifier[];
  /** 属性名候选，从属性表来 */
  attributes: string[];
  onAdd: () => void;
  onRemove: (modifierUid: string) => void;
  onUpdate: (modifierUid: string, patch: Partial<GasModifier>) => void;
}

/**
 * 修改器列表：一条 =「持续类型 # 属性名 运算符 值」。
 *
 * 持续类型、属性名、运算符都是下拉，值留给策划手填（GA 参数名或固定值）。
 * 刚开始一条都没有，只显示「＋ 添加修改器」。
 */
export function ModifierList({ modifiers, attributes, onAdd, onRemove, onUpdate }: Props) {
  return (
    <div className="modifier-list">
      {modifiers.map((modifier) => {
        const attributeMissing =
          modifier.attribute.trim() !== '' && !attributes.includes(modifier.attribute.trim());
        return (
          <div className="modifier-row" key={modifier.uid}>
            <select
              value={modifier.duration}
              title="持续类型"
              onChange={(event) => onUpdate(modifier.uid, { duration: event.target.value })}
            >
              {MODIFIER_DURATIONS.map((duration) => (
                <option key={duration} value={duration}>
                  {duration}
                </option>
              ))}
            </select>

            <span className="modifier-hash">#</span>

            <select
              className={attributeMissing ? 'missing' : ''}
              value={modifier.attribute}
              title={attributeMissing ? '这个属性已经不在属性表里了' : '属性名'}
              onChange={(event) => onUpdate(modifier.uid, { attribute: event.target.value })}
            >
              <option value="">（选属性）</option>
              {attributes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {attributeMissing && <option value={modifier.attribute}>{modifier.attribute}（已不在表里）</option>}
            </select>

            <select
              value={modifier.operator}
              title="运算符"
              onChange={(event) => onUpdate(modifier.uid, { operator: event.target.value })}
            >
              {MODIFIER_OPERATORS.map((operator) => (
                <option key={operator} value={operator}>
                  {operator}
                </option>
              ))}
            </select>

            <input
              value={modifier.value}
              placeholder="参数名或数值"
              title="GA 参数名或固定值，如 Damage、40"
              onChange={(event) => onUpdate(modifier.uid, { value: event.target.value })}
            />

            <button type="button" className="mini danger" title="删除这个修改器" onClick={() => onRemove(modifier.uid)}>
              ×
            </button>
          </div>
        );
      })}

      <button type="button" className="option-add" onClick={onAdd}>
        ＋ 添加修改器
      </button>
    </div>
  );
}

import { MODIFIER_DURATIONS, MODIFIER_OPERATORS } from '../../core/battle';
import { looksLikeUid } from '../../core/refs';
import type { GasModifier } from '../../core/types';

/** 属性候选：值是属性表那一行的 uid，标签是属性名 */
export interface AttributeOption {
  value: string;
  label: string;
}

interface Props {
  modifiers: GasModifier[];
  /** 属性候选，从属性表来 */
  attributes: AttributeOption[];
  onAdd: () => void;
  onRemove: (modifierUid: string) => void;
  onUpdate: (modifierUid: string, patch: Partial<GasModifier>) => void;
}

/**
 * 修改器列表：一条 =「持续类型 # 属性名 运算符 值」。
 *
 * 属性那一格存的是属性表的 uid：在属性表里改名不会把这条修改器写坏，
 * 导出时才按 uid 取回属性名合成 Tag。
 * 持续类型、属性名、运算符都是下拉，值留给策划手填（GA 参数名或固定值）。
 * 刚开始一条都没有，只显示「＋ 添加修改器」。
 */
export function ModifierList({ modifiers, attributes, onAdd, onRemove, onUpdate }: Props) {
  return (
    <div className="modifier-list">
      {modifiers.map((modifier) => {
        const ref = modifier.attributeUid.trim();
        const missing = ref !== '' && !attributes.some((item) => item.value === ref);
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
              className={missing ? 'missing' : ''}
              value={ref}
              title={missing ? '这个属性已经不在属性表里了' : '属性名'}
              onChange={(event) => onUpdate(modifier.uid, { attributeUid: event.target.value })}
            >
              <option value="">（选属性）</option>
              {attributes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
              {/* 老数据 / 被删掉的那一条：原样列出来，好让人改回去。
                  uid 读不出是哪一条，就别把乱码摆出来 */}
              {missing && (
                <option value={ref}>{looksLikeUid(ref) ? '（已不在表里的属性）' : `${ref}（已不在表里）`}</option>
              )}
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

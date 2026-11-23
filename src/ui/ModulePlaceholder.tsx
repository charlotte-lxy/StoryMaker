import type { ReactNode } from 'react';

import type { ModuleDef } from '../core/modules';

/**
 * MCR（Godot）模块的占位页。
 *
 * 这一期只把模块入口、开关和引擎归属做出来；每个模块的表结构与界面等它自己开工时再补。
 * 占位页写清两件事：这里以后放什么、数据跟 Unreal 那边的同名模块是分开的。
 */
export function ModulePlaceholder({ module }: { module: ModuleDef }): ReactNode {
  return (
    <div className="editor">
      <div className="editor-head">
        <h2>{module.label}</h2>
        <span className="hint">功能还没做</span>
      </div>
      <div className="empty-state">
        「{module.label}」是 Godot（MCR）项目专用的数据模块，和 Unreal 那边同名模块的表是分开的。
        具体字段与界面等这个模块开工时再补；暂时用不上可以在「设置 → 模块」里把它关掉。
      </div>
    </div>
  );
}

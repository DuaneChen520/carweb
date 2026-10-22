/**
 * PaneSelector —— 全屏→分屏的选 pane + 覆盖确认子菜单。
 *
 * 设计文档 §4.2：
 * 「分屏」点击后弹子菜单，展示左右 pane 当前状态：
 * - 来源 pane 选项：显示 app 图标 + "恢复"标签，点击直接恢复，无确认
 * - 另一 pane 选项：显示当前 app 图标（若有）或"空闲"
 *   - 有 app 时弹覆盖确认："覆盖将关闭 xx 应用" → 确认/取消
 *   - 空闲时直接放入
 *
 * 覆盖语义（§4.3）：覆盖 = 关闭（force-stop + 销毁 session）。
 * 用户主动选的，音乐 app 被覆盖就断音乐。
 */

import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import type { AppInstance, PaneSlot } from '@/lib/session-manager';
import { useAppDisplayName } from '@/lib/useAppDisplayName';

interface PaneSelectorProps {
  /** 当前全屏 app 的来源 pane（若来自 pane） */
  sourcePane?: PaneSlot;
  /** 左 pane 的 app（若有） */
  leftApp: AppInstance | null;
  /** 右 pane 的 app（若有） */
  rightApp: AppInstance | null;
  /** 选中 pane 的回调 */
  onSelect: (pane: PaneSlot) => void;
  /** 取消 */
  onCancel: () => void;
}

export function PaneSelector({ sourcePane, leftApp, rightApp, onSelect, onCancel }: PaneSelectorProps) {
  const [confirmPane, setConfirmPane] = useState<PaneSlot | null>(null);

  // ADR-0012：按包名渲染时解析显示名（左/右各一条，避免拆分缩写兜底）
  const leftName = useAppDisplayName(leftApp?.packageName);
  const rightName = useAppDisplayName(rightApp?.packageName);

  const handleSelect = (pane: PaneSlot) => {
    // 来源 pane：直接恢复，无确认
    if (pane === sourcePane) {
      onSelect(pane);
      return;
    }

    // 另一 pane：有 app 时弹覆盖确认，空闲时直接放入
    const targetApp = pane === 'left' ? leftApp : rightApp;
    if (targetApp) {
      setConfirmPane(pane);
    } else {
      onSelect(pane);
    }
  };

  const handleConfirm = () => {
    if (confirmPane) {
      onSelect(confirmPane);
    }
  };

  const renderPaneOption = (pane: PaneSlot) => {
    const isSource = pane === sourcePane;
    const displayName = pane === 'left' ? leftName : rightName;

    return (
      <button
        key={pane}
        onClick={() => handleSelect(pane)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors text-left"
      >
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-700">
            {pane === 'left' ? '左分屏' : '右分屏'}
          </div>
          <div className="text-xs text-slate-500 truncate">{displayName}</div>
        </div>
        {isSource && (
          <span className="text-xs text-accent-600 flex items-center gap-1">
            <Check size={12} />
            恢复
          </span>
        )}
      </button>
    );
  };

  // 覆盖确认状态
  if (confirmPane) {
    const targetName = confirmPane === 'left' ? leftName : rightName;

    return (
      <div className="p-3">
        <div className="flex items-center gap-2 mb-3 text-amber-600">
          <AlertTriangle size={16} />
          <span className="text-sm font-medium">覆盖确认</span>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          覆盖到{confirmPane === 'left' ? '左' : '右'}分屏将关闭
          <span className="font-medium text-slate-800"> {targetName} </span>
          应用。
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setConfirmPane(null)}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-slate-100 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            确认覆盖
          </button>
        </div>
      </div>
    );
  }

  // pane 选择列表
  return (
    <div className="p-2 min-w-[200px]">
      <div className="text-xs text-slate-400 px-3 py-1 mb-1">选择分屏位置</div>
      {renderPaneOption('left')}
      {renderPaneOption('right')}
      <div className="mt-1 pt-1 border-t border-slate-100">
        <button
          onClick={onCancel}
          className="w-full px-3 py-1.5 text-sm text-slate-500 rounded-lg hover:bg-slate-100 transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
}

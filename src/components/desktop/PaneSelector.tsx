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
        type="button"
        onClick={() => handleSelect(pane)}
        className="w-full flex items-center justify-between gap-3 min-h-[48px] px-3.5 py-2.5 rounded-xl hover:bg-surface-hover/80 active:scale-[0.98] transition-all text-left cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-content-primary">
            {pane === 'left' ? '左分屏' : '右分屏'}
          </div>
          <div className="text-xs text-content-secondary truncate">{displayName}</div>
        </div>
        {isSource && (
          <span className="text-xs text-accent-400 font-medium flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-md bg-accent-500/20 border border-accent-500/30">
            <Check size={14} />
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
      <div className="p-3.5 min-w-[240px]">
        <div className="flex items-center gap-2 mb-2 text-amber-400">
          <AlertTriangle size={18} />
          <span className="text-sm font-semibold text-content-primary">覆盖确认</span>
        </div>
        <p className="text-sm text-content-secondary mb-4 leading-relaxed">
          覆盖到{confirmPane === 'left' ? '左' : '右'}分屏将关闭
          <span className="font-semibold text-content-primary"> {targetName} </span>
          应用。
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setConfirmPane(null)}
            className="min-h-[48px] px-4 text-sm font-medium rounded-xl text-content-secondary hover:text-content-primary hover:bg-surface-hover/80 transition-all cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="min-h-[48px] px-4 text-sm font-medium rounded-xl bg-feedback-danger/20 text-red-400 hover:bg-feedback-danger/30 border border-feedback-danger/30 transition-all active:scale-95 cursor-pointer"
          >
            确认覆盖
          </button>
        </div>
      </div>
    );
  }

  // pane 选择列表
  return (
    <div className="p-2 min-w-[240px] space-y-1">
      <div className="text-xs text-content-muted font-medium px-3 py-1.5 mb-1">选择分屏位置</div>
      {renderPaneOption('left')}
      {renderPaneOption('right')}
      <div className="mt-1 pt-1 border-t border-surface-card/60">
        <button
          type="button"
          onClick={onCancel}
          className="w-full flex items-center justify-center min-h-[48px] px-3 py-2 text-sm font-medium text-content-muted hover:text-content-primary hover:bg-surface-hover/80 rounded-xl transition-all cursor-pointer"
        >
          取消
        </button>
      </div>
    </div>
  );
}

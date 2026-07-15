/**
 * PaneEmptyState —— 空 pane 的中央占位状态。
 *
 * 设计文档 §11：两 pane 都空时，每个 pane 正中显示：
 * - App 图标占位（虚线框）
 * - 文案"点击打开应用"
 * - 点击 → 弹出"全部应用"浮窗（pane 模式），选中后在该 pane 启动
 */

import { Plus } from 'lucide-react';

interface PaneEmptyStateProps {
  onClick: () => void;
}

export function PaneEmptyState({ onClick }: PaneEmptyStateProps) {
  return (
    <button
      type="button"
      className="w-full h-full flex items-center justify-center cursor-pointer group focus-visible:outline-none"
      onClick={onClick}
      aria-label="点击打开应用"
    >
      <div className="text-center text-slate-500 transition-colors group-hover:text-slate-300">
        <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-white/15 mx-auto mb-3 flex items-center justify-center transition-all duration-200 group-hover:border-accent-400 group-hover:bg-accent-500/10 group-hover:-translate-y-0.5 group-hover:shadow-card group-focus-visible:border-accent-400 group-focus-visible:ring-2 group-focus-visible:ring-accent-400/40">
          <Plus className="w-6 h-6 text-slate-500 transition-colors group-hover:text-accent-400" />
        </div>
        <p className="text-sm font-medium text-slate-400">点击打开应用</p>
      </div>
    </button>
  );
}

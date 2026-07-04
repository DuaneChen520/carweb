/**
 * PaneEmptyState —— 空 pane 的中央占位状态。
 *
 * 设计文档 §11：两 pane 都空时，每个 pane 正中显示：
 * - App 图标占位（虚线框）
 * - 文案"点击打开应用"
 * - 点击 → 弹出"全部应用"浮窗（pane 模式），选中后在该 pane 启动
 */

interface PaneEmptyStateProps {
  onClick: () => void;
}

export function PaneEmptyState({ onClick }: PaneEmptyStateProps) {
  return (
    <div
      className="w-full h-full flex items-center justify-center cursor-pointer group"
      onClick={onClick}
    >
      <div className="text-center text-slate-400 transition-colors group-hover:text-slate-500">
        <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-slate-300 mx-auto mb-3 flex items-center justify-center group-hover:border-slate-400 transition-colors" />
        <p className="text-sm">点击打开应用</p>
      </div>
    </div>
  );
}

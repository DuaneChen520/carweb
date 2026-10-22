/**
 * TopBarActionButton —— 顶部控件栏动作按钮。
 *
 * 样式与 TopBarHandle（上下拉按钮）完全统一（第六轮反馈 2026-08-04）：
 * 无底色、白色/强调色图标 + 双层 drop-shadow 保证深浅画面可见、active 缩放反馈。
 * 危险操作（关闭）为红色系图标，其余样式一致。48×48 触控目标，aria-label 必填。
 */
import type { LucideIcon } from 'lucide-react';

interface TopBarActionButtonProps {
  icon: LucideIcon;
  /** 无障碍标签（触屏无 title，必须提供） */
  label: string;
  onClick: () => void;
  /** 危险操作（关闭）：红色系区分 */
  danger?: boolean;
}

export function TopBarActionButton({ icon: Icon, label, onClick, danger }: TopBarActionButtonProps) {
  const tone = danger
    ? 'text-red-400 active:text-red-300'
    : 'text-content-primary active:text-content-secondary';

  // danger（关闭）用红色系阴影，红色图标 + 红晕在深浅画面上都清晰；其余按钮黑色双影
  const shadow = danger
    ? 'drop-shadow-[0_2px_4px_rgba(239,68,68,0.7)] drop-shadow-[0_0_10px_rgba(239,68,68,0.35)]'
    : 'drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)] drop-shadow-[0_0_8px_rgba(0,0,0,0.45)]';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        'relative flex items-center justify-center w-12 h-12 rounded-full shrink-0',
        'transition-all touch-manipulation active:scale-95 cursor-pointer',
        shadow,
        tone,
      ].join(' ')}
    >
      <Icon size={20} aria-hidden />
    </button>
  );
}

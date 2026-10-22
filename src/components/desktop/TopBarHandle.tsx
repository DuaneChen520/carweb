/**
 * TopBarHandle —— 顶部控件栏的折叠/展开统一把手。
 *
 * 折叠态（ChevronDown）与展开态（ChevronUp）共用同一组件、同一尺寸、同一锚点，
 * 保证两态图标样式与大小完全一致（用户反馈 2026-08-04）。
 * 无底色，仅图标 + 双层 drop-shadow，深浅画面均可见、不遮挡画面。
 * 触控热区 48×48，active 缩放反馈，aria-label / aria-expanded 齐备。
 */
import type { LucideIcon } from 'lucide-react';

interface TopBarHandleProps {
  icon: LucideIcon;
  /** 无障碍标签（触屏无 title，必须提供） */
  label: string;
  /** 控件栏当前是否处于展开态 */
  expanded: boolean;
  onClick: () => void;
}

export function TopBarHandle({ icon: Icon, label, expanded, onClick }: TopBarHandleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      className="pointer-events-auto relative flex items-center justify-center w-12 h-12 rounded-full shrink-0
                 text-content-primary transition-all touch-manipulation cursor-pointer
                 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)] drop-shadow-[0_0_8px_rgba(0,0,0,0.45)]
                 active:scale-95 active:text-content-secondary"
    >
      <Icon size={28} aria-hidden />
    </button>
  );
}

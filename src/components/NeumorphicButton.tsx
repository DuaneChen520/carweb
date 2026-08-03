import { useState } from 'react';

// S3-P0-1（车机触控优化）：触控目标 36px → 48px（Material 无障碍下限）
const BTN = 48;
// 图标 16 → 20px（AAOS 次图标档，居中于 48px 触控区）
export const ICON_SIZE = 20;

interface NeumorphicButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  toggled?: boolean;
  title?: string;
  /** 无障碍标签（可选）：透传 aria-label，用于顶部栏等触控场景 */
  ariaLabel?: string;
  color?: string;
  activeColor?: string;
  toggledColor?: string;
  disabled?: boolean;
  /** 暗色变体：切换为深色背景 + 适配车机驾驶舱暗主题。默认 light 向后兼容。 */
  variant?: 'light' | 'dark';
}

export function NeumorphicButton({
  children, onClick, toggled, title, ariaLabel, color: explicitColor, activeColor: explicitActiveColor, toggledColor: explicitToggledColor, disabled, variant = 'light',
}: NeumorphicButtonProps) {
  const [active, setActive] = useState(false);

  // 暗色变体默认值：浅底 #eaeaea → 深底 #1e293b，浅灰图标 → slate-400
  const isDark = variant === 'dark';
  const color = explicitColor ?? (isDark ? '#94a3b8' : '#666');
  const activeColor = explicitActiveColor ?? (isDark ? '#7f8ea3' : '#555');
  const toggledColor = explicitToggledColor ?? (isDark ? '#e2e8f0' : '#444');
  const bg = isDark ? '#1e293b' : '#eaeaea';

  const s = (v: number) => v * BTN / 68.8;

  // 暗色 neumorphic 阴影：降低白色高光强度、加深深色下沉阴影
  const darkRestShadow = [
    `0 ${s(10)}px ${s(18)}px -${s(3)}px rgba(0,0,0,0.6)`,
    `inset 0 -${s(3)}px ${s(4)}px -${s(1)}px rgba(0,0,0,0.35)`,
    `0 -${s(10)}px ${s(15)}px -${s(1)}px rgba(255,255,255,0.06)`,
    `inset 0 ${s(3)}px ${s(4)}px -${s(1)}px rgba(255,255,255,0.04)`,
    `inset 0 0 ${s(5)}px ${s(1)}px rgba(255,255,255,0.04)`,
    `inset 0 ${s(20)}px ${s(30)}px 0 rgba(255,255,255,0.02)`,
  ].join(', ');

  const darkActiveShadow = [
    `0 ${s(8)}px ${s(18)}px -${s(3)}px rgba(0,0,0,0.5)`,
    `inset 0 -${s(8)}px ${s(30)}px ${s(1)}px rgba(255,255,255,0.04)`,
    `0 -${s(10)}px ${s(15)}px -${s(1)}px rgba(255,255,255,0.06)`,
    `inset 0 ${s(8)}px ${s(25)}px 0 rgba(0,0,0,0.5)`,
    `inset 0 0 ${s(10)}px ${s(1)}px rgba(255,255,255,0.04)`,
  ].join(', ');

  const darkCheckedShadow = [
    `0 ${s(7)}px ${s(18)}px -${s(3)}px rgba(0,0,0,0.5)`,
    `inset 0 -${s(8)}px ${s(25)}px -${s(1)}px rgba(255,255,255,0.04)`,
    `0 -${s(10)}px ${s(15)}px -${s(1)}px rgba(255,255,255,0.06)`,
    `inset 0 ${s(8)}px ${s(20)}px 0 rgba(0,0,0,0.3)`,
    `inset 0 0 ${s(5)}px ${s(1)}px rgba(255,255,255,0.04)`,
  ].join(', ');

  const lightRestShadow = [
    `0 ${s(10)}px ${s(18)}px -${s(3)}px rgba(0,0,0,0.5)`,
    `inset 0 -${s(3)}px ${s(4)}px -${s(1)}px rgba(0,0,0,0.2)`,
    `0 -${s(10)}px ${s(15)}px -${s(1)}px rgba(255,255,255,0.6)`,
    `inset 0 ${s(3)}px ${s(4)}px -${s(1)}px rgba(255,255,255,0.2)`,
    `inset 0 0 ${s(5)}px ${s(1)}px rgba(255,255,255,0.8)`,
    `inset 0 ${s(20)}px ${s(30)}px 0 rgba(255,255,255,0.2)`,
  ].join(', ');

  const lightActiveShadow = [
    `0 ${s(8)}px ${s(18)}px -${s(3)}px rgba(0,0,0,0.4)`,
    `inset 0 -${s(8)}px ${s(30)}px ${s(1)}px rgba(255,255,255,0.9)`,
    `0 -${s(10)}px ${s(15)}px -${s(1)}px rgba(255,255,255,0.6)`,
    `inset 0 ${s(8)}px ${s(25)}px 0 rgba(0,0,0,0.4)`,
    `inset 0 0 ${s(10)}px ${s(1)}px rgba(255,255,255,0.6)`,
  ].join(', ');

  const lightCheckedShadow = [
    `0 ${s(7)}px ${s(18)}px -${s(3)}px rgba(0,0,0,0.4)`,
    `inset 0 -${s(8)}px ${s(25)}px -${s(1)}px rgba(255,255,255,0.9)`,
    `0 -${s(10)}px ${s(15)}px -${s(1)}px rgba(255,255,255,0.6)`,
    `inset 0 ${s(8)}px ${s(20)}px 0 rgba(0,0,0,0.2)`,
    `inset 0 0 ${s(5)}px ${s(1)}px rgba(255,255,255,0.6)`,
  ].join(', ');

  const getShadow = () => {
    const shadows = isDark
      ? { active: darkActiveShadow, checked: darkCheckedShadow, rest: darkRestShadow }
      : { active: lightActiveShadow, checked: lightCheckedShadow, rest: lightRestShadow };
    if (active) return shadows.active;
    if (toggled) return shadows.checked;
    return shadows.rest;
  };

  const iconColor = active ? activeColor : toggled ? toggledColor : color;

  return (
    <button
      onClick={disabled ? undefined : onClick}
      // S3-P0-2：按压反馈改 Pointer 事件（触屏可用、无合成 mouse 延迟）；
      // pointercancel 兜底，拖出按钮后释放按压态
      onPointerDown={() => !disabled && setActive(true)}
      onPointerUp={() => setActive(false)}
      onPointerLeave={() => setActive(false)}
      onPointerCancel={() => setActive(false)}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      style={{
        transition: 'all 300ms cubic-bezier(0.23, 1, 0.32, 1)',
        boxShadow: getShadow(),
        borderRadius: BTN / 2,
        background: bg,
        height: BTN,
        width: BTN,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        outline: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: iconColor,
        flexShrink: 0,
        opacity: disabled ? 0.3 : 1,
      }}
    >
      {children}
    </button>
  );
}

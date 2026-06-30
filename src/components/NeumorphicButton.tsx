import { useState } from 'react';

const BTN = 36;
export const ICON_SIZE = 16;

interface NeumorphicButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  toggled?: boolean;
  title?: string;
  color?: string;
  activeColor?: string;
  toggledColor?: string;
  disabled?: boolean;
}

export function NeumorphicButton({
  children, onClick, toggled, title, color = '#666', activeColor = '#555', toggledColor = '#444', disabled,
}: NeumorphicButtonProps) {
  const [active, setActive] = useState(false);

  const s = (v: number) => v * BTN / 68.8;

  const restShadow = [
    `0 ${s(10)}px ${s(18)}px -${s(3)}px rgba(0,0,0,0.5)`,
    `inset 0 -${s(3)}px ${s(4)}px -${s(1)}px rgba(0,0,0,0.2)`,
    `0 -${s(10)}px ${s(15)}px -${s(1)}px rgba(255,255,255,0.6)`,
    `inset 0 ${s(3)}px ${s(4)}px -${s(1)}px rgba(255,255,255,0.2)`,
    `inset 0 0 ${s(5)}px ${s(1)}px rgba(255,255,255,0.8)`,
    `inset 0 ${s(20)}px ${s(30)}px 0 rgba(255,255,255,0.2)`,
  ].join(', ');

  const activeShadow = [
    `0 ${s(8)}px ${s(18)}px -${s(3)}px rgba(0,0,0,0.4)`,
    `inset 0 -${s(8)}px ${s(30)}px ${s(1)}px rgba(255,255,255,0.9)`,
    `0 -${s(10)}px ${s(15)}px -${s(1)}px rgba(255,255,255,0.6)`,
    `inset 0 ${s(8)}px ${s(25)}px 0 rgba(0,0,0,0.4)`,
    `inset 0 0 ${s(10)}px ${s(1)}px rgba(255,255,255,0.6)`,
  ].join(', ');

  const checkedShadow = [
    `0 ${s(7)}px ${s(18)}px -${s(3)}px rgba(0,0,0,0.4)`,
    `inset 0 -${s(8)}px ${s(25)}px -${s(1)}px rgba(255,255,255,0.9)`,
    `0 -${s(10)}px ${s(15)}px -${s(1)}px rgba(255,255,255,0.6)`,
    `inset 0 ${s(8)}px ${s(20)}px 0 rgba(0,0,0,0.2)`,
    `inset 0 0 ${s(5)}px ${s(1)}px rgba(255,255,255,0.6)`,
  ].join(', ');

  const getShadow = () => {
    if (active) return activeShadow;
    if (toggled) return checkedShadow;
    return restShadow;
  };

  const iconColor = active ? activeColor : toggled ? toggledColor : color;

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseDown={() => !disabled && setActive(true)}
      onMouseUp={() => setActive(false)}
      onMouseLeave={() => setActive(false)}
      title={title}
      disabled={disabled}
      style={{
        transition: 'all 300ms cubic-bezier(0.23, 1, 0.32, 1)',
        boxShadow: getShadow(),
        borderRadius: BTN / 2,
        background: '#eaeaea',
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

import { useCallback, useState } from 'react';
import { ICON_SIZE } from './NeumorphicButton';

interface AppGridIconProps {
  className?: string;
}

const BTN = 36;

export function AppGridIcon({ className }: AppGridIconProps) {
  const [checked, setChecked] = useState(false);
  const [active, setActive] = useState(false);
  const toggle = useCallback(() => setChecked(v => !v), []);

  const s = (v: number) => v * BTN / 68.8;

  const rest = [
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

  const beforeSize = 72 * BTN / 68.8;
  const containerSize = 100 * BTN / 68.8;

  const labelColor = active ? '#555' : checked ? '#444' : '#666';

  const getShadow = () => {
    if (active) return activeShadow;
    if (checked) return checkedShadow;
    return rest;
  };

  return (
    <div className={className} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ display: 'inline-block', position: 'relative', height: containerSize, width: containerSize }}>
        <div
          style={{
            boxShadow: 'none',
            borderRadius: beforeSize / 2,
            background: '#fff',
            position: 'absolute',
            left: '50%',
            top: '50%',
            marginLeft: -beforeSize / 2,
            marginTop: -beforeSize / 2,
            opacity: 0.2,
            height: beforeSize,
            width: beforeSize,
            pointerEvents: 'none',
          }}
        />
        <input
          type="checkbox"
          checked={checked}
          onChange={toggle}
          onMouseDown={() => setActive(true)}
          onMouseUp={() => setActive(false)}
          onMouseLeave={() => setActive(false)}
          style={{
            opacity: 0,
            position: 'absolute',
            cursor: 'pointer',
            zIndex: 1,
            height: '100%',
            width: '100%',
            left: 0,
            top: 0,
            margin: 0,
          }}
        />
        <div
          style={{
            transition: 'all 300ms cubic-bezier(0.23, 1, 0.32, 1)',
            boxShadow: getShadow(),
            borderRadius: BTN / 2,
            position: 'absolute',
            background: '#eaeaea',
            left: '50%',
            top: '50%',
            marginLeft: -BTN / 2,
            marginTop: -BTN / 2,
            height: BTN,
            width: BTN,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              transition: 'color 300ms ease-out',
              color: labelColor,
              lineHeight: `${containerSize}px`,
              textAlign: 'center',
              fontWeight: 700,
              fontSize: s(28),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.9,
              height: '100%',
              width: '100%',
            }}
          >
            <div style={{ width: ICON_SIZE, height: ICON_SIZE }}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={ICON_SIZE}
                height={ICON_SIZE}
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M1 5.2V2.8c0-.123-.001-.276.01-.41a1.51 1.51 0 0 1 .153-.57l.059-.104a1.5 1.5 0 0 1 .597-.553l.16-.068c.158-.056.303-.076.412-.085C2.524.999 2.677 1 2.8 1v1c-.28 0-.42 0-.527.055a.501.501 0 0 0-.218.218C2 2.38 2 2.52 2 2.8v2.4l.007.328a.51.51 0 0 0 .048.199.5.5 0 0 0 .218.218C2.38 6 2.52 6 2.8 6h2.4l.328-.007a.518.518 0 0 0 .199-.048.501.501 0 0 0 .218-.218.518.518 0 0 0 .048-.199L6 5.2V2.8c0-.28 0-.42-.055-.527a.501.501 0 0 0-.218-.218.518.518 0 0 0-.199-.048L5.2 2V1c.124 0 .276-.001.41.01.108.009.253.029.41.085l.16.068.104.059a1.5 1.5 0 0 1 .494.494l.059.103.068.16c.056.158.076.303.085.412.011.133.01.286.01.409v2.4c0 .124.001.276-.01.41a1.511 1.511 0 0 1-.153.57 1.503 1.503 0 0 1-.656.657c-.218.11-.426.141-.572.153-.133.011-.285.01-.409.01H2.8c-.123 0-.276.001-.41-.01a1.511 1.511 0 0 1-.57-.153 1.503 1.503 0 0 1-.657-.656 1.51 1.51 0 0 1-.153-.572C.999 5.476 1 5.324 1 5.2ZM5.2 1v1H2.8V1h2.4ZM9 5.2V2.8c0-.123-.001-.276.01-.41a1.51 1.51 0 0 1 .153-.57l.059-.104a1.5 1.5 0 0 1 .597-.553l.16-.068c.158-.056.303-.076.412-.085.133-.011.286-.01.409-.01v1c-.28 0-.42 0-.527.055a.501.501 0 0 0-.218.218C10 2.38 10 2.52 10 2.8v2.4l.007.328a.52.52 0 0 0 .048.199c.048.094.124.17.219.218C10.38 6 10.52 6 10.8 6h2.4l.328-.007a.518.518 0 0 0 .199-.048.5.5 0 0 0 .218-.218.518.518 0 0 0 .048-.199L14 5.2V2.8c0-.28 0-.42-.055-.527a.5.5 0 0 0-.218-.218.518.518 0 0 0-.199-.048L13.2 2V1c.124 0 .276-.001.41.01.108.009.253.029.41.085l.16.068.104.059a1.5 1.5 0 0 1 .494.494l.059.103.068.16c.056.158.076.303.085.412.011.133.01.286.01.409v2.4c0 .124.001.276-.01.41a1.512 1.512 0 0 1-.153.57 1.503 1.503 0 0 1-.656.657c-.218.11-.426.141-.572.153-.133.011-.285.01-.409.01h-2.4c-.123 0-.276.001-.41-.01a1.511 1.511 0 0 1-.57-.153 1.503 1.503 0 0 1-.657-.656 1.51 1.51 0 0 1-.153-.572C8.999 5.476 9 5.324 9 5.2ZM13.2 1v1h-2.4V1h2.4ZM9 13.2v-2.4c0-.123-.001-.276.01-.41a1.51 1.51 0 0 1 .153-.57l.059-.104a1.5 1.5 0 0 1 .597-.553l.16-.068c.158-.056.303-.076.412-.085.133-.011.286-.01.409-.01v1c-.28 0-.42 0-.527.055a.502.502 0 0 0-.218.219C10 10.38 10 10.52 10 10.8v2.4l.007.328a.52.52 0 0 0 .048.199c.048.094.124.17.219.218.106.055.246.055.526.055h2.4l.328-.007a.518.518 0 0 0 .199-.048.5.5 0 0 0 .218-.218.518.518 0 0 0 .048-.199L14 13.2v-2.4c0-.28 0-.42-.055-.527a.501.501 0 0 0-.218-.218.52.52 0 0 0-.199-.048L13.2 10V9c.124 0 .276-.001.41.01.108.009.253.029.41.085l.16.068.104.059a1.5 1.5 0 0 1 .494.494l.059.103.068.16c.056.158.076.303.085.412.011.133.01.286.01.409v2.4c0 .124.001.276-.01.41a1.512 1.512 0 0 1-.153.57 1.503 1.503 0 0 1-.656.657c-.218.11-.426.141-.572.153-.133.011-.285.01-.409.01h-2.4c-.123 0-.276.001-.41-.01a1.512 1.512 0 0 1-.57-.153 1.503 1.503 0 0 1-.657-.656 1.511 1.511 0 0 1-.153-.572c-.011-.133-.01-.285-.01-.409ZM13.2 9v1h-2.4V9h2.4ZM1 13.2v-2.4c0-.123-.001-.276.01-.41a1.51 1.51 0 0 1 .153-.57l.059-.104a1.5 1.5 0 0 1 .597-.553l.16-.068c.158-.056.303-.076.412-.085.133-.011.286-.01.409-.01v1c-.28 0-.42 0-.527.055a.501.501 0 0 0-.218.219C2 10.38 2 10.52 2 10.8v2.4l.007.328a.51.51 0 0 0 .048.199.5.5 0 0 0 .218.218C2.38 14 2.52 14 2.8 14h2.4l.328-.007a.518.518 0 0 0 .199-.048.5.5 0 0 0 .218-.218.518.518 0 0 0 .048-.199L6 13.2v-2.4c0-.28 0-.42-.055-.527a.501.501 0 0 0-.218-.218.52.52 0 0 0-.199-.048L5.2 10V9c.124 0 .276-.001.41.01.108.009.253.029.41.085l.16.068.104.059a1.5 1.5 0 0 1 .494.494l.059.103.068.16c.056.158.076.303.085.412.011.133.01.286.01.409v2.4c0 .124.001.276-.01.41a1.511 1.511 0 0 1-.153.57 1.503 1.503 0 0 1-.656.657c-.218.11-.426.141-.572.153-.133.011-.285.01-.409.01H2.8c-.123 0-.276.001-.41-.01a1.512 1.512 0 0 1-.57-.153 1.503 1.503 0 0 1-.657-.656 1.511 1.511 0 0 1-.153-.572C.999 13.476 1 13.324 1 13.2ZM5.2 9v1H2.8V9h2.4Z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * AppTransitionPlaceholder —— 应用启动 / 尺寸变化的统一过渡占位（ADR-0011）。
 *
 * 参考 HyperOS 分屏尺寸变化占位动画：
 * - 浅色背景 + 居中应用图标 + 名称，作为「启动」与「尺寸变化(resize)」两类过渡的统一动画。
 * - 有效帧到达 / resize 确认后淡出，与画面交叉淡入，替代原本刺眼的白闪。
 * - 容器内绝对定位（inset-0），pointer-events-none 不拦截触控。
 *
 * 图标经 useScrcpyActions().getAppIcon 取得；取代原零引用死代码 AppLaunchingOverlay.tsx（已删除）。
 */
import { useEffect, useState } from 'react';
import { useScrcpyActions } from '@/contexts/ScrcpyContext';
import { useAppDisplayName } from '@/lib/useAppDisplayName';

interface AppTransitionPlaceholderProps {
  pkg: string;
  /** 是否处于过渡中（显示占位）。变 false 后延迟淡出以完成交叉过渡。 */
  show: boolean;
}

export function AppTransitionPlaceholder({ pkg, show }: AppTransitionPlaceholderProps) {
  const { getAppIcon } = useScrcpyActions();
  const displayName = useAppDisplayName(pkg);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [rendered, setRendered] = useState(show);

  useEffect(() => {
    let cancelled = false;
    getAppIcon(pkg).then((url) => {
      if (!cancelled) setIconUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [pkg, getAppIcon]);

  // show 变 true 立即渲染；变 false 延迟卸载以完成淡出
  useEffect(() => {
    if (show) {
      setRendered(true);
      return;
    }
    const t = setTimeout(() => setRendered(false), 220);
    return () => clearTimeout(t);
  }, [show]);

  if (!rendered) return null;

  const hue = pkg.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none transition-opacity duration-200"
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        opacity: show ? 1 : 0,
      }}
    >
      <div
        className="w-20 h-20 rounded-3xl overflow-hidden flex items-center justify-center shadow-lg transition-transform duration-200"
        style={{
          transform: show ? 'scale(1)' : 'scale(0.85)',
          transitionDelay: show ? '0ms' : '90ms',
        }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-content-primary text-3xl font-medium"
            style={{ backgroundColor: `hsl(${hue}, 25%, 18%)` }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="text-content-secondary text-sm font-medium mt-3">{displayName}</div>
    </div>
  );
}

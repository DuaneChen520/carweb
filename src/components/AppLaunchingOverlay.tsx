import { useEffect, useState } from 'react';
import { useScrcpyContext } from '@/contexts/ScrcpyContext';

interface AppLaunchingOverlayProps {
  pkg: string;
  name: string;
}

export function AppLaunchingOverlay({ pkg, name }: AppLaunchingOverlayProps) {
  const { getAppIcon } = useScrcpyContext();
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 10);
    let cancelled = false;
    getAppIcon(pkg).then((url) => {
      if (!cancelled) setIconUrl(url);
    });
    return () => { cancelled = true; clearTimeout(t); };
  }, [pkg, getAppIcon]);

  const displayName = name || pkg.split('.').pop() || pkg;
  const hue = pkg.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center backdrop-blur-xl bg-black/60 transition-opacity duration-300"
      style={{ opacity: show ? 1 : 0 }}
    >
      <div
        className="w-24 h-24 rounded-3xl overflow-hidden flex items-center justify-center mb-4 shadow-2xl transition-transform duration-300"
        style={{ transform: show ? 'scale(1)' : 'scale(0.8)' }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-white text-4xl font-medium"
            style={{ backgroundColor: `hsl(${hue}, 45%, 35%)` }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="text-white text-base font-medium">{displayName}</div>
      <div className="text-white/40 text-xs mt-1">正在启动...</div>
    </div>
  );
}

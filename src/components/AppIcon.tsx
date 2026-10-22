import { useEffect, useRef, useState } from 'react';
import { Pin } from 'lucide-react';

export interface AppIconProps {
  pkg: string;
  name: string;
  getAppIcon: (pkg: string) => Promise<string | null>;
  onLaunch: (pkg: string) => void;
  compact?: boolean;
  pinMode?: boolean;
  isPinned?: boolean;
  cacheVersion?: number;
}

export function AppIcon({ pkg, name, getAppIcon, onLaunch, compact, pinMode, isPinned, cacheVersion }: AppIconProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    setIconUrl(null);
    getAppIcon(pkg).then((url) => {
      if (!cancelled) setIconUrl(url);
    });
    return () => { cancelled = true; };
  }, [pkg, getAppIcon, isVisible, cacheVersion]);

  const displayName = name || pkg;
  const firstLetter = displayName.charAt(0).toUpperCase();
  const hue = pkg.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <button
      ref={btnRef}
      type="button"
      aria-label={name}
      onClick={() => onLaunch(pkg)}
      className={
        compact
          ? 'w-12 h-12 flex items-center justify-center rounded-xl p-1.5 hover:bg-surface-hover/80 active:scale-95 transition-all group relative cursor-pointer'
          : 'flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-surface-hover/80 active:scale-95 transition-all group relative cursor-pointer min-w-[56px]'
      }
      title={name}
    >
      {iconUrl ? (
        <img src={iconUrl} alt={name} className="w-9 h-9 rounded-xl object-cover shadow-sm" />
      ) : (
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-content-primary font-medium text-sm shadow-sm"
          style={{ backgroundColor: `hsl(${hue}, 45%, 35%)` }}
        >
          {firstLetter}
        </div>
      )}
      {pinMode && (
        <div
          className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center shadow-sm ${
            isPinned ? 'bg-accent-500 text-content-primary' : 'bg-surface-elevated text-content-secondary'
          }`}
        >
          <Pin className={`w-3 h-3 ${isPinned ? 'fill-current' : ''}`} />
        </div>
      )}
      {!compact && (
        <span className="text-xs text-content-muted truncate max-w-[72px] text-center group-hover:text-content-secondary transition-colors font-medium">
          {displayName}
        </span>
      )}
    </button>
  );
}

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

  const displayName = name || pkg.split('.').pop() || pkg;
  const firstLetter = displayName.charAt(0).toUpperCase();
  const hue = pkg.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <button
      ref={btnRef}
      onClick={() => onLaunch(pkg)}
      className="flex flex-col items-center gap-1 p-1.5 rounded-lg hover:bg-black/10 transition-colors group relative"
      title={name}
    >
      {iconUrl ? (
        <img src={iconUrl} alt={name} className="w-9 h-9 rounded-lg object-cover" />
      ) : (
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-medium text-sm"
          style={{ backgroundColor: `hsl(${hue}, 45%, 35%)` }}
        >
          {firstLetter}
        </div>
      )}
      {pinMode && (
        <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${
          isPinned ? 'bg-blue-500' : 'bg-white/20'
        }`}>
          <Pin className={`w-2.5 h-2.5 ${isPinned ? 'text-white fill-white' : 'text-white/60'}`} />
        </div>
      )}
      {!compact && (
        <span className="text-[10px] text-black/50 truncate w-full text-center group-hover:text-black/80 transition-colors">
          {displayName}
        </span>
      )}
    </button>
  );
}

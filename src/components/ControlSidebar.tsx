import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Grid, ArrowLeft, Home, Loader2, X, MonitorOff, Maximize2, Minimize2, ArrowLeftRight, Monitor, Power, Keyboard, ChevronDown } from 'lucide-react';
import type { ResolutionPresetKey } from '../hooks/scrcpy';
import { RESOLUTION_PRESETS } from '../hooks/scrcpy';
import { useScrcpyContext } from '../contexts/ScrcpyContext';

const PRIORITY_PACKAGES = [
  'com.android.contacts',
  'com.android.dialer',
  'com.android.phone',
  'com.android.mms',
  'com.android.messaging',
  'com.tencent.mm',
  'com.google.android.apps.maps',
  'com.baidu.BaiduMap',
  'com.autonavi.minimap',
  'com.android.settings',
  'com.android.chrome',
  'com.android.documentsui',
];

interface AppIconProps {
  pkg: string;
  name: string;
  getAppIcon: (pkg: string) => Promise<string | null>;
  onLaunch: (pkg: string) => void;
  compact?: boolean;
}

function AppIcon({ pkg, name, getAppIcon, onLaunch, compact }: AppIconProps) {
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
    getAppIcon(pkg).then((url) => {
      if (!cancelled) setIconUrl(url);
    });
    return () => { cancelled = true; };
  }, [pkg, getAppIcon, isVisible]);

  const displayName = name || pkg.split('.').pop() || pkg;
  const firstLetter = displayName.charAt(0).toUpperCase();
  const hue = pkg.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <button
      ref={btnRef}
      onClick={() => onLaunch(pkg)}
      className="flex flex-col items-center gap-1 p-1.5 rounded-lg hover:bg-white/10 transition-colors group"
      title={name}
    >
      {iconUrl ? (
        <img src={iconUrl} alt={name} className="w-9 h-9 rounded-lg" />
      ) : (
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-medium text-sm"
          style={{ backgroundColor: `hsl(${hue}, 45%, 35%)` }}
        >
          {firstLetter}
        </div>
      )}
      {!compact && (
        <span className="text-[10px] text-white/50 truncate w-full text-center group-hover:text-white/80 transition-colors">
          {displayName}
        </span>
      )}
    </button>
  );
}

interface ControlSidebarProps {
  isVirtualDisplay?: boolean;
  isRunning?: boolean;
  useMirrorMode?: boolean;
  isFullscreen?: boolean;
  toggleFullscreen?: () => void;
  toggleDisplayMode?: () => void;
  handleApplyNewSize?: () => void;
  handleStop?: () => void;
  toggleVirtualKeyboard?: () => void;
  showVirtualKeyboard?: boolean;
  currentPreset?: { key: string; label: string; scale: number; dpiMultiplier: number };
  resolutionPreset?: ResolutionPresetKey;
  changeResolutionPreset?: (preset: ResolutionPresetKey) => void;
  showResMenu?: boolean;
  setShowResMenu?: (v: boolean) => void;
}

export function ControlSidebar({
  isVirtualDisplay, isRunning, useMirrorMode, isFullscreen, toggleFullscreen, toggleDisplayMode, handleApplyNewSize, handleStop,
  toggleVirtualKeyboard, showVirtualKeyboard,
  currentPreset, resolutionPreset, changeResolutionPreset, showResMenu, setShowResMenu,
}: ControlSidebarProps) {
  const scrcpy = useScrcpyContext();
  const { goBack, goHome, showRecentApps, startApp, getAppList, getAppIcon, getAppLabel, batchGetAppLabels, injectText, turnOffPhysicalScreen, turnOnPhysicalScreen } = scrcpy;
  const [panelMode, setPanelMode] = useState<'closed' | 'search' | 'apps'>('closed');
  const [searchText, setSearchText] = useState('');
  const [apps, setApps] = useState<string[] | null>(null);
  const [appLabels, setAppLabels] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const [floatingPanelPosition, setFloatingPanelPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [pinnedApps, setPinnedApps] = useState<string[]>([]);
  const [physicalScreenOn, setPhysicalScreenOn] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const query = searchText.toLowerCase().trim();

  useEffect(() => {
    if (panelMode !== 'closed') {
      searchRef.current?.focus();
    }
  }, [panelMode]);

  useEffect(() => {
    const loadPinnedApps = async () => {
      const list = await getAppList(true);
      const priorityApps = PRIORITY_PACKAGES.filter(pkg => list.includes(pkg));
      setPinnedApps(priorityApps);
      batchGetAppLabels(priorityApps).then((labels) => {
        setAppLabels(prev => {
          const newMap = new Map(prev);
          labels.forEach((value, key) => newMap.set(key, value));
          return newMap;
        });
      });
    };
    loadPinnedApps();
  }, [getAppList, batchGetAppLabels]);

  const filteredPinned = pinnedApps.filter(
    (pkg) => !query || pkg.toLowerCase().includes(query) || (appLabels.get(pkg) || '').toLowerCase().includes(query),
  );

  const filteredAll = apps
    ? apps.filter((p) => {
        if (!query) return true;
        const label = appLabels.get(p) || '';
        return (
          p.toLowerCase().includes(query) ||
          label.toLowerCase().includes(query)
        );
      })
    : [];

  const loadApps = useCallback(async (includeSystem = false) => {
    setLoading(true);
    setShowSystem(includeSystem);
    try {
      const list = await getAppList(includeSystem);
      setApps(list);
      setPanelMode('apps');
      batchGetAppLabels(list).then((labels) => {
        setAppLabels(labels);
      });
    } finally {
      setLoading(false);
    }
  }, [getAppList, batchGetAppLabels]);

  const handleLaunchApp = useCallback(
    (pkg: string) => {
      startApp(pkg);
      setSearchText('');
      setPanelMode('closed');
    },
    [startApp],
  );

  const closePanel = useCallback(() => {
    setPanelMode('closed');
    setSearchText('');
  }, []);

  const togglePanel = useCallback((mode: 'search' | 'apps') => {
    if (panelMode === mode) {
      setPanelMode('closed');
    } else {
      setPanelMode(mode);
      setSearchText('');
      if (mode === 'apps' && !apps) {
        loadApps(false);
      }
      if (panelRef.current) {
        const rect = panelRef.current.getBoundingClientRect();
        setFloatingPanelPosition({ x: rect.left, y: rect.top });
      }
    }
  }, [panelMode, apps, loadApps]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === panelRef.current || (e.target as HTMLElement).closest('.drag-handle')) {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - floatingPanelPosition.x, y: e.clientY - floatingPanelPosition.y };
    }
  }, [floatingPanelPosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setFloatingPanelPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <>
      <div className="w-13 flex flex-col items-center py-2 gap-1 bg-black/60 border-r border-white/10">
        <button
          onClick={() => togglePanel('search')}
          className={`p-2 rounded-lg transition-colors ${panelMode === 'search' ? 'bg-blue-500/30 text-blue-400' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
          title="搜索应用"
        >
          <Search className="w-5 h-5" />
        </button>

        <button
          onClick={() => togglePanel('apps')}
          className={`p-2 rounded-lg transition-colors ${panelMode === 'apps' ? 'bg-blue-500/30 text-blue-400' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
          title="全部应用"
        >
          <Grid className="w-5 h-5" />
        </button>

        <div className="w-8 h-px bg-white/10 my-1" />

        {pinnedApps.map((pkg) => (
          <AppIcon
            key={pkg}
            pkg={pkg}
            name={appLabels.get(pkg) || pkg.split('.').pop() || pkg}
            getAppIcon={getAppIcon}
            onLaunch={handleLaunchApp}
            compact
          />
        ))}

        <div className="flex-1" />

        {isRunning && toggleVirtualKeyboard && (
          <button
            onClick={toggleVirtualKeyboard}
            className={`p-2 rounded-lg transition-colors ${showVirtualKeyboard ? 'bg-blue-500/30 text-blue-400' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
            title="虚拟键盘"
          >
            <Keyboard className="w-5 h-5" />
          </button>
        )}

        {isRunning && !useMirrorMode && currentPreset && setShowResMenu && (
          <div className="relative">
            <button
              onClick={() => setShowResMenu(!showResMenu)}
              className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title={`画质: ${currentPreset.label}`}
            >
              <ChevronDown className="w-5 h-5" />
            </button>
            {showResMenu && changeResolutionPreset && (
              <div className="absolute bottom-full left-full mb-0 ml-1 bg-black/95 backdrop-blur-md border border-white/10 rounded-lg overflow-hidden z-50 min-w-[90px] shadow-xl">
                {RESOLUTION_PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => changeResolutionPreset(p.key)}
                    className={`w-full px-3 py-1.5 text-xs text-left hover:bg-white/10 transition-colors ${
                      p.key === resolutionPreset ? 'text-blue-400 bg-blue-500/20' : 'text-white/70'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isRunning && toggleDisplayMode && (
          <button
            onClick={toggleDisplayMode}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title={useMirrorMode ? '切换到虚拟屏模式' : '切换到镜像模式'}
          >
            <ArrowLeftRight className="w-5 h-5" />
          </button>
        )}

        {isRunning && !useMirrorMode && handleApplyNewSize && (
          <button
            onClick={handleApplyNewSize}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="重新应用窗口尺寸"
          >
            <Monitor className="w-5 h-5" />
          </button>
        )}

        {toggleFullscreen && (
          <button
            onClick={toggleFullscreen}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title={isFullscreen ? '退出全屏' : '全屏'}
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
        )}

        <button
          onClick={goBack}
          className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title="返回"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button
          onClick={goHome}
          className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title="桌面"
        >
          <Home className="w-5 h-5" />
        </button>
        <button
          onClick={showRecentApps}
          className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title="最近任务"
        >
          <Grid className="w-5 h-5" />
        </button>

        {isVirtualDisplay && turnOffPhysicalScreen && turnOnPhysicalScreen && (
          <button
            onClick={async () => {
              if (physicalScreenOn) {
                await turnOffPhysicalScreen();
              } else {
                await turnOnPhysicalScreen();
              }
              setPhysicalScreenOn(!physicalScreenOn);
            }}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title={physicalScreenOn ? '关闭物理屏幕' : '开启物理屏幕'}
          >
            {physicalScreenOn ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
          </button>
        )}

        {handleStop && (
          <button
            onClick={handleStop}
            className="p-2 text-red-400/80 hover:text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
            title="断开连接"
          >
            <Power className="w-5 h-5" />
          </button>
        )}
      </div>

      {panelMode !== 'closed' && (
        <div
          ref={panelRef}
          className="fixed w-72 max-h-[calc(100vh-2rem)] bg-black/90 backdrop-blur-md border-r border-white/10 flex flex-col z-50 shadow-2xl rounded-lg overflow-hidden"
          style={{
            left: `${floatingPanelPosition.x}px`,
            top: `${floatingPanelPosition.y}px`,
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="drag-handle flex items-center justify-between px-4 pt-3 pb-2 cursor-move select-none bg-white/5 hover:bg-white/10 transition-colors">
            <span className="text-white/80 text-sm font-medium">
              {panelMode === 'search' ? '搜索应用' : showSystem ? '所有应用' : '第三方应用'}
              {panelMode === 'apps' && apps && ` (${filteredAll.length})`}
            </span>
            <button
              onClick={closePanel}
              className="p-1 text-white/40 hover:text-white rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
              <input
                ref={searchRef}
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜索应用..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/10 rounded-lg border border-white/10 text-white placeholder-white/30 outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
          </div>

          {panelMode === 'apps' && (
            <div className="px-4 pb-2 flex items-center gap-2">
              <button
                onClick={() => loadApps(!showSystem)}
                disabled={loading}
                className="text-[10px] text-white/30 hover:text-white/50 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
              >
                {showSystem ? '仅第三方' : '含系统'}
              </button>
              {loading && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-2 space-y-1">
            {panelMode === 'search' ? (
              filteredPinned.length > 0 ? (
                <>
                  <div className="text-white/40 text-[10px] uppercase tracking-wider px-1 pt-1 pb-0.5">
                    常用
                  </div>
                  <div className="grid grid-cols-3 gap-0.5">
                    {filteredPinned.map((pkg) => (
                      <AppIcon
                        key={pkg}
                        pkg={pkg}
                        name={appLabels.get(pkg) || pkg.split('.').pop() || pkg}
                        getAppIcon={getAppIcon}
                        onLaunch={handleLaunchApp}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-white/40 text-xs text-center py-4">
                  无匹配应用
                </div>
              )
            ) : apps ? (
              filteredAll.length > 0 ? (
                <div className="grid grid-cols-3 gap-0.5 py-1">
                  {filteredAll.map((pkg) => (
                    <AppIcon
                      key={pkg}
                      pkg={pkg}
                      name={appLabels.get(pkg) || pkg.split('.').pop() || pkg}
                      getAppIcon={getAppIcon}
                      onLaunch={handleLaunchApp}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-white/40 text-xs text-center py-4">
                  无匹配应用
                </div>
              )
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Home, Loader2, X, MonitorOff, Monitor, Maximize2, Minimize2, Power, Settings, Trash2, Search, Pin, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { AppGridIcon } from './AppGridIcon';
import { NeumorphicButton, ICON_SIZE } from './NeumorphicButton';
import type { ResolutionPresetKey } from '../hooks/scrcpy';
import { RESOLUTION_PRESETS } from '../hooks/scrcpy';
import { useScrcpyContext } from '../contexts/ScrcpyContext';
import { CacheSettingsDialog } from './CacheSettingsDialog';
import { PinDialog } from './PinDialog';
import { useAdbStore } from '../hooks/useAdbStore';
import { useDevicePin } from '../hooks/useDevicePin';

function formatCacheSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AppIconProps {
  pkg: string;
  name: string;
  getAppIcon: (pkg: string) => Promise<string | null>;
  onLaunch: (pkg: string) => void;
  compact?: boolean;
  pinMode?: boolean;
  isPinned?: boolean;
  cacheVersion?: number;
}

function AppIcon({ pkg, name, getAppIcon, onLaunch, compact, pinMode, isPinned, cacheVersion }: AppIconProps) {
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

interface ControlSidebarProps {
  isVirtualDisplay?: boolean;
  isRunning?: boolean;
  useMirrorMode?: boolean;
  isFullscreen?: boolean;
  toggleFullscreen?: () => void;
  toggleDisplayMode?: () => void;
  handleStop?: () => void;
  keyboardMode?: 'phone' | 'browser';
  setKeyboardMode?: (mode: 'phone' | 'browser') => void;
  currentPreset?: { key: string; label: string; scale: number };
  resolutionPreset?: ResolutionPresetKey;
  changeResolutionPreset?: (preset: ResolutionPresetKey) => void;
}

export function ControlSidebar({
  isVirtualDisplay, isRunning, useMirrorMode, isFullscreen, toggleFullscreen, toggleDisplayMode, handleStop,
  keyboardMode, setKeyboardMode,
  currentPreset, resolutionPreset, changeResolutionPreset,
}: ControlSidebarProps) {
  const scrcpy = useScrcpyContext();
  const { goBack, goHome, startApp, getAppIcon, getCachedAppLabels, parseAllApps, turnOffPhysicalScreen, turnOnPhysicalScreen, getAllDeviceApps, incrementLocalCount, togglePin, getPinnedApps, syncWithDevice, audioStatus, isMuted, setMuted, audioRoute, setAudioRoute } = scrcpy;
  const adbStore = useAdbStore();
  const { hasPin } = useDevicePin();
  const [panelMode, setPanelMode] = useState<'closed' | 'search' | 'apps'>('closed');
  const [searchText, setSearchText] = useState('');
  const [apps, setApps] = useState<string[] | null>(null);
  const [appLabels, setAppLabels] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pinnedSet, setPinnedSet] = useState<Set<string>>(new Set());

  const [floatingPanelPosition, setFloatingPanelPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [pinnedApps, setPinnedApps] = useState<string[]>([]);
  const [sidebarApps, setSidebarApps] = useState<string[]>([]);
  const [physicalScreenOn, setPhysicalScreenOn] = useState(true);
  const [parseProgress, setParseProgress] = useState<{ total: number; parsed: number; skipped: number; current: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<{ count: number; size: number } | null>(null);
  const [showCacheSettings, setShowCacheSettings] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [iconCacheVersion, setIconCacheVersion] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const query = searchText.toLowerCase().trim();

  useEffect(() => {
    if (panelMode !== 'closed') {
      searchRef.current?.focus();
    }
  }, [panelMode]);

  const refreshSidebarApps = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      await parseAllApps();
    }

    let deviceApps = await getAllDeviceApps();

    if (deviceApps.length === 0) {
      const syncResult = await syncWithDevice();
      if (syncResult.toParse.length > 0) {
        parseAllApps().then(() => setIconCacheVersion(v => v + 1)).catch(() => {});
      }
      deviceApps = await getAllDeviceApps();
    }

    const pinned: typeof deviceApps = [];
    const frequent: typeof deviceApps = [];
    const other: typeof deviceApps = [];
    for (const app of deviceApps) {
      if (app.pinned) pinned.push(app);
      else if (app.localCount > 0) frequent.push(app);
      else other.push(app);
    }

    pinned.sort((a, b) => b.pinOrder - a.pinOrder);
    frequent.sort((a, b) => b.localCount - a.localCount);
    other.sort((a, b) => b.launchCount - a.launchCount);

    setPinnedApps(pinned.map(a => a.packageName));

    const sorted = [...pinned, ...frequent, ...other];
    const sidebarList = sorted.slice(0, 12).map(a => a.packageName);
    setSidebarApps(sidebarList);

    getCachedAppLabels(sidebarList).then((labels) => {
      setAppLabels(prev => {
        const newMap = new Map(prev);
        labels.forEach((value, key) => newMap.set(key, value));
        return newMap;
      });
    });
  }, [getAllDeviceApps, getCachedAppLabels, syncWithDevice, parseAllApps]);

  useEffect(() => {
    refreshSidebarApps();
  }, [refreshSidebarApps]);

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

  const sortDeviceApps = useCallback(async () => {
    const deviceApps = await getAllDeviceApps();
    const pinned: typeof deviceApps = [];
    const frequent: typeof deviceApps = [];
    const other: typeof deviceApps = [];
    for (const app of deviceApps) {
      if (app.pinned) pinned.push(app);
      else if (app.localCount > 0) frequent.push(app);
      else other.push(app);
    }
    pinned.sort((a, b) => b.pinOrder - a.pinOrder);
    frequent.sort((a, b) => b.localCount - a.localCount);
    other.sort((a, b) => b.launchCount - a.launchCount);
    return [...pinned, ...frequent, ...other].map(a => a.packageName);
  }, [getAllDeviceApps]);

  const loadApps = useCallback(async () => {
    setLoading(true);
    setPanelMode('apps');
    try {
      const deviceApps = await getAllDeviceApps();
      if (deviceApps.length > 0) {
        const sorted = await sortDeviceApps();
        setApps(sorted);
        const labels = await scrcpy.getCachedAppLabels(sorted);
        setAppLabels(labels);
        setLoading(false);
        return;
      }

      await parseAllApps((p) => setParseProgress(p));

      const sorted = await sortDeviceApps();
      setApps(sorted);
      const labels = await scrcpy.getCachedAppLabels(sorted);
      setAppLabels(labels);
      setParseProgress(null);
      setIconCacheVersion(v => v + 1);
    } catch {
      setParseProgress(null);
    } finally {
      setLoading(false);
    }
  }, [parseAllApps, scrcpy, getAllDeviceApps, sortDeviceApps]);

  const handleLaunchApp = useCallback(
    (pkg: string) => {
      if (pinMode && panelMode === 'apps') {
        togglePin(pkg).then(async (isNowPinned) => {
          setPinnedSet(prev => {
            const next = new Set(prev);
            if (isNowPinned) {
              next.add(pkg);
            } else {
              next.delete(pkg);
            }
            return next;
          });
          const sorted = await sortDeviceApps();
          setApps(sorted);
          refreshSidebarApps();
        });
      } else {
        startApp(pkg);
        incrementLocalCount(pkg).then(() => {
          refreshSidebarApps();
        }).catch(() => {});
        setSearchText('');
        setPanelMode('closed');
      }
    },
    [pinMode, panelMode, togglePin, startApp, incrementLocalCount, refreshSidebarApps, sortDeviceApps],
  );

  const togglePinMode = useCallback(async () => {
    if (pinMode) {
      setPinMode(false);
      setPinnedSet(new Set());
    } else {
      const pinned = await getPinnedApps();
      setPinnedSet(new Set(pinned.map(a => a.packageName)));
      setPinMode(true);
    }
  }, [pinMode, getPinnedApps]);

  const closePanel = useCallback(() => {
    setPanelMode('closed');
    setSearchText('');
    setPinMode(false);
    setPinnedSet(new Set());
  }, []);

  const togglePanel = useCallback((mode: 'search' | 'apps') => {
    if (panelMode === mode) {
      setPanelMode('closed');
    } else {
      setPanelMode(mode);
      setSearchText('');
      if (mode === 'apps') {
        if (!apps) {
          loadApps();
        } else {
          // Refresh labels from cache (fast) — parseAllApps may have finished
          scrcpy.getCachedAppLabels(apps).then(setAppLabels).catch(() => {});
        }
      }
      if (panelRef.current) {
        const rect = panelRef.current.getBoundingClientRect();
        setFloatingPanelPosition({ x: rect.left, y: rect.top });
      }
    }
  }, [panelMode, apps, loadApps, scrcpy]);

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
      <div className="w-13 flex flex-col items-center py-2 gap-1 bg-white border-r border-black/10">
        <button
          onClick={() => togglePanel('apps')}
          className="flex items-center justify-center w-13 h-[52px]"
          title="应用列表"
        >
          <AppGridIcon />
        </button>

        <div className="w-8 h-px bg-black/10 my-1" />

        <div className="flex flex-col items-center gap-1 overflow-y-auto max-h-[calc(100vh-280px)] scrollbar-none">
          {pinnedApps.map((pkg) => (
            <AppIcon
              key={`pinned-${pkg}`}
              pkg={pkg}
              name={appLabels.get(pkg) || pkg.split('.').pop() || pkg}
              getAppIcon={getAppIcon}
              onLaunch={handleLaunchApp}
              compact
              pinMode={pinMode}
              isPinned={pinnedSet.has(pkg)}
              cacheVersion={iconCacheVersion}
            />
          ))}
          {pinnedApps.length > 0 && sidebarApps.length > pinnedApps.length && (
            <div className="w-6 h-px bg-black/10 my-0.5" />
          )}
          {sidebarApps
            .filter(pkg => !pinnedApps.includes(pkg))
            .map((pkg) => (
              <AppIcon
                key={`other-${pkg}`}
                pkg={pkg}
                name={appLabels.get(pkg) || pkg.split('.').pop() || pkg}
                getAppIcon={getAppIcon}
                onLaunch={handleLaunchApp}
                compact
                pinMode={pinMode}
                isPinned={pinnedSet.has(pkg)}
                cacheVersion={iconCacheVersion}
              />
            ))}
        </div>

        <div className="flex-1" />

        <div className="flex flex-col items-center" style={{ gap: '12px' }}>

        {toggleFullscreen && (
          <NeumorphicButton
            onClick={toggleFullscreen}
            toggled={!!isFullscreen}
            title={isFullscreen ? '退出全屏' : '全屏'}
          >
            {isFullscreen ? <Minimize2 size={ICON_SIZE} /> : <Maximize2 size={ICON_SIZE} />}
          </NeumorphicButton>
        )}

        <NeumorphicButton onClick={goBack} title="返回">
          <ArrowLeft size={ICON_SIZE} />
        </NeumorphicButton>
        <NeumorphicButton onClick={goHome} title="桌面">
          <Home size={ICON_SIZE} />
        </NeumorphicButton>

        {isVirtualDisplay && turnOffPhysicalScreen && turnOnPhysicalScreen && (
          <NeumorphicButton
            onClick={async () => {
              if (physicalScreenOn) {
                await turnOffPhysicalScreen();
              } else {
                await turnOnPhysicalScreen();
              }
              setPhysicalScreenOn(!physicalScreenOn);
            }}
            title={physicalScreenOn ? '关闭物理屏幕' : '开启物理屏幕'}
          >
            {physicalScreenOn ? <MonitorOff size={ICON_SIZE} /> : <Monitor size={ICON_SIZE} />}
          </NeumorphicButton>
        )}

        {audioStatus !== 'idle' && (
          <NeumorphicButton
            onClick={() => setMuted(!isMuted)}
            toggled={!!isMuted}
            disabled={audioStatus === 'disabled' || audioStatus === 'errored'}
            title={
              audioStatus === 'disabled' ? '音频不可用（设备不支持）'
              : audioStatus === 'errored' ? '音频错误'
              : isMuted ? '取消静音' : '静音'
            }
          >
            {isMuted ? <VolumeX size={ICON_SIZE} /> : <Volume2 size={ICON_SIZE} />}
          </NeumorphicButton>
        )}

        {handleStop && (
          <NeumorphicButton onClick={handleStop} title="断开连接" color="#EF4444" toggledColor="#EF4444">
            <Power size={ICON_SIZE} />
          </NeumorphicButton>
        )}

        <div className="w-8 h-px bg-black/10 my-1" />

        <div className="relative">
          <NeumorphicButton
            onClick={async () => {
              if (!showSettings) {
                const info = await scrcpy.getCacheInfo();
                setCacheInfo(info);
              }
              setShowSettings(!showSettings);
            }}
            title="设置"
          >
            <Settings size={ICON_SIZE} />
          </NeumorphicButton>

          {showSettings && (
            <div
              className="absolute bottom-full left-full mb-1 ml-1 bg-black/95 backdrop-blur-md border border-white/10 rounded-lg overflow-hidden z-50 min-w-[160px] shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2.5 text-xs text-white/70 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span>缓存大小</span>
                  <span className="text-white font-mono">{formatCacheSize(cacheInfo?.size ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>键盘模式</span>
                  <button
                    onClick={() => {
                      if (!setKeyboardMode) return;
                      const next = keyboardMode === 'phone' ? 'browser' : 'phone';
                      setKeyboardMode(next);
                      localStorage.setItem('carweb-keyboard-mode', next);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                      keyboardMode === 'browser' ? 'bg-blue-500/30 text-blue-400' : 'bg-white/10 text-white/60'
                    }`}
                  >
                    {keyboardMode === 'phone' ? '📱 手机' : '⌨️ 浏览器'}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>启动 PIN</span>
                  <button
                    onClick={() => {
                      if (!adbStore.deviceSerial) return;
                      setShowSettings(false);
                      setShowPinSetup(true);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                      adbStore.deviceSerial && hasPin(adbStore.deviceSerial)
                        ? 'bg-blue-500/30 text-blue-400'
                        : adbStore.deviceSerial
                          ? 'bg-white/10 text-white/60'
                          : 'bg-white/5 text-white/30 cursor-not-allowed'
                    }`}
                  >
                    {!adbStore.deviceSerial
                      ? '需连接设备'
                      : hasPin(adbStore.deviceSerial)
                        ? '已启用 · 更改'
                        : '设置'}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>音频输出</span>
                  <button
                    onClick={() => setAudioRoute(audioRoute === 'browser' ? 'phone' : 'browser')}
                    className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                      audioRoute === 'browser' ? 'bg-blue-500/30 text-blue-400' : 'bg-white/10 text-white/60'
                    }`}
                  >
                    {audioRoute === 'browser' ? '🔊 浏览器' : '📱 手机'}
                  </button>
                </div>
                {isRunning && toggleDisplayMode && (
                  <div className="flex items-center justify-between gap-3">
                    <span>显示模式</span>
                    <button
                      onClick={toggleDisplayMode}
                      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                        useMirrorMode ? 'bg-blue-500/30 text-blue-400' : 'bg-white/10 text-white/60'
                      }`}
                    >
                      {useMirrorMode ? '镜像' : '虚拟屏'}
                    </button>
                  </div>
                )}
                {isRunning && currentPreset && changeResolutionPreset && (
                  <div className="flex items-center justify-between gap-3">
                    <span>画质</span>
                    <div className="relative">
                      <select
                        value={resolutionPreset}
                        onChange={(e) => changeResolutionPreset(e.target.value as ResolutionPresetKey)}
                        className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-white/60 border-none outline-none cursor-pointer"
                      >
                        {RESOLUTION_PRESETS.map(p => (
                          <option key={p.key} value={p.key}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => {
                    setShowSettings(false);
                    setShowCacheSettings(true);
                  }}
                  className="flex items-center gap-1.5 text-white/60 hover:text-white transition-colors w-full"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>缓存设置</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {showPinSetup && adbStore.deviceSerial && (
          <PinDialog
            mode="setup"
            deviceId={adbStore.deviceSerial}
            deviceName={adbStore.deviceName || '未知设备'}
            hasExistingPin={hasPin(adbStore.deviceSerial)}
            onSuccess={() => {
              setShowPinSetup(false);
            }}
            onCancel={() => setShowPinSetup(false)}
          />
        )}
        <CacheSettingsDialog
          open={showCacheSettings}
          onClose={() => setShowCacheSettings(false)}
          onClearAppCache={async () => {
            await scrcpy.clearAll();
            const info = await scrcpy.getCacheInfo();
            setCacheInfo(info);
            setAppLabels(new Map());
            refreshSidebarApps(true);
          }}
          onClearUsageData={async () => {
            await scrcpy.clearAll();
            refreshSidebarApps(true);
          }}
        />
      </div>
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
              {panelMode === 'search' ? '搜索应用' : '全部应用'}
              {panelMode === 'apps' && apps && ` (${filteredAll.length})`}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={togglePinMode}
                className={`p-1 rounded transition-colors ${pinMode ? 'text-blue-400' : 'text-white/40 hover:text-white'}`}
                title={pinMode ? '退出置顶模式' : '置顶模式'}
              >
                <Pin className="w-4 h-4" />
              </button>
              {panelMode === 'apps' && (
                <button
                  onClick={() => {
                    if (loading) return;
                    setLoading(true);
                    refreshSidebarApps(true).then(async () => {
                      const sorted = await sortDeviceApps();
                      setApps(sorted);
                      setIconCacheVersion(v => v + 1);
                      setLoading(false);
                    }).catch(() => {
                      setLoading(false);
                    });
                  }}
                  disabled={loading}
                  className={`p-1 rounded transition-colors ${loading ? 'text-white/20' : 'text-white/40 hover:text-white'}`}
                  title="更新应用列表"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              )}
              <button
                onClick={closePanel}
                className="p-1 text-white/40 hover:text-white rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
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

          {parseProgress && (
            <div className="px-4 pb-2">
              <div className="flex items-center justify-between text-[10px] text-white/40 mb-1">
                <span>{parseProgress.current ? `解析 ${parseProgress.current}...` : '解析应用中...'}</span>
                <span>{parseProgress.parsed}/{parseProgress.total}</span>
              </div>
              <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500/60 rounded-full transition-all duration-300"
                  style={{ width: `${(parseProgress.parsed / Math.max(parseProgress.total, 1)) * 100}%` }}
                />
              </div>
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
                        pinMode={pinMode}
                        isPinned={pinnedSet.has(pkg)}
                        cacheVersion={iconCacheVersion}
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
                      pinMode={pinMode}
                      isPinned={pinnedSet.has(pkg)}
                      cacheVersion={iconCacheVersion}
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

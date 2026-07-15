import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Home, Grid2X2, MonitorOff, Monitor, Maximize2, Minimize2, Power, Settings, Trash2, Volume2, VolumeX, AppWindow, Smartphone, Keyboard } from 'lucide-react';
import { AppIcon } from './AppIcon';
import { NeumorphicButton, ICON_SIZE } from './NeumorphicButton';
import type { ResolutionPresetKey } from '../hooks/scrcpy';
import { RESOLUTION_PRESETS } from '../hooks/scrcpy';
import { useScrcpyActions, useScrcpyAudio } from '../contexts/ScrcpyContext';
import { useAppPicker } from '../contexts/AppPickerContext';
import { CacheSettingsDialog, type DeviceCacheInfo } from './CacheSettingsDialog';
import { PinDialog } from './PinDialog';
import { useAdbStore } from '../hooks/useAdbStore';
import { useDevicePin } from '../hooks/useDevicePin';
import { useRememberedDevices } from '../hooks/useRememberedDevices';

function formatCacheSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  /**
   * 分屏桌面模式相关回调（Task 8 改造）。
   * 当这些回调存在时，侧边栏切换到分屏桌面语义：
   * - onDesktopClick 替代 goHome（§9.1 桌面按钮语义变更）
   * - onActivityManagerClick 触发活动进程面板（§9.1 新增按钮）
   * - onLaunchFullscreen 替代 startApp 全屏启动（§9.3 pinned app 统一全屏启动）
   */
  onDesktopClick?: () => void;
  onActivityManagerClick?: () => void;
  onLaunchFullscreen?: (pkg: string) => void;
  /**
   * 打开统一「全部应用」浮窗（ADR-0010）。由父组件绑定具体 mode + onLaunch，
   * 侧栏只负责触发，不再各自维护浮窗。
   */
  onOpenAppPicker?: () => void;
  /** 活动进程数量（用于按钮角标显示） */
  activityCount?: number;
  /**
   * 音频状态（可选，分屏桌面模式由 SessionManager 提供，否则回退到 scrcpy context 单例）。
   * 桌面模式下实际音频由 SessionManager 多 session 承载，context 单例无音频状态。
   */
  audioStatus?: 'idle' | 'starting' | 'playing' | 'disabled' | 'errored';
  /** 静音状态（可选，分屏桌面模式由 SessionManager 提供） */
  isMuted?: boolean;
  /** 静音切换（可选，分屏桌面模式由 SessionManager 提供） */
  setMuted?: (muted: boolean) => void;
}

export function ControlSidebar({
  isVirtualDisplay, isRunning, useMirrorMode, isFullscreen, toggleFullscreen, toggleDisplayMode, handleStop,
  keyboardMode, setKeyboardMode,
  currentPreset, resolutionPreset, changeResolutionPreset,
  onDesktopClick, onActivityManagerClick, onLaunchFullscreen, onOpenAppPicker, activityCount,
  audioStatus: propAudioStatus, isMuted: propIsMuted, setMuted: propSetMuted,
}: ControlSidebarProps) {
  const { goBack, goHome, startApp, getAppIcon, getCachedAppLabels, parseAllApps, turnOffPhysicalScreen, turnOnPhysicalScreen, getAllDeviceApps, incrementLocalCount, syncWithDevice, getCacheInfo, getAllDeviceSerials, getDeviceCacheInfo, clearDeviceAppCache, clearDevicePreferences, clearAll, setMuted: ctxSetMuted, setAudioRoute } = useScrcpyActions();
  const { audioStatus: ctxAudioStatus, isMuted: ctxIsMuted, audioRoute } = useScrcpyAudio();
  // AppPicker 切换状态：面板打开时按钮显示按下态，再点击则关闭
  const { config: pickerConfig, closeAppPicker } = useAppPicker();
  const [sidebarPickerOpen, setSidebarPickerOpen] = useState(false);
  // 桌面模式：优先使用 SessionManager 提供的音频状态；单屏模式回退到 context 单例
  const audioStatus = propAudioStatus ?? ctxAudioStatus;
  const isMuted = propIsMuted ?? ctxIsMuted;
  const setMuted = propSetMuted ?? ctxSetMuted;
  const adbStore = useAdbStore();
  const appListVersion = useAdbStore((s) => s.appListVersion);
  const { hasPin } = useDevicePin();
  const rememberedDevices = useRememberedDevices();
  const [appLabels, setAppLabels] = useState<Map<string, string>>(new Map());
  const [pinnedApps, setPinnedApps] = useState<string[]>([]);
  const [sidebarApps, setSidebarApps] = useState<string[]>([]);
  const [physicalScreenOn, setPhysicalScreenOn] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<{ count: number; size: number } | null>(null);
  const [showCacheSettings, setShowCacheSettings] = useState(false);
  const [cacheDevices, setCacheDevices] = useState<DeviceCacheInfo[]>([]);
  const [showPinSetup, setShowPinSetup] = useState(false);

  // picker 从外部关闭（分屏/点击外部/启动应用）时，重置侧栏 toggle 状态
  useEffect(() => {
    if (!pickerConfig) {
      setSidebarPickerOpen(false);
    }
  }, [pickerConfig]);

  // 按「置顶 > 常用 > 其他」分类并写入侧栏状态（纯数据整理，不触发同步/解析）。
  const classifyAndSetSidebarApps = useCallback(
    async (deviceApps: Awaited<ReturnType<typeof getAllDeviceApps>>) => {
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

      setPinnedApps(pinned.map((a) => a.packageName));

      const sorted = [...pinned, ...frequent, ...other];
      const sidebarList = sorted.slice(0, 12).map((a) => a.packageName);
      setSidebarApps(sidebarList);

      getCachedAppLabels(sidebarList).then((labels) => {
        setAppLabels((prev) => {
          const newMap = new Map(prev);
          labels.forEach((value, key) => newMap.set(key, value));
          return newMap;
        });
      });
    },
    [getCachedAppLabels],
  );

  // 只读重载：仅从已写入的 store 重读并刷新侧栏。供 appListVersion 自愈副作用调用，
  // 绝不触发 syncWithDevice/parseAllApps —— 否则会与 bump 形成「同步→bump→同步」死循环。
  const reloadSidebarApps = useCallback(async () => {
    const deviceApps = await getAllDeviceApps();
    await classifyAndSetSidebarApps(deviceApps);
  }, [getAllDeviceApps, classifyAndSetSidebarApps]);

  // 显式恢复 / 手动刷新：forceRefresh 时先全量重解析（清空数据/缓存失效后的恢复路径）；
  // 列表为空时尝试轻量同步。结果直接写 store，由 appListVersion 驱动其它 UI 重读。
  const refreshSidebarApps = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) {
        await parseAllApps();
      }
      let deviceApps = await getAllDeviceApps();
      if (deviceApps.length === 0) {
        const syncResult = await syncWithDevice();
        if (syncResult.toParse.length > 0) {
          await parseAllApps();
        }
        deviceApps = await getAllDeviceApps();
      }
      await classifyAndSetSidebarApps(deviceApps);
    },
    [getAllDeviceApps, syncWithDevice, parseAllApps, classifyAndSetSidebarApps],
  );

  useEffect(() => {
    reloadSidebarApps();
  }, [reloadSidebarApps, appListVersion]);

  // 侧栏 dock 启动：桌面模式优先 onLaunchFullscreen（§9.3 统一全屏启动语义），否则 startApp。
  const handleDockLaunch = useCallback((pkg: string) => {
    if (onLaunchFullscreen) {
      onLaunchFullscreen(pkg);
    } else {
      startApp(pkg);
    }
    incrementLocalCount(pkg).then(() => {
      refreshSidebarApps();
    }).catch(() => {});
  }, [onLaunchFullscreen, startApp, incrementLocalCount, refreshSidebarApps]);

  return (
    <>
      <div className="w-13 h-full flex flex-col items-center py-2 gap-1 bg-slate-950 border-r border-white/5">
        <span data-sidebar-trigger="true">
        <NeumorphicButton
          variant="dark"
          toggled={sidebarPickerOpen}
          onClick={() => {
            if (sidebarPickerOpen) {
              closeAppPicker();
              setSidebarPickerOpen(false);
            } else {
              onOpenAppPicker?.();
              setSidebarPickerOpen(true);
            }
          }}
          title="应用列表"
        >
          <Grid2X2 size={ICON_SIZE} />
        </NeumorphicButton>
        </span>

        <div className="w-8 h-px bg-white/10 my-1" />

        <div className="flex flex-col items-center gap-1 overflow-y-auto max-h-[calc(100vh-280px)] scrollbar-none">
          {pinnedApps.map((pkg) => (
            <AppIcon
              key={`pinned-${pkg}`}
              pkg={pkg}
              name={appLabels.get(pkg) || pkg}
              getAppIcon={getAppIcon}
              onLaunch={handleDockLaunch}
              compact
              cacheVersion={appListVersion}
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
                name={appLabels.get(pkg) || pkg}
                getAppIcon={getAppIcon}
                onLaunch={handleDockLaunch}
                compact
                cacheVersion={appListVersion}
              />
            ))}
        </div>

        <div className="flex-1" />

        <div className="flex flex-col items-center" style={{ gap: '12px' }}>

        {toggleFullscreen && (
          <NeumorphicButton variant="dark"
            onClick={toggleFullscreen}
            toggled={!!isFullscreen}
            title={isFullscreen ? '退出全屏' : '全屏'}
          >
            {isFullscreen ? <Minimize2 size={ICON_SIZE} /> : <Maximize2 size={ICON_SIZE} />}
          </NeumorphicButton>
        )}

        <NeumorphicButton variant="dark" onClick={goBack} title="返回">
          <ArrowLeft size={ICON_SIZE} />
        </NeumorphicButton>
        {/* §9.1 桌面按钮语义变更：从 goHome（Android Home intent）改为切换到 Web 桌面视图 */}
        <NeumorphicButton variant="dark"
          onClick={onDesktopClick ?? goHome}
          title="桌面"
        >
          <Home size={ICON_SIZE} />
        </NeumorphicButton>

        {/* §9.1 新增活动进程按钮 */}
        {onActivityManagerClick && (
          <NeumorphicButton variant="dark"
            onClick={onActivityManagerClick}
            title="活动进程"
          >
            <AppWindow size={ICON_SIZE} />
            {activityCount && activityCount > 0 ? (
              <span
                className="absolute -top-0.5 -right-0.5 bg-accent-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center"
                style={{ position: 'absolute' }}
              >
                {activityCount > 9 ? '9+' : activityCount}
              </span>
            ) : null}
          </NeumorphicButton>
        )}

        {isVirtualDisplay && turnOffPhysicalScreen && turnOnPhysicalScreen && (
          <NeumorphicButton variant="dark"
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
          <NeumorphicButton variant="dark"
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
          <NeumorphicButton variant="dark" onClick={handleStop} title="断开连接" color="#EF4444" toggledColor="#EF4444">
            <Power size={ICON_SIZE} />
          </NeumorphicButton>
        )}

        <div className="w-8 h-px bg-white/10 my-1" />

        <div className="relative">
          <NeumorphicButton variant="dark"
            onClick={async () => {
              if (!showSettings) {
                const info = await getCacheInfo();
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
              className="absolute bottom-full left-full mb-1 ml-1 bg-slate-800/95 backdrop-blur-xl border border-slate-700 rounded-xl overflow-hidden z-50 min-w-[168px] shadow-float animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2.5 text-xs text-slate-400 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span>缓存大小</span>
                  <span className="text-slate-100 font-mono tabular-nums">{formatCacheSize(cacheInfo?.size ?? 0)}</span>
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
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] transition-colors ${
                      keyboardMode === 'browser' ? 'bg-accent-500/20 text-accent-400' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {keyboardMode === 'phone'
                      ? <><Smartphone className="w-3 h-3" /> 手机</>
                      : <><Keyboard className="w-3 h-3" /> 浏览器</>}
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
                    className={`px-2 py-0.5 rounded-md text-[10px] transition-colors ${
                      adbStore.deviceSerial && hasPin(adbStore.deviceSerial)
                        ? 'bg-accent-500/20 text-accent-400'
                        : adbStore.deviceSerial
                          ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed'
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
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] transition-colors ${
                      audioRoute === 'browser' ? 'bg-accent-500/20 text-accent-400' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {audioRoute === 'browser'
                      ? <><Volume2 className="w-3 h-3" /> 浏览器</>
                      : <><Smartphone className="w-3 h-3" /> 手机</>}
                  </button>
                </div>
                {isRunning && toggleDisplayMode && (
                  <div className="flex items-center justify-between gap-3">
                    <span>显示模式</span>
                    <button
                      onClick={toggleDisplayMode}
                      className={`px-2 py-0.5 rounded-md text-[10px] transition-colors ${
                        useMirrorMode ? 'bg-accent-500/20 text-accent-400' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
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
                        className="px-2 py-0.5 rounded-md text-[10px] bg-slate-700 text-slate-300 border-none outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-accent-400"
                      >
                        {RESOLUTION_PRESETS.map(p => (
                          <option key={p.key} value={p.key}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <button
                  onClick={async () => {
                    setShowSettings(false);
                    try {
                      const serials = await getAllDeviceSerials();
                      const deviceInfos: DeviceCacheInfo[] = await Promise.all(
                        serials.map(async (serial) => {
                          const deviceName = rememberedDevices.devices.find(d => d.id === serial)?.name ?? serial.slice(0, 8);
                          const info = await getDeviceCacheInfo(serial);
                          return { deviceSerial: serial, deviceName, ...info };
                        })
                      );
                      setCacheDevices(deviceInfos);
                    } catch (e) {
                      console.warn('获取设备缓存信息失败:', e);
                      setCacheDevices([]);
                    }
                    setShowCacheSettings(true);
                  }}
                  className="flex items-center gap-1.5 pt-1 border-t border-slate-700 mt-1 text-slate-500 hover:text-slate-100 transition-colors w-full"
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
          devices={cacheDevices}
          onClearDeviceAppCache={async (serial) => {
            await clearDeviceAppCache(serial);
            refreshSidebarApps();
          }}
          onClearDevicePreferences={async (serial) => {
            await clearDevicePreferences(serial);
            refreshSidebarApps();
          }}
          onClearAll={async () => {
            await clearAll();
            setCacheDevices([]);
            setCacheInfo(null);
            setAppLabels(new Map());
            refreshSidebarApps(true);
          }}
        />
      </div>
      </div>
    </>
  );
}

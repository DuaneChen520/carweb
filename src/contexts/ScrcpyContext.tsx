import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useScrcpySession as useCombinedScrcpySession, type DisplayConfig } from '@/hooks/scrcpy';
import type { AudioState } from '@/hooks/scrcpy/audio/types';
import type { Adb } from '@yume-chan/adb';
import type { ParseProgress, SyncResult } from '@/lib/app-info-service';
import type { FlexDisplayClient } from '@/lib/scrcpy4';

// ──────────────────────────────────────────────
// Context 1: 稳定回调（Actions）—— 引用永不变，消费者零重渲染成本
// ──────────────────────────────────────────────
interface ScrcpyActionsValue {
  startScrcpy: (adb: Adb, canvas: HTMLCanvasElement, displayConfig?: DisplayConfig, setCanvasSize?: (w: number, h: number) => void) => Promise<void>;
  stopScrcpy: () => Promise<void>;
  injectTouch: (message: {
    action: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    pointerId: bigint;
    pointerX: number;
    pointerY: number;
    videoWidth: number;
    videoHeight: number;
    pressure: number;
    actionButton: number;
    buttons: number;
  }) => Promise<void>;
  injectText: (text: string) => Promise<void>;
  showKeyboard: () => Promise<void>;
  hideKeyboard: () => Promise<void>;
  startApp: (appName: string) => Promise<void>;
  goHome: () => Promise<void>;
  goBack: () => Promise<void>;
  showRecentApps: () => Promise<void>;
  getAppList: (showSystem?: boolean) => Promise<string[]>;
  getAppIcon: (pkg: string) => Promise<string | null>;
  getAppLabel: (pkg: string) => Promise<string>;
  batchGetAppLabels: (packages: string[]) => Promise<Map<string, string>>;
  parseAllApps: (onProgress?: (progress: ParseProgress) => void) => Promise<void>;
  abortParseApps: () => void;
  getCachedAppLabels: (packages: string[]) => Promise<Map<string, string>>;
  getAllCachedPackages: () => Promise<string[]>;
  clearAppInfoCache: () => Promise<void>;
  getCacheInfo: () => Promise<{ count: number; size: number }>;
  togglePhysicalScreen: () => Promise<void>;
  turnOffPhysicalScreen: () => Promise<void>;
  turnOnPhysicalScreen: () => Promise<void>;
  resizeDisplay: (width: number, height: number, dpi: number) => Promise<void>;
  getForegroundApp: () => Promise<string | null>;
  resumeAudio: () => void;
  setAudioRoute: (route: 'browser' | 'phone') => void;
  setMuted: (muted: boolean) => void;
  getAllDeviceApps: () => Promise<import('@/lib/device-apps-store').DeviceAppRecord[]>;
  incrementLocalCount: (pkg: string) => Promise<void>;
  togglePin: (pkg: string) => Promise<boolean>;
  getPinnedApps: () => Promise<import('@/lib/device-apps-store').DeviceAppRecord[]>;
  clearDeviceApps: () => Promise<void>;
  clearAll: () => Promise<void>;
  setAdb: (adb: Adb | null) => void;
  syncAndParseIfNeeded: (signal?: AbortSignal) => Promise<SyncResult>;
  syncWithDevice: (signal?: AbortSignal) => Promise<SyncResult>;
  clearDeviceAppCache: (serial: string) => Promise<void>;
  clearDevicePreferences: (serial: string) => Promise<void>;
  getDeviceCacheInfo: (serial: string) => Promise<{appCacheCount: number; appCacheSize: number; pinnedCount: number; launchCount: number}>;
  getAllDeviceSerials: () => Promise<string[]>;
}

// ──────────────────────────────────────────────
// Context 2: 会话状态 + flexClient（响应式，变化时重渲染 VirtualScreen/DesktopScreen）
// ──────────────────────────────────────────────
interface ScrcpySessionValue {
  isStarting: boolean;
  isRunning: boolean;
  error: string | null;
  videoWidth: number;
  videoHeight: number;
  isVirtualDisplay: boolean;
  flexClient: FlexDisplayClient | null;
  flexClientRef: React.MutableRefObject<FlexDisplayClient | null>;
}

// ──────────────────────────────────────────────
// Context 3: 音频状态（响应式，变化时仅重渲染 ControlSidebar 音频面板）
// ──────────────────────────────────────────────
interface ScrcpyAudioValue {
  audioRoute: 'browser' | 'phone';
  isMuted: boolean;
  audioStatus: AudioState['status'];
}

// ──────────────────────────────────────────────
// Context 创建
// ──────────────────────────────────────────────
const ScrcpyActionsCtx = createContext<ScrcpyActionsValue | null>(null);
const ScrcpySessionCtx = createContext<ScrcpySessionValue | null>(null);
const ScrcpyAudioCtx = createContext<ScrcpyAudioValue | null>(null);

// ──────────────────────────────────────────────
// Provider —— 3 层嵌套，各自独立变更
// ──────────────────────────────────────────────
export function ScrcpyProvider({ children }: { children: ReactNode }) {
  const session = useCombinedScrcpySession();

  // Actions 层的稳定钩子：依赖数组只包含回调引用（均为 useCallback 包裹，稳定不变）
  const actionsValue = useMemo(() => ({
    startScrcpy: session.startScrcpy,
    stopScrcpy: session.stopScrcpy,
    injectTouch: session.injectTouch,
    injectText: session.injectText,
    showKeyboard: session.showKeyboard,
    hideKeyboard: session.hideKeyboard,
    startApp: session.startApp,
    goHome: session.goHome,
    goBack: session.goBack,
    showRecentApps: session.showRecentApps,
    getAppList: session.getAppList,
    getAppIcon: session.getAppIcon,
    getAppLabel: session.getAppLabel,
    batchGetAppLabels: session.batchGetAppLabels,
    parseAllApps: session.parseAllApps,
    abortParseApps: session.abortParseApps,
    getCachedAppLabels: session.getCachedAppLabels,
    getAllCachedPackages: session.getAllCachedPackages,
    clearAppInfoCache: session.clearAppInfoCache,
    getCacheInfo: session.getCacheInfo,
    togglePhysicalScreen: session.togglePhysicalScreen,
    turnOffPhysicalScreen: session.turnOffPhysicalScreen,
    turnOnPhysicalScreen: session.turnOnPhysicalScreen,
    resizeDisplay: session.resizeDisplay,
    getForegroundApp: session.getForegroundApp,
    resumeAudio: session.resumeAudio,
    setAudioRoute: session.setAudioRoute,
    setMuted: session.setMuted,
    getAllDeviceApps: session.getAllDeviceApps,
    incrementLocalCount: session.incrementLocalCount,
    togglePin: session.togglePin,
    getPinnedApps: session.getPinnedApps,
    clearDeviceApps: session.clearDeviceApps,
    clearAll: session.clearAll,
    setAdb: session.setAdb,
    syncAndParseIfNeeded: session.syncAndParseIfNeeded,
    syncWithDevice: session.syncWithDevice,
    clearDeviceAppCache: session.clearDeviceAppCache,
    clearDevicePreferences: session.clearDevicePreferences,
    getDeviceCacheInfo: session.getDeviceCacheInfo,
    getAllDeviceSerials: session.getAllDeviceSerials,
  }), [
    session.startScrcpy, session.stopScrcpy, session.injectTouch, session.injectText,
    session.showKeyboard, session.hideKeyboard, session.startApp, session.goHome,
    session.goBack, session.showRecentApps, session.getAppList, session.getAppIcon,
    session.getAppLabel, session.batchGetAppLabels, session.parseAllApps,
    session.abortParseApps, session.getCachedAppLabels, session.getAllCachedPackages,
    session.clearAppInfoCache, session.getCacheInfo, session.togglePhysicalScreen,
    session.turnOffPhysicalScreen, session.turnOnPhysicalScreen, session.resizeDisplay,
    session.getForegroundApp, session.resumeAudio, session.setAudioRoute, session.setMuted,
    session.getAllDeviceApps, session.incrementLocalCount, session.togglePin,
    session.getPinnedApps, session.clearDeviceApps, session.clearAll, session.setAdb,
    session.syncAndParseIfNeeded, session.syncWithDevice, session.clearDeviceAppCache,
    session.clearDevicePreferences, session.getDeviceCacheInfo, session.getAllDeviceSerials,
  ]);

  // 会话状态层：仅状态字段变化时重建
  const sessionValue = useMemo(() => ({
    isStarting: session.isStarting,
    isRunning: session.isRunning,
    error: session.error,
    videoWidth: session.videoWidth,
    videoHeight: session.videoHeight,
    isVirtualDisplay: session.isVirtualDisplay,
    flexClient: session.flexClient,
    flexClientRef: session.flexClientRef,
  }), [
    session.isStarting, session.isRunning, session.error,
    session.videoWidth, session.videoHeight, session.isVirtualDisplay,
    session.flexClient, session.flexClientRef,
  ]);

  // 音频状态层：仅音频字段变化时重建
  const audioValue = useMemo(() => ({
    audioRoute: session.audioRoute,
    isMuted: session.isMuted,
    audioStatus: session.audioStatus,
  }), [
    session.audioRoute, session.isMuted, session.audioStatus,
  ]);

  return (
    <ScrcpyActionsCtx.Provider value={actionsValue}>
      <ScrcpySessionCtx.Provider value={sessionValue}>
        <ScrcpyAudioCtx.Provider value={audioValue}>
          {children}
        </ScrcpyAudioCtx.Provider>
      </ScrcpySessionCtx.Provider>
    </ScrcpyActionsCtx.Provider>
  );
}

// ──────────────────────────────────────────────
// 3 个 Hook —— 消费者按需订阅
// ──────────────────────────────────────────────
export function useScrcpyActions(): ScrcpyActionsValue {
  const ctx = useContext(ScrcpyActionsCtx);
  if (!ctx) throw new Error('useScrcpyActions must be used within a ScrcpyProvider');
  return ctx;
}

export function useScrcpySession(): ScrcpySessionValue {
  const ctx = useContext(ScrcpySessionCtx);
  if (!ctx) throw new Error('useScrcpySession must be used within a ScrcpyProvider');
  return ctx;
}

export function useScrcpyAudio(): ScrcpyAudioValue {
  const ctx = useContext(ScrcpyAudioCtx);
  if (!ctx) throw new Error('useScrcpyAudio must be used within a ScrcpyProvider');
  return ctx;
}
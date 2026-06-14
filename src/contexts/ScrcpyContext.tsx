import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useScrcpySession, type ScrcpyState, type DisplayConfig } from '@/hooks/scrcpy';
import type { Adb } from '@yume-chan/adb';
import type { ParseProgress } from '@/lib/app-info-service';

interface ScrcpyContextValue extends ScrcpyState {
  startScrcpy: (adb: Adb, canvas: HTMLCanvasElement, displayConfig?: DisplayConfig, isRetry?: boolean) => Promise<void>;
  stopScrcpy: () => Promise<void>;
  clearFallback: () => void;
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
  startAppOnDisplay: (packageName: string) => Promise<void>;
  goHome: () => Promise<void>;
  goBack: () => Promise<void>;
  showRecentApps: () => Promise<void>;
  getAppList: (showSystem?: boolean) => Promise<string[]>;
  getAppIcon: (pkg: string) => Promise<string | null>;
  getAppLabel: (pkg: string) => Promise<string>;
  batchGetAppLabels: (packages: string[]) => Promise<Map<string, string>>;
  parseAllApps: (includeSystem: boolean, onProgress?: (progress: ParseProgress) => void) => Promise<void>;
  abortParseApps: () => void;
  getCachedAppLabels: (packages: string[]) => Promise<Map<string, string>>;
  clearAppInfoCache: () => Promise<void>;
  getCacheInfo: () => Promise<{ count: number; size: number }>;
  togglePhysicalScreen: () => Promise<void>;
  turnOffPhysicalScreen: () => Promise<void>;
  turnOnPhysicalScreen: () => Promise<void>;
  resizeDisplay: (width: number, height: number, dpi: number) => Promise<void>;
  getForegroundApp: () => Promise<string | null>;
  resumeAudio: () => void;
}

const ScrcpyContext = createContext<ScrcpyContextValue | null>(null);

export function ScrcpyProvider({ children }: { children: ReactNode }) {
  const session = useScrcpySession();

  const value = useMemo(() => session, [
    session.isStarting,
    session.isRunning,
    session.error,
    session.videoWidth,
    session.videoHeight,
    session.isVirtualDisplay,
    session.fallbackToMirror,
    session.startScrcpy,
    session.stopScrcpy,
    session.clearFallback,
    session.injectTouch,
    session.injectText,
    session.showKeyboard,
    session.hideKeyboard,
    session.startApp,
    session.startAppOnDisplay,
    session.goHome,
    session.goBack,
    session.showRecentApps,
    session.getAppList,
    session.getAppIcon,
    session.getAppLabel,
    session.batchGetAppLabels,
    session.parseAllApps,
    session.abortParseApps,
    session.getCachedAppLabels,
    session.clearAppInfoCache,
    session.getCacheInfo,
    session.togglePhysicalScreen,
    session.turnOffPhysicalScreen,
    session.turnOnPhysicalScreen,
    session.resizeDisplay,
    session.getForegroundApp,
    session.resumeAudio,
  ]);

  return (
    <ScrcpyContext.Provider value={value}>
      {children}
    </ScrcpyContext.Provider>
  );
}

export function useScrcpyContext() {
  const context = useContext(ScrcpyContext);
  if (!context) {
    throw new Error('useScrcpyContext must be used within a ScrcpyProvider');
  }
  return context;
}

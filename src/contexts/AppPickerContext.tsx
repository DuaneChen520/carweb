import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PaneSlot } from '@/lib/session-manager';
import { AppPicker } from '@/components/AppPicker';

/**
 * 统一「全部应用」浮窗的启动落点模式（ADR-0010 D1）。
 * - single：镜像 / 单虚拟屏 → startApp
 * - pane：桌面左/右半屏 → onLaunchOnPane
 * - fullscreen：桌面全屏受管会话 → onLaunchFullscreen
 */
export type AppPickerMode = 'single' | 'pane' | 'fullscreen';

export interface AppPickerConfig {
  mode: AppPickerMode;
  /** pane 模式下的目标分屏 */
  targetPane?: PaneSlot;
  /** 启动回调：由调用方决定投送到哪个运行时 */
  onLaunch: (pkg: string) => void;
  /** 可选标题覆盖（否则组件按 mode 自动生成） */
  title?: string;
}

interface AppPickerContextValue {
  openAppPicker: (config: AppPickerConfig) => void;
  closeAppPicker: () => void;
  /** 当前打开的 config；null 表示未打开 */
  config: AppPickerConfig | null;
}

const AppPickerContext = createContext<AppPickerContextValue | null>(null);

export function AppPickerProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppPickerConfig | null>(null);

  const openAppPicker = useCallback((cfg: AppPickerConfig) => {
    setConfig(cfg);
  }, []);

  const closeAppPicker = useCallback(() => {
    setConfig(null);
  }, []);

  const value = useMemo<AppPickerContextValue>(
    () => ({ openAppPicker, closeAppPicker, config }),
    [openAppPicker, closeAppPicker, config],
  );

  return (
    <AppPickerContext.Provider value={value}>
      {children}
      {config && <AppPicker config={config} onClose={closeAppPicker} />}
    </AppPickerContext.Provider>
  );
}

export function useAppPicker(): AppPickerContextValue {
  const ctx = useContext(AppPickerContext);
  if (!ctx) {
    throw new Error('useAppPicker must be used within an AppPickerProvider');
  }
  return ctx;
}

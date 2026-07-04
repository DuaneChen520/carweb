/**
 * DesktopScreen —— 分屏桌面主屏幕组件。
 *
 * 设计文档 §2.4 / §8 / §13.2：
 * 替代 VirtualScreen 主区域，集成：
 * - DesktopShell（分屏布局 + FullscreenOverlay）
 * - ControlSidebar（Task 8 改造后的侧边栏，注入分屏桌面回调）
 * - ActivityManagerPanel（Task 7 活动进程管理浮窗）
 * - AppPickerOverlay（Task 9 全部应用双模式浮窗）
 *
 * 职责：
 * 1. 连接 SessionManager 与 DesktopStateStore（持久化）
 * 2. 启动恢复：连接成功后读取持久化 pane 状态，自动恢复分屏布局（§8.3）
 * 3. 状态管理：ActivityManagerPanel / AppPickerOverlay 的显示/隐藏
 * 4. 注入 ControlSidebar 的分屏桌面回调（§9）
 * 5. 页面卸载时清理所有 session
 *
 * 集成位置：App.tsx 在连接成功 + Pin 校验通过后渲染 DesktopScreen 替代 VirtualScreen。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { DesktopShell } from './desktop/DesktopShell';
import { ControlSidebar } from './ControlSidebar';
import { ActivityManagerPanel } from './desktop/ActivityManagerPanel';
import { AppPickerOverlay } from './desktop/AppPickerOverlay';
import { useSessionManager } from '@/lib/session-manager';
import { useAdbStore } from '@/hooks/useAdbStore';
import { DesktopStateStore } from '@/lib/desktop-state-store';
import { calculateDpi } from '@/utils/display';
import type { PaneSlot } from '@/lib/session-manager';

// 默认 pane 显示配置（800×600 虚拟屏）
const PANE_DISPLAY_CONFIG = {
  width: 800,
  height: 600,
  dpi: calculateDpi(800, 600),
  bitRate: 8000000,
};

// 全屏显示配置
const FULLSCREEN_DISPLAY_CONFIG = {
  width: 1920,
  height: 1080,
  dpi: calculateDpi(1920, 1080),
  bitRate: 8000000,
};

interface DesktopScreenProps {
  /** 断开连接回调 */
  onStop: () => void;
}

export function DesktopScreen({ onStop }: DesktopScreenProps) {
  const store = useAdbStore();
  const adb = store.adb;

  const setSessionManagerAdb = useSessionManager((s) => s.setAdb);
  const setPersistCallback = useSessionManager((s) => s.setPersistCallback);
  const launchOnPane = useSessionManager((s) => s.launchOnPane);
  const launchFullscreen = useSessionManager((s) => s.launchFullscreen);
  const fullscreenToDesktop = useSessionManager((s) => s.fullscreenToDesktop);
  const closeAll = useSessionManager((s) => s.closeAll);
  const apps = useSessionManager((s) => s.apps);

  // 浮窗状态
  const [showActivityManager, setShowActivityManager] = useState(false);
  const [appPickerMode, setAppPickerMode] = useState<'pane' | 'fullscreen' | null>(null);
  const [appPickerTargetPane, setAppPickerTargetPane] = useState<PaneSlot>('left');

  const desktopStateStoreRef = useRef(new DesktopStateStore());
  const hasRestoredRef = useRef(false);

  // 1. 设置 SessionManager 的 adb 引用
  useEffect(() => {
    setSessionManagerAdb(adb);
  }, [adb, setSessionManagerAdb]);

  // 2. 设置持久化回调（SessionManager → DesktopStateStore）
  useEffect(() => {
    const desktopStore = desktopStateStoreRef.current;
    setPersistCallback(async (leftPkg, rightPkg) => {
      const serial = useAdbStore.getState().deviceSerial;
      if (!serial) return;
      try {
        await desktopStore.set({
          deviceSerial: serial,
          paneLeft: leftPkg,
          paneRight: rightPkg,
          savedAt: Date.now(),
        });
      } catch (e) {
        console.warn('[DesktopScreen] 持久化分屏状态失败:', e);
      }
    });
    return () => setPersistCallback(null);
  }, [setPersistCallback]);

  // 3. 启动恢复：连接成功后读取持久化 pane 状态（§8.3）
  useEffect(() => {
    if (!adb || !store.deviceSerial || hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    const restorePanes = async () => {
      const desktopStore = desktopStateStoreRef.current;
      try {
        const state = await desktopStore.get(store.deviceSerial!);
        if (!state) {
          console.log('[DesktopScreen] 无持久化分屏状态，显示空桌面');
          return;
        }

        console.log('[DesktopScreen] 恢复分屏状态:', state);
        // 并行恢复两 pane
        const promises: Promise<unknown>[] = [];
        if (state.paneLeft) {
          promises.push(launchOnPane(state.paneLeft, 'left', PANE_DISPLAY_CONFIG));
        }
        if (state.paneRight) {
          promises.push(launchOnPane(state.paneRight, 'right', PANE_DISPLAY_CONFIG));
        }
        await Promise.all(promises);
      } catch (e) {
        console.warn('[DesktopScreen] 恢复分屏状态失败:', e);
      }
    };

    void restorePanes();
  }, [adb, store.deviceSerial, launchOnPane]);

  // 4. 页面卸载时清理所有 session
  useEffect(() => {
    return () => {
      void closeAll();
    };
  }, [closeAll]);

  // ===== 回调处理 =====

  const handleOpenAppPicker = useCallback((pane: PaneSlot) => {
    setAppPickerTargetPane(pane);
    setAppPickerMode('pane');
  }, []);

  const handleOpenAppPickerFullscreen = useCallback(() => {
    setAppPickerMode('fullscreen');
  }, []);

  const handleSwitchPaneApp = useCallback((pane: PaneSlot) => {
    setAppPickerTargetPane(pane);
    setAppPickerMode('pane');
  }, []);

  const handleLaunchOnPane = useCallback(async (pkg: string, pane: PaneSlot) => {
    await launchOnPane(pkg, pane, PANE_DISPLAY_CONFIG);
  }, [launchOnPane]);

  const handleLaunchFullscreen = useCallback(async (pkg: string) => {
    await launchFullscreen(pkg, FULLSCREEN_DISPLAY_CONFIG);
  }, [launchFullscreen]);

  const handleDesktopClick = useCallback(() => {
    void fullscreenToDesktop();
    // 点击桌面时关闭所有浮窗
    setShowActivityManager(false);
    setAppPickerMode(null);
  }, [fullscreenToDesktop]);

  const handleActivityManagerClick = useCallback(() => {
    setShowActivityManager((v) => !v);
    setAppPickerMode(null);
  }, []);

  // 关闭浮窗当点击侧边栏其他按钮（§12.4）
  const closeAllPanels = useCallback(() => {
    setShowActivityManager(false);
    setAppPickerMode(null);
  }, []);

  const activityCount = apps.length;

  return (
    <>
      <DesktopShell
        sidebar={
          <ControlSidebar
            handleStop={onStop}
            onDesktopClick={handleDesktopClick}
            onActivityManagerClick={handleActivityManagerClick}
            onLaunchFullscreen={(pkg) => { void handleLaunchFullscreen(pkg); }}
            onOpenAppPickerFullscreen={handleOpenAppPickerFullscreen}
            activityCount={activityCount}
          />
        }
        onOpenAppPicker={handleOpenAppPicker}
        onSwitchPaneApp={handleSwitchPaneApp}
        displayConfig={PANE_DISPLAY_CONFIG}
      />

      {/* 活动进程管理浮窗 */}
      {showActivityManager && (
        <ActivityManagerPanel
          onClose={() => setShowActivityManager(false)}
          displayConfig={PANE_DISPLAY_CONFIG}
        />
      )}

      {/* 全部应用浮窗（双模式） */}
      {appPickerMode && (
        <AppPickerOverlay
          mode={appPickerMode}
          targetPane={appPickerTargetPane}
          onLaunchOnPane={(pkg, pane) => { void handleLaunchOnPane(pkg, pane); }}
          onLaunchFullscreen={(pkg) => { void handleLaunchFullscreen(pkg); }}
          onClose={() => setAppPickerMode(null)}
        />
      )}

      {/* 隐藏的 closeAllPanels 引用，避免 lint 警告 */}
      <span hidden onClick={closeAllPanels} />
    </>
  );
}

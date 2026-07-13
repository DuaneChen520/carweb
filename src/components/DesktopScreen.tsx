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
import { useSessionManager } from '@/lib/session-manager';
import { useAdbStore } from '@/hooks/useAdbStore';
import { useScrcpyContext } from '@/contexts/ScrcpyContext';
import { useAppPicker } from '@/contexts/AppPickerContext';
import { DesktopStateStore } from '@/lib/desktop-state-store';
import { calculateDpi } from '@/utils/display';
import type { PaneSlot } from '@/lib/session-manager';
import type { DisplayConfig } from '@/lib/scrcpy-session';

// 兜底尺寸：DOM 尚未就绪（如极端 SSR/测试场景）时使用，避免以 0×0 创建虚拟屏。
const FALLBACK_PANE = { width: 800, height: 600 };
const FALLBACK_FULLSCREEN = { width: 1920, height: 1080 };

/**
 * 从真实 pane 容器尺寸推导初始 displayConfig，使虚拟屏创建即正确尺寸，
 * 消除硬编码 800×600 带来的瞬态旋转/闪烁风险（ADR-0001）。
 * 像素尺寸公式对齐 VirtualScreen：width/height = CSS 尺寸 × scale × dpr。
 */
function buildPaneDisplayConfig(pane: PaneSlot, scale = 1.0): DisplayConfig {
  const el = typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>(`[data-pane="${pane}"]`)
    : null;
  const cssW = el?.clientWidth ?? 0;
  const cssH = el?.clientHeight ?? 0;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const w = Math.round((cssW > 0 ? cssW : FALLBACK_PANE.width) * scale * dpr);
  const h = Math.round((cssH > 0 ? cssH : FALLBACK_PANE.height) * scale * dpr);
  const pixelRatio = (w * h) / (1920 * 1080);
  return {
    width: w,
    height: h,
    dpi: calculateDpi(w, h),
    bitRate: Math.max(1000000, Math.min(40000000, Math.round(8000000 * pixelRatio))),
  };
}

/**
 * 全屏虚拟屏初始尺寸 = DesktopArea 真实尺寸（覆盖侧边栏右侧区域）。
 * 同样消除硬编码 1920×1080 与真实全屏区域不符的瞬态。
 */
function buildFullscreenDisplayConfig(scale = 1.0): DisplayConfig {
  const el = typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('[data-desktop-area]')
    : null;
  const cssW = el?.clientWidth ?? 0;
  const cssH = el?.clientHeight ?? 0;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const w = Math.round((cssW > 0 ? cssW : FALLBACK_FULLSCREEN.width) * scale * dpr);
  const h = Math.round((cssH > 0 ? cssH : FALLBACK_FULLSCREEN.height) * scale * dpr);
  const pixelRatio = (w * h) / (1920 * 1080);
  return {
    width: w,
    height: h,
    dpi: calculateDpi(w, h),
    bitRate: Math.max(1000000, Math.min(40000000, Math.round(8000000 * pixelRatio))),
  };
}

interface DesktopScreenProps {
  /** 断开连接回调 */
  onStop: () => void;
}

export function DesktopScreen({ onStop }: DesktopScreenProps) {
  const store = useAdbStore();
  const adb = store.adb;
  const scrcpy = useScrcpyContext();
  const { setAdb: setAppManagerAdb, syncAndParseIfNeeded } = scrcpy;

  const setSessionManagerAdb = useSessionManager((s) => s.setAdb);
  const setPersistCallback = useSessionManager((s) => s.setPersistCallback);
  const launchOnPane = useSessionManager((s) => s.launchOnPane);
  const launchFullscreen = useSessionManager((s) => s.launchFullscreen);
  const fullscreenToDesktop = useSessionManager((s) => s.fullscreenToDesktop);
  const closeAll = useSessionManager((s) => s.closeAll);
  const apps = useSessionManager((s) => s.apps);
  const audioStatus = useSessionManager((s) => s.audioStatus);
  const isMuted = useSessionManager((s) => s.isMuted);
  const setMuted = useSessionManager((s) => s.setMuted);

  // 浮窗状态
  const [showActivityManager, setShowActivityManager] = useState(false);

  // 浏览器全屏（§9.2 保留按钮）
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!isFullscreen) {
        await fullscreenRef.current?.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('全屏切换失败:', error);
    }
  }, [isFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const desktopStateStoreRef = useRef(new DesktopStateStore());
  const hasRestoredRef = useRef(false);

  // 1. 设置 SessionManager 的 adb 引用；同时把 adb 注入 AppManager（应用信息解析器），
  //    并触发一次后台同步。桌面分屏模式不经 useScrcpySession.startScrcpy，
  //    否则 AppManager.adbRef 永远为空 → syncWithDevice/parseAllApps 全静默失败 → 列表空。
  useEffect(() => {
    setSessionManagerAdb(adb);
    if (adb) {
      console.log('[DesktopScreen] 注入 AppManager adb，触发后台应用列表同步');
      setAppManagerAdb(adb);
      syncAndParseIfNeeded().catch((err) =>
        console.warn('[DesktopScreen] 后台同步应用列表失败:', err),
      );
    }
  }, [adb, setSessionManagerAdb, setAppManagerAdb, syncAndParseIfNeeded]);

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
    // 仅在「已连接且存活」时恢复分屏：以 connectionStatus === 'connected' 为权威活性信号，
    // 避免对死连接（adb 引用非空但 transport 已断）启动 scrcpy（AdbScrcpyExitedError）。
    // 断开后清空 hasRestoredRef，使重连后能重新恢复分屏布局。
    if (store.connectionStatus !== 'connected' || !store.deviceSerial) {
      if (store.connectionStatus !== 'connected') {
        hasRestoredRef.current = false;
      }
      return;
    }
    if (hasRestoredRef.current) return;
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
        // 串行恢复两 pane：避免两个 AdbScrcpyClient 同时绑定设备端
        // localabstract:scrcpy 反向隧道导致第二个 server exited prematurely（socket 冲突）。
        const paneTasks: Array<{ slot: PaneSlot; pkg: string }> = [];
        if (state.paneLeft) {
          paneTasks.push({ slot: 'left', pkg: state.paneLeft });
        }
        if (state.paneRight) {
          paneTasks.push({ slot: 'right', pkg: state.paneRight });
        }
        for (const task of paneTasks) {
          try {
            await launchOnPane(task.pkg, task.slot, buildPaneDisplayConfig(task.slot));
          } catch (e) {
            console.error(`[DesktopScreen] 启动 ${task.slot} pane (${task.pkg}) 失败:`, e);
          }
        }
      } catch (e) {
        console.warn('[DesktopScreen] 恢复分屏状态失败:', e);
      }
    };

    void restorePanes();
  }, [store.connectionStatus, store.deviceSerial, launchOnPane]);

  // 4. 页面卸载时清理所有 session
  useEffect(() => {
    return () => {
      void closeAll();
    };
  }, [closeAll]);

  // 5. 用户手势唤醒所有 session 的 AudioContext（修复分屏桌面浏览器端无声，ADR-0013）
  // 根因：分屏桌面的触控 handler（useCanvasPointerInput）只调 session.injectTouch()，
  // 从不调 resumeAudio()，而每个 ScrcpySession 的 AudioContext 创建时处于 suspended
  // （浏览器自动播放策略），必须由用户手势内同步调用 resume() 才出声。
  // 故在此挂持久化的全局 pointerdown/keydown 监听，任意交互即唤醒 SessionManager
  // 中所有活跃 session 的 AudioContext（含稍后启动、用户尚未触控的 pane）。
  useEffect(() => {
    const resumeAllAudio = () => {
      const { sessions } = useSessionManager.getState();
      for (const entry of Object.values(sessions)) {
        entry.session.resumeAudio();
      }
    };
    document.addEventListener('pointerdown', resumeAllAudio);
    document.addEventListener('keydown', resumeAllAudio);
    return () => {
      document.removeEventListener('pointerdown', resumeAllAudio);
      document.removeEventListener('keydown', resumeAllAudio);
    };
  }, []);

  // ===== 回调处理 =====
  const { openAppPicker } = useAppPicker();

  // 桌面分屏/全屏启动（投送回调由调用方在 AppPicker config 中提供，ADR-0010 D1/D3）
  const handleLaunchOnPane = useCallback(async (pkg: string, pane: PaneSlot) => {
    await launchOnPane(pkg, pane, buildPaneDisplayConfig(pane));
  }, [launchOnPane]);

  const handleLaunchFullscreen = useCallback(async (pkg: string) => {
    await launchFullscreen(pkg, buildFullscreenDisplayConfig());
  }, [launchFullscreen]);

  const handleDesktopClick = useCallback(() => {
    void fullscreenToDesktop();
    // 点击桌面时关闭活动进程面板（§12.4）；AppPicker 由 context 独立管理
    setShowActivityManager(false);
  }, [fullscreenToDesktop]);

  const handleActivityManagerClick = useCallback(() => {
    setShowActivityManager((v) => !v);
  }, []);

  const activityCount = apps.length;

  return (
    <div ref={fullscreenRef} className="flex w-full h-dvh bg-slate-900">
      <DesktopShell
        sidebar={
          <ControlSidebar
            handleStop={onStop}
            isFullscreen={isFullscreen}
            toggleFullscreen={toggleFullscreen}
            audioStatus={audioStatus}
            isMuted={isMuted}
            setMuted={setMuted}
            onDesktopClick={handleDesktopClick}
            onActivityManagerClick={handleActivityManagerClick}
            onLaunchFullscreen={(pkg) => { void handleLaunchFullscreen(pkg); }}
            onOpenAppPicker={() => openAppPicker({ mode: 'fullscreen', onLaunch: (pkg) => { void handleLaunchFullscreen(pkg); } })}
            activityCount={activityCount}
          />
        }
        onOpenAppPicker={(pane) => openAppPicker({ mode: 'pane', targetPane: pane, onLaunch: (pkg) => { void handleLaunchOnPane(pkg, pane); } })}
        onSwitchPaneApp={(pane) => openAppPicker({ mode: 'pane', targetPane: pane, onLaunch: (pkg) => { void handleLaunchOnPane(pkg, pane); } })}
        displayConfig={buildFullscreenDisplayConfig()}
      />

      {/* 活动进程管理浮窗 */}
      {showActivityManager && (
        <ActivityManagerPanel
          onClose={() => setShowActivityManager(false)}
          getDisplayConfig={buildPaneDisplayConfig}
        />
      )}
    </div>
  );
}

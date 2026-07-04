/**
 * DesktopShell —— 分屏桌面壳组件。
 *
 * 设计文档 §2.4 / §12 布局：
 * 替代当前 VirtualScreen 主区域，承载：
 * - ControlSidebar（常驻，固定宽度 w-13 ≈ 52px）
 * - DesktopArea（侧边栏右侧剩余区域，flex-1）
 *   - SplitPane × 2（左右分屏，平分 DesktopArea 宽度）
 *   - FullscreenOverlay（覆盖 DesktopArea，不遮侧边栏，Task 6）
 *   - ActivityManagerPanel（浮窗，z-index 最高，Task 7）
 *
 * 侧边栏常驻原则（§2.5）：任何状态下都常驻且占据固定宽度。
 * 全屏覆盖层只覆盖 DesktopArea，不遮住侧边栏。
 *
 * 布局层级（§12.4）：
 * | 层级 | 组件 |
 * |---|---|
 * | 最底 | ControlSidebar + DesktopArea（SplitPane × 2） |
 * | 中 | FullscreenOverlay（覆盖 DesktopArea） |
 * | 高 | ActivityManagerPanel / 全部应用浮窗（fixed，可覆盖整个区域） |
 *
 * 解耦设计：
 * sidebar 通过 children 注入（Task 8 改造 ControlSidebar 后由 App.tsx 注入）。
 * SessionManager 通过 useSessionManager store 直接读取，无需 prop drilling。
 */

import { type ReactNode, useCallback } from 'react';
import { SplitPane } from './SplitPane';
import { useSessionManager } from '@/lib/session-manager';
import type { DisplayConfig } from '@/lib/scrcpy-session';

interface DesktopShellProps {
  /** 侧边栏内容（ControlSidebar，Task 8 改造后注入） */
  sidebar?: ReactNode;
  /** 全屏覆盖层（Task 6 实现后注入） */
  fullscreenOverlay?: ReactNode;
  /** 活动管理面板（Task 7 实现后注入） */
  activityManagerPanel?: ReactNode;
  /** 全部应用浮窗（Task 9 实现后注入） */
  appPickerOverlay?: ReactNode;
  /** pane 下拉菜单工厂函数（Task 5 实现后注入） */
  paneDropdownFactory?: (pane: 'left' | 'right') => ReactNode;
  /** 打开应用选择器回调（pane 模式） */
  onOpenAppPicker?: (pane: 'left' | 'right') => void;
  /** 显示配置（由 App.tsx 传入，用于 launchOnPane） */
  displayConfig: DisplayConfig;
}

export function DesktopShell({
  sidebar,
  fullscreenOverlay,
  activityManagerPanel,
  appPickerOverlay,
  paneDropdownFactory,
  onOpenAppPicker,
  displayConfig,
}: DesktopShellProps) {
  const paneLeft = useSessionManager((s) => s.paneLeft);
  const paneRight = useSessionManager((s) => s.paneRight);
  const getSession = useSessionManager((s) => s.getSession);
  const getPaneApp = useSessionManager((s) => s.getPaneApp);

  const leftApp = getPaneApp('left');
  const rightApp = getPaneApp('right');
  const leftSession = paneLeft ? getSession(paneLeft) : null;
  const rightSession = paneRight ? getSession(paneRight) : null;

  const handleOpenPicker = useCallback((pane: 'left' | 'right') => {
    onOpenAppPicker?.(pane);
  }, [onOpenAppPicker]);

  return (
    <div className="w-full h-screen flex bg-slate-200 overflow-hidden">
      {/* 侧边栏：常驻，固定宽度 w-13 */}
      {sidebar && (
        <div className="flex-shrink-0">
          {sidebar}
        </div>
      )}

      {/* DesktopArea：侧边栏右侧剩余区域 */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* 分屏桌面布局：左 pane | 间隔 | 右 pane */}
        <div className="flex-1 flex gap-1 p-1">
          <SplitPane
            pane="left"
            app={leftApp}
            session={leftSession}
            onOpenAppPicker={() => handleOpenPicker('left')}
            dropdown={paneDropdownFactory?.('left')}
          />
          <SplitPane
            pane="right"
            app={rightApp}
            session={rightSession}
            onOpenAppPicker={() => handleOpenPicker('right')}
            dropdown={paneDropdownFactory?.('right')}
          />
        </div>

        {/* 全屏覆盖层：覆盖 DesktopArea，不遮侧边栏（Task 6） */}
        {fullscreenOverlay && (
          <div className="absolute inset-0 z-10">
            {fullscreenOverlay}
          </div>
        )}

        {/* 活动管理浮窗 / 全部应用浮窗：fixed 定位，可覆盖整个区域（Task 7/9） */}
        {activityManagerPanel}
        {appPickerOverlay}
      </div>
    </div>
  );
}

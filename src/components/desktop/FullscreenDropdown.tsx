/**
 * FullscreenDropdown —— 全屏应用顶部可折叠悬浮控件。
 *
 * 三组件布局（第五轮反馈 2026-08-04）：
 *   左半区(flex-1, 内容右对齐贴②) | ②上下拉(居中) | 右半区(flex-1, 内容左对齐贴②)
 *   → ② 严格钉在屏幕中心，①应用名 / ③按钮组紧贴②两侧（不贴边缘），间距 gap-3 一致。
 * 折叠态 = 仅②（同一结构，仍居中，无遮挡）。
 * - 「分屏」弹 PaneSelector 子菜单（屏幕正下方居中）；「关闭」= force-stop + 销毁 session + 销毁虚拟屏。
 *
 * 层级：z-30 位于 FullscreenOverlay(z-10) 内部；分屏子树已被 SplitPane 的 z-0
 * stacking context 钉在覆盖层之下，全屏时不会泄漏显示。
 */

import { useState, useRef, useEffect } from 'react';
import { SplitSquareHorizontal, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { AppInstance, PaneSlot } from '@/lib/session-manager';
import { PaneSelector } from './PaneSelector';
import { useAppDisplayName } from '@/lib/useAppDisplayName';
import { TopBarHandle } from './TopBarHandle';
import { TopBarActionButton } from './TopBarActionButton';

interface FullscreenDropdownProps {
  app: AppInstance;
  /** 左 pane 的 app（传给 PaneSelector） */
  leftApp: AppInstance | null;
  /** 右 pane 的 app（传给 PaneSelector） */
  rightApp: AppInstance | null;
  onSplitToPane: (pane: PaneSlot) => void;
  onClose: () => void;
}

export function FullscreenDropdown({
  app,
  leftApp,
  rightApp,
  onSplitToPane,
  onClose,
}: FullscreenDropdownProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [showSplitMenu, setShowSplitMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSplitMenu) return;
    // C-1：触屏上 mousedown 是 touchend 后的合成事件且滑动取消时不派发，
    // 改用 pointerdown 才能可靠关闭子菜单。
    const handleClickOutside = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowSplitMenu(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [showSplitMenu]);

  const displayName = useAppDisplayName(app.packageName);
  const toggle = () => setCollapsed((v) => !v);

  return (
    <div
      ref={menuRef}
      className="absolute top-2 inset-x-0 z-30 pointer-events-none animate-fade-in"
    >
      {/*
        左半区(flex-1) | ②(shrink-0) | 右半区(flex-1)：
        左右半区等宽 → ② 严格居中 = 屏幕中心；①③ 内容分别右/左对齐 → 紧贴②。
        折叠态仅② → 仍居中。
      */}
      {/* justify-center：折叠态仅②时居中；展开态左右半区 flex-1 撑满，②仍居中 */}
      <div className="flex items-center justify-center gap-3">
        {/* ① 左半区：应用名，内容右对齐贴②（仅展开态）；与上下拉同款：无底色 + 阴影保可见 */}
        {!collapsed && (
          <div className="flex-1 min-w-0 flex justify-end pointer-events-none animate-fade-in">
            <span
              className="min-w-0 max-w-[min(32vw,240px)] truncate text-white/90 text-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
              title={displayName}
            >
              {displayName}
            </span>
          </div>
        )}

        {/* ② 上下拉按钮（恒在、严格居中；折叠 ChevronDown / 展开 ChevronUp） */}
        <div className="shrink-0 pointer-events-auto">
          <TopBarHandle
            icon={collapsed ? ChevronDown : ChevronUp}
            label={collapsed ? '展开控件栏' : '收起控件栏'}
            expanded={!collapsed}
            onClick={toggle}
          />
        </div>

        {/* ③ 右半区：分屏 + 关闭（危险红色系），内容左对齐贴②（仅展开态） */}
        {!collapsed && (
          <div className="flex-1 flex justify-start items-center gap-2 pointer-events-auto animate-fade-in">
            <TopBarActionButton
              icon={SplitSquareHorizontal}
              label="分屏"
              onClick={() => setShowSplitMenu((v) => !v)}
            />
            <TopBarActionButton
              icon={X}
              label="关闭应用"
              danger
              onClick={() => {
                setCollapsed(true);
                onClose();
              }}
            />
          </div>
        )}
      </div>

      {/* 分屏子菜单：从 ② 正下方居中展开（外层 pointer-events-none，必须显式 auto） */}
      {!collapsed && showSplitMenu && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-white rounded-lg shadow-lg border border-slate-200 pointer-events-auto">
          <PaneSelector
            sourcePane={app.sourcePane}
            leftApp={leftApp}
            rightApp={rightApp}
            onSelect={(pane) => {
              setShowSplitMenu(false);
              onSplitToPane(pane);
            }}
            onCancel={() => setShowSplitMenu(false)}
          />
        </div>
      )}
    </div>
  );
}

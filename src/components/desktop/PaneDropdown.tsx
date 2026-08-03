/**
 * PaneDropdown —— 分屏应用顶部可折叠悬浮控件。
 *
 * 三组件布局（第五轮反馈 2026-08-04，与 FullscreenDropdown 一致）：
 *   左半区(flex-1, 应用名+切换右对齐贴②) | ②上下拉(居中) | 右半区(flex-1, 全屏+关闭左对齐贴②)
 *   → ② 严格钉在屏幕中心，①③ 紧贴②两侧（不贴边缘），间距 gap-3 一致。
 * 折叠态 = 仅②（同一结构，仍居中，无遮挡）。
 * - 行为统一（C-2）：任何改变布局/会话状态的动作前先收起。
 */

import { useState, useRef } from 'react';
import { Maximize2, X, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import type { AppInstance, PaneSlot } from '@/lib/session-manager';
import { useAppDisplayName } from '@/lib/useAppDisplayName';
import { TopBarHandle } from './TopBarHandle';
import { TopBarActionButton } from './TopBarActionButton';

interface PaneDropdownProps {
  pane: PaneSlot;
  app: AppInstance;
  onSwitch: () => void;
  onFullscreen: () => void;
  onClose: () => void;
}

export function PaneDropdown({
  app,
  onSwitch,
  onFullscreen,
  onClose,
}: PaneDropdownProps) {
  const [collapsed, setCollapsed] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
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
        {/* ① 左半区：应用名 + 切换，内容右对齐贴②（仅展开态）；与上下拉同款：无底色 + 阴影保可见 */}
        {!collapsed && (
          <div className="flex-1 min-w-0 flex justify-end items-center gap-2 pointer-events-auto animate-fade-in">
            <span
              className="min-w-0 max-w-[min(24vw,180px)] truncate text-white/90 text-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
              title={displayName}
            >
              {displayName}
            </span>
            <TopBarActionButton
              icon={RefreshCw}
              label="切换应用"
              onClick={() => {
                setCollapsed(true);
                onSwitch();
              }}
            />
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

        {/* ③ 右半区：全屏 + 关闭（危险红色系），内容左对齐贴②（仅展开态） */}
        {!collapsed && (
          <div className="flex-1 flex justify-start items-center gap-2 pointer-events-auto animate-fade-in">
            <TopBarActionButton
              icon={Maximize2}
              label="全屏"
              onClick={() => {
                setCollapsed(true);
                onFullscreen();
              }}
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
    </div>
  );
}

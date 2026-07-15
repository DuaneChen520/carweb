/**
 * PaneDropdown —— 分屏应用顶部可折叠悬浮控件。
 *
 * 折叠态：仅居中显示 ChevronDown 箭头，点击展开完整顶部栏。
 * 展开态三段式布局：左（应用名 + 切换）| 中（ChevronUp 收起，绝对居中）| 右（全屏 + 关闭）
 */

import { useState, useRef } from 'react';
import { Maximize2, X, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import type { AppInstance, PaneSlot } from '@/lib/session-manager';
import { useAppDisplayName } from '@/lib/useAppDisplayName';

interface PaneDropdownProps {
  pane: PaneSlot;
  app: AppInstance;
  onSwitch: () => void;
  onFullscreen: () => void;
  onClose: () => void;
}

export function PaneDropdown({ pane, app, onSwitch, onFullscreen, onClose }: PaneDropdownProps) {
  const [collapsed, setCollapsed] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const displayName = useAppDisplayName(app.packageName);

  const toggle = () => setCollapsed((v) => !v);

  if (collapsed) {
    return (
      <div
        ref={menuRef}
        className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
      >
        <button
          onClick={toggle}
          className="pointer-events-auto p-1.5 rounded-full bg-slate-900/30 text-slate-400 hover:text-white hover:bg-white/10 backdrop-blur-sm transition-colors animate-fade-in"
          title="展开控件栏"
          aria-label="展开控件栏"
        >
          <ChevronDown size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="absolute top-2 left-2 right-2 z-20 pointer-events-none animate-fade-in"
    >
      <div className="relative bg-slate-800/60 backdrop-blur-md rounded-lg px-3 py-1.5 pointer-events-auto shadow-lg shadow-black/20">
        {/* ChevronUp — 绝对居中，不受左右内容影响 */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <button
            onClick={toggle}
            className="pointer-events-auto p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="收起"
          >
            <ChevronUp size={14} />
          </button>
        </div>

        {/* 左：应用名 + 切换 */}
        <div className="flex items-center gap-1 min-w-0">
          <div
            className="text-white/90 text-xs max-w-[120px] truncate"
            title={app.packageName}
          >
            {displayName}
          </div>
          <button
            onClick={() => {
              setCollapsed(true);
              onSwitch();
            }}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="切换应用"
          >
            <RefreshCw size={12} />
          </button>
        </div>

        {/* 右：全屏 + 关闭 */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <button
            onClick={() => {
              setCollapsed(true);
              onFullscreen();
            }}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="全屏"
          >
            <Maximize2 size={12} />
          </button>
          <button
            onClick={() => {
              setCollapsed(true);
              onClose();
            }}
            className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="关闭"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
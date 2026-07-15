/**
 * FullscreenDropdown —— 全屏应用顶部可折叠悬浮控件。
 *
 * 折叠态：仅居中显示 ChevronDown 箭头，点击展开完整顶部栏。
 * 展开态三段式布局：左（应用名）| 中（ChevronUp 收起，绝对居中）| 右（分屏 + 关闭）
 *
 * - 「分屏」点击后弹 PaneSelector 子菜单
 * - 「关闭」= force-stop + 销毁 session + 销毁虚拟屏
 */

import { useState, useRef, useEffect } from 'react';
import { SplitSquareHorizontal, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { AppInstance, PaneSlot } from '@/lib/session-manager';
import { PaneSelector } from './PaneSelector';
import { useAppDisplayName } from '@/lib/useAppDisplayName';

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
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowSplitMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSplitMenu]);

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

        {/* 左：应用名 */}
        <div
          className="text-white/90 text-xs max-w-[160px] truncate"
          title={app.packageName}
        >
          {displayName}
        </div>

        {/* 右：分屏 + 关闭 */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 relative">
          <button
            onClick={() => setShowSplitMenu((v) => !v)}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="分屏"
          >
            <SplitSquareHorizontal size={12} />
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

          {/* 分屏子菜单 */}
          {showSplitMenu && (
            <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-slate-200">
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
      </div>
    </div>
  );
}
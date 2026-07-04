/**
 * FullscreenDropdown —— 全屏应用顶部下拉悬浮控件。
 *
 * 设计文档 §4.2：
 * | 左侧 | 右侧 |
 * |---|---|
 * | 应用名 | 分屏（选左右 + 覆盖确认）+ 关闭 |
 *
 * - 「分屏」点击后弹 PaneSelector 子菜单
 * - 「关闭」= force-stop + 销毁 session + 销毁虚拟屏
 */

import { useState, useRef, useEffect } from 'react';
import { SplitSquareHorizontal, X } from 'lucide-react';
import type { AppInstance, PaneSlot } from '@/lib/session-manager';
import { PaneSelector } from './PaneSelector';

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

  const displayName = app.appLabel || app.packageName.split('.').pop() || app.packageName;

  return (
    <div
      ref={menuRef}
      className="absolute top-2 left-2 right-2 z-20 flex items-start justify-between pointer-events-none"
    >
      {/* 左侧：应用名 */}
      <div className="pointer-events-auto">
        <div
          className="px-2 py-1 rounded bg-black/50 text-white text-xs backdrop-blur-sm max-w-[160px] truncate"
          title={app.packageName}
        >
          {displayName}
        </div>
      </div>

      {/* 右侧：分屏 + 关闭 */}
      <div className="flex items-center gap-1 pointer-events-auto relative">
        <button
          onClick={() => setShowSplitMenu((v) => !v)}
          className="p-1.5 rounded bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-colors"
          title="分屏"
        >
          <SplitSquareHorizontal size={12} />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded bg-black/50 text-white hover:bg-red-600/80 backdrop-blur-sm transition-colors"
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
  );
}

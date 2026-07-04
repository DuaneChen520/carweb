/**
 * PaneDropdown —— 分屏应用顶部下拉悬浮控件。
 *
 * 设计文档 §4.1：
 * | 左侧 | 右侧 |
 * |---|---|
 * | 应用名 + 切换 | 全屏 + 关闭 |
 *
 * - 下拉图标透明悬浮于组件上，不占据画面尺寸
 * - 「切换」= 关闭旧 + 打开新（旧 app 走 closed 路径）→ 弹应用选择器
 * - 「全屏」= 进入全屏覆盖层
 * - 「关闭」= force-stop + 销毁 session + 销毁虚拟屏，pane 回空态
 */

import { useState, useRef, useEffect } from 'react';
import { Maximize2, X, RefreshCw } from 'lucide-react';
import type { AppInstance, PaneSlot } from '@/lib/session-manager';

interface PaneDropdownProps {
  pane: PaneSlot;
  app: AppInstance;
  onSwitch: () => void;
  onFullscreen: () => void;
  onClose: () => void;
}

export function PaneDropdown({ pane, app, onSwitch, onFullscreen, onClose }: PaneDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const displayName = app.appLabel || app.packageName.split('.').pop() || app.packageName;

  return (
    <div
      ref={menuRef}
      className="absolute top-2 left-2 right-2 z-20 flex items-start justify-between pointer-events-none"
    >
      {/* 左侧：应用名 + 切换 */}
      <div className="flex items-center gap-1 pointer-events-auto">
        <div
          className="px-2 py-1 rounded bg-black/50 text-white text-xs backdrop-blur-sm max-w-[120px] truncate"
          title={app.packageName}
        >
          {displayName}
        </div>
        <button
          onClick={() => {
            setIsOpen(false);
            onSwitch();
          }}
          className="p-1.5 rounded bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-colors"
          title="切换应用"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* 右侧：全屏 + 关闭 */}
      <div className="flex items-center gap-1 pointer-events-auto">
        <button
          onClick={() => {
            setIsOpen(false);
            onFullscreen();
          }}
          className="p-1.5 rounded bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-colors"
          title="全屏"
        >
          <Maximize2 size={12} />
        </button>
        <button
          onClick={() => {
            setIsOpen(false);
            onClose();
          }}
          className="p-1.5 rounded bg-black/50 text-white hover:bg-red-600/80 backdrop-blur-sm transition-colors"
          title="关闭"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

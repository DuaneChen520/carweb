/**
 * AppPicker —— 统一「全部应用」浮窗（ADR-0010）。
 *
 * 取代旧的：
 *  - ① ControlSidebar 内部面板（panelMode='apps'/'search'，单屏模式）
 *  - ② AppPickerOverlay（pane/fullscreen 双模式，桌面模式）
 *
 * 统一后支持三模式启动落点 + search + 置顶(pin)模式 + 计数角标：
 *  - single：镜像/单虚拟屏 → startApp
 *  - pane：桌面左/右半屏 → onLaunchOnPane
 *  - fullscreen：桌面全屏受管会话 → onLaunchFullscreen
 *
 * 浮窗经 AppPickerContext 在 App 层单实例渲染（见 AppPickerContext.tsx）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, RefreshCw, Search, Pin } from 'lucide-react';
import { AppGrid, type AppGridHandle } from '@/components/AppGrid';
import { useScrcpyActions } from '@/contexts/ScrcpyContext';
import { useAdbStore } from '@/hooks/useAdbStore';
import type { AppPickerConfig } from '@/contexts/AppPickerContext';

interface AppPickerProps {
  config: AppPickerConfig;
  onClose: () => void;
}

export function AppPicker({ config, onClose }: AppPickerProps) {
  const { togglePin, getAllDeviceApps } = useScrcpyActions();
  const appListVersion = useAdbStore((s) => s.appListVersion);
  const gridRef = useRef<AppGridHandle>(null);
  const [pinMode, setPinMode] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);

  const { mode, targetPane, onLaunch, title: titleOverride } = config;

  // 标题：优先 config.title，否则按模式生成（ADR-0010 D1）
  const title = titleOverride
    ?? (mode === 'pane' && targetPane
      ? `选择应用 · ${targetPane === 'left' ? '左' : '右'}分屏`
      : '全部应用');

  // 已装应用总数角标（随 appListVersion 刷新，ADR-0010 D2）
  useEffect(() => {
    let cancelled = false;
    getAllDeviceApps().then((list) => {
      if (!cancelled) setCount(list.length);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [getAllDeviceApps, appListVersion]);

  const handleLaunch = useCallback((pkg: string) => {
    onLaunch(pkg);
    onClose();
  }, [onLaunch, onClose]);

  // pin 模式：点击应用 = 切换置顶，而非启动（ADR-0010 D2）
  const handleTogglePin = useCallback(async (pkg: string) => {
    try {
      await togglePin(pkg);
      await gridRef.current?.refresh();
    } catch (e) {
      console.warn('[AppPicker] 切换置顶失败:', e);
    }
  }, [togglePin]);

  // 手动刷新：全量重解析设备端应用元数据（清空数据/缓存失效后的恢复路径，见 ADR-0009 D1）
  const handleRefresh = useCallback(() => {
    if (loading) return;
    setLoading(true);
    console.log('[AppPicker] 用户点击「更新应用列表」');
    (gridRef.current?.refresh({ force: true }) ?? Promise.resolve())
      .then(() => gridRef.current?.goToFirstPage())
      .catch((e) => console.warn('[AppPicker] 刷新失败:', e))
      .finally(() => setLoading(false));
  }, [loading]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-slate-800/95 backdrop-blur-xl rounded-2xl shadow-2xl w-[680px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h2 className="text-sm font-medium text-slate-100">
            {title}
            {count > 0 && <span className="ml-1.5 text-slate-400">({count})</span>}
          </h2>
          <div className="flex items-center gap-1">
            {/* 搜索框 */}
            <div className="relative mr-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜索应用..."
                className="w-40 pl-8 pr-2 py-1 text-xs bg-slate-700 rounded-lg border border-slate-600 text-slate-100 placeholder-slate-400 outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-400/30 transition-colors"
              />
            </div>
            {/* 置顶模式 */}
            <button
              onClick={() => setPinMode((v) => !v)}
              className={`p-1 rounded-lg transition-colors ${pinMode ? 'text-accent-400 bg-accent-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/10'}`}
              title={pinMode ? '退出置顶模式' : '置顶模式'}
            >
              <Pin className="w-4 h-4" />
            </button>
            {/* 刷新 */}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className={`p-1 rounded-lg transition-colors ${loading ? 'text-slate-500' : 'text-slate-400 hover:text-slate-200 hover:bg-white/10'}`}
              title="更新应用列表"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            {/* 关闭 */}
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors text-slate-400"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 应用列表 */}
        <div className="flex-1 overflow-hidden">
          <AppGrid
            ref={gridRef}
            onLaunchApp={handleLaunch}
            searchText={searchText}
            pinMode={pinMode}
            onTogglePin={handleTogglePin}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * ActivityManagerPanel —— 活动进程管理浮窗。
 *
 * 设计文档 §7：
 * - 侧边栏底部新增「活动进程」按钮触发
 * - 列表内容：所有非 closed 状态的 app，按状态排序
 *   1. foreground-fullscreen —— 标注"全屏中"，info 蓝边框
 *   2. foreground-pane —— 标注"小窗中 · 左/右分屏"，info 蓝边框
 *   3. background —— 标注"后台"，普通样式
 * - 每条进程的操作：进入 / 关闭
 * - 全部关闭按钮
 *
 * background → 前台恢复落点规则（§7.4）：
 * 1. 当前有全屏覆盖层 → 该全屏 app 进 background，覆盖层承接新 app
 * 2. 否则有空 pane → 放进空 pane
 * 3. 否则两 pane 都占 → 覆盖左 pane
 *
 * 浮窗层级（§12.4）：fixed 定位，可覆盖整个区域（含侧边栏），
 * 但侧边栏按钮仍可点击触发。点击侧边栏其他按钮会关闭当前浮窗。
 */

import { useMemo } from 'react';
import { X, LogIn, Trash2, Monitor, SplitSquareHorizontal, Moon } from 'lucide-react';
import { useSessionManager, type AppInstance, type PaneSlot } from '@/lib/session-manager';
import type { DisplayConfig } from '@/lib/scrcpy-session';

interface ActivityManagerPanelProps {
  /** 关闭浮窗回调 */
  onClose: () => void;
  /** 显示配置构建函数（按 app 落点 pane 从真实容器尺寸推导，用于 resumeBackground） */
  getDisplayConfig: (pane: PaneSlot) => DisplayConfig;
}

// 状态排序权重（§7.2）
const STATE_ORDER: Record<string, number> = {
  'foreground-fullscreen': 0,
  'foreground-pane': 1,
  'background': 2,
};

function getStateLabel(app: AppInstance): { text: string; color: string; icon: React.ReactNode } {
  switch (app.state) {
    case 'foreground-fullscreen':
      return {
        text: '全屏中',
        color: 'text-accent-600 border-accent-300 bg-accent-50',
        icon: <Monitor size={10} />,
      };
    case 'foreground-pane':
      return {
        text: `小窗中 · ${app.pane === 'left' ? '左' : '右'}分屏`,
        color: 'text-accent-600 border-accent-300 bg-accent-50',
        icon: <SplitSquareHorizontal size={10} />,
      };
    case 'background':
      return {
        text: '后台',
        color: 'text-slate-500 border-slate-200 bg-slate-50',
        icon: <Moon size={10} />,
      };
    default:
      return { text: '', color: '', icon: null };
  }
}

export function ActivityManagerPanel({ onClose, getDisplayConfig }: ActivityManagerPanelProps) {
  const apps = useSessionManager((s) => s.apps);
  const resumeBackground = useSessionManager((s) => s.resumeBackground);
  const closeApp = useSessionManager((s) => s.closeApp);
  const closeAll = useSessionManager((s) => s.closeAll);

  // 按状态排序（§7.2）
  const sortedApps = useMemo(() => {
    return [...apps].sort((a, b) => {
      const orderA = STATE_ORDER[a.state] ?? 99;
      const orderB = STATE_ORDER[b.state] ?? 99;
      return orderA - orderB;
    });
  }, [apps]);

  const handleEnter = (app: AppInstance) => {
    if (app.state === 'background') {
      void resumeBackground(app.sessionId, getDisplayConfig(app.pane ?? 'left'));
    }
    // foreground-fullscreen / foreground-pane 已在前台，进入操作仅关闭浮窗
    onClose();
  };

  const handleClose = (app: AppInstance) => {
    void closeApp(app.sessionId);
  };

  const handleCloseAll = async () => {
    await closeAll();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[400px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-medium text-slate-800">活动进程</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* 进程列表 */}
        <div className="flex-1 overflow-y-auto p-2">
          {sortedApps.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              暂无活动进程
            </div>
          ) : (
            sortedApps.map((app) => {
              const stateInfo = getStateLabel(app);
              const displayName = app.appLabel || app.packageName.split('.').pop() || app.packageName;

              return (
                <div
                  key={app.sessionId}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 border ${stateInfo.color}`}
                >
                  {/* 应用图标占位 */}
                  <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center text-slate-500 text-xs font-medium flex-shrink-0">
                    {displayName.charAt(0).toUpperCase()}
                  </div>

                  {/* 应用信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">
                      {displayName}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      {stateInfo.icon}
                      {stateInfo.text}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleEnter(app)}
                      className="p-1.5 rounded-lg hover:bg-white/60 transition-colors text-slate-600"
                      title="进入"
                    >
                      <LogIn size={14} />
                    </button>
                    <button
                      onClick={() => handleClose(app)}
                      className="p-1.5 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors text-slate-600"
                      title="关闭"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部：全部关闭 */}
        {sortedApps.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100">
            <button
              onClick={handleCloseAll}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors text-sm font-medium"
            >
              <Trash2 size={14} />
              全部关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

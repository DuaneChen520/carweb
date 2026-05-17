import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, ArrowLeft, Home, Grid, Loader2 } from 'lucide-react';

const PINNED_APPS: { name: string; package: string }[] = [
  { name: '设置', package: 'com.android.settings' },
  { name: 'Chrome', package: 'com.android.chrome' },
  { name: '文件管理', package: 'com.android.documentsui' },
  { name: '计算器', package: 'com.android.calculator2' },
  { name: 'Play 商店', package: 'com.android.vending' },
  { name: '通讯录', package: 'com.android.contacts' },
  { name: '浏览器', package: 'com.android.browser' },
];

interface ControlSidebarProps {
  goBack: () => Promise<void>;
  goHome: () => Promise<void>;
  showRecentApps: () => Promise<void>;
  startApp: (appName: string) => Promise<void>;
  getAppList: () => Promise<string[]>;
}

function formatAppName(pkg: string): string {
  const segments = pkg.split('.');
  const last = segments[segments.length - 1];
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

export function ControlSidebar({ goBack, goHome, showRecentApps, startApp, getAppList }: ControlSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [apps, setApps] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const query = searchText.toLowerCase().trim();

  useEffect(() => {
    if (!collapsed) {
      searchRef.current?.focus();
    }
  }, [collapsed]);

  const filteredPinned = PINNED_APPS.filter(
    (a) => !query || a.name.includes(query) || a.package.includes(query),
  );

  const filteredAll = apps
    ? apps.filter(
        (p) =>
          !query ||
          p.includes(query) ||
          formatAppName(p).toLowerCase().includes(query),
      )
    : [];

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((c) => !c);
    setShowAll(false);
  }, []);

  const handleLoadApps = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getAppList();
      setApps(list);
      setShowAll(true);
    } finally {
      setLoading(false);
    }
  }, [getAppList]);

  const handleLaunchApp = useCallback(
    (pkg: string) => {
      startApp(pkg);
      setSearchText('');
    },
    [startApp],
  );

  return (
    <>
      {/* 折叠开关 */}
      <button
        onClick={handleToggleCollapse}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-6 h-12 flex items-center justify-center bg-black/40 hover:bg-black/60 rounded-r-lg transition-colors text-white/60 hover:text-white"
        title={collapsed ? '展开控制面板' : '收起控制面板'}
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronLeft className="w-4 h-4" />
        )}
      </button>

      {!collapsed && (
        <div className="absolute left-0 top-0 bottom-0 z-20 w-64 bg-black/80 backdrop-blur-md flex flex-col border-r border-white/10">
          {/* 标题 */}
          <div className="px-4 pt-4 pb-2">
            <div className="text-white/80 text-sm font-medium mb-2">控制面板</div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
              <input
                ref={searchRef}
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜索应用..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/10 rounded-lg border border-white/10 text-white placeholder-white/30 outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
          </div>

          {/* 应用列表 */}
          <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
            {showAll && apps ? (
              filteredAll.length > 0 ? (
                filteredAll.map((pkg) => (
                  <button
                    key={pkg}
                    onClick={() => handleLaunchApp(pkg)}
                    className="w-full text-left px-3 py-1.5 text-xs text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors truncate"
                    title={pkg}
                  >
                    {formatAppName(pkg)}
                    <span className="ml-2 text-white/30 text-[10px]">{pkg}</span>
                  </button>
                ))
              ) : (
                <div className="text-white/40 text-xs text-center py-4">
                  无匹配应用
                </div>
              )
            ) : (
              <>
                {filteredPinned.length > 0 && (
                  <div className="text-white/40 text-[10px] uppercase tracking-wider px-3 pt-3 pb-1">
                    常用
                  </div>
                )}
                {filteredPinned.map((app) => (
                  <button
                    key={app.package}
                    onClick={() => handleLaunchApp(app.package)}
                    className="w-full text-left px-3 py-1.5 text-xs text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors truncate"
                  >
                    {app.name}
                    <span className="ml-2 text-white/30 text-[10px]">{app.package}</span>
                  </button>
                ))}
                <div className="px-3 pt-2">
                  <button
                    onClick={handleLoadApps}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg transition-colors"
                  >
                    {loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Grid className="w-3.5 h-3.5" />
                    )}
                    {loading ? '加载中...' : '全部应用'}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* 导航按钮 */}
          <div className="px-2 pb-4 pt-2 border-t border-white/10">
            <div className="flex items-center justify-around">
              <button
                onClick={goBack}
                className="flex flex-col items-center gap-1 px-4 py-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="返回"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-[10px]">返回</span>
              </button>
              <button
                onClick={goHome}
                className="flex flex-col items-center gap-1 px-4 py-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="桌面"
              >
                <Home className="w-5 h-5" />
                <span className="text-[10px]">桌面</span>
              </button>
              <button
                onClick={showRecentApps}
                className="flex flex-col items-center gap-1 px-4 py-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="最近任务"
              >
                <Grid className="w-5 h-5" />
                <span className="text-[10px]">最近</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
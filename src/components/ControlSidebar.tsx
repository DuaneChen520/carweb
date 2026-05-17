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

interface AppIconProps {
  pkg: string;
  name: string;
  getAppIcon: (pkg: string) => Promise<string | null>;
  onLaunch: (pkg: string) => void;
}

function AppIcon({ pkg, name, getAppIcon, onLaunch }: AppIconProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppIcon(pkg).then((url) => {
      if (!cancelled) setIconUrl(url);
    });
    return () => { cancelled = true; };
  }, [pkg, getAppIcon]);

  return (
    <button
      onClick={() => onLaunch(pkg)}
      className="relative flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-white/10 transition-colors group"
      title={name}
    >
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={name}
          className="w-10 h-10 rounded-lg bg-white/5"
        />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
          <Loader2 className="w-4 h-4 text-white/30 animate-spin" />
        </div>
      )}
      <span className="text-[10px] text-white/50 truncate w-full text-center group-hover:text-white/80 transition-colors">
        {name}
      </span>
    </button>
  );
}

interface ControlSidebarProps {
  goBack: () => Promise<void>;
  goHome: () => Promise<void>;
  showRecentApps: () => Promise<void>;
  startApp: (appName: string) => Promise<void>;
  getAppList: (showSystem?: boolean) => Promise<string[]>;
  getAppIcon: (pkg: string) => Promise<string | null>;
}

function formatAppName(pkg: string): string {
  const segments = pkg.split('.');
  const last = segments[segments.length - 1];
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

export function ControlSidebar({ goBack, goHome, showRecentApps, startApp, getAppList, getAppIcon }: ControlSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [apps, setApps] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
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

  const handleLoadApps = useCallback(async (includeSystem = false) => {
    setLoading(true);
    setShowSystem(includeSystem);
    try {
      const list = await getAppList(includeSystem);
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
        <div className="absolute left-0 top-0 bottom-0 z-20 w-72 bg-black/80 backdrop-blur-md flex flex-col border-r border-white/10">
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
          <div className="flex-1 overflow-y-auto px-3 space-y-1">
            {showAll && apps ? (
              filteredAll.length > 0 ? (
                <>
                  <div className="flex items-center justify-between px-1 py-1">
                    <span className="text-white/40 text-[10px]">
                      {showSystem ? '所有应用' : '第三方应用'} ({filteredAll.length})
                    </span>
                    <button
                      onClick={() => handleLoadApps(!showSystem)}
                      disabled={loading}
                      className="text-[10px] text-white/30 hover:text-white/50 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      {showSystem ? '仅第三方' : '含系统'}
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-0.5 py-2">
                    {filteredAll.map((pkg) => (
                      <AppIcon
                        key={pkg}
                        pkg={pkg}
                        name={formatAppName(pkg)}
                        getAppIcon={getAppIcon}
                        onLaunch={handleLaunchApp}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-white/40 text-xs text-center py-4">
                  无匹配应用
                </div>
              )
            ) : (
              <>
                {filteredPinned.length > 0 && (
                  <div className="text-white/40 text-[10px] uppercase tracking-wider px-1 pt-3 pb-1">
                    常用
                  </div>
                )}
                <div className="grid grid-cols-4 gap-0.5">
                   {filteredPinned.map((app) => (
                     <AppIcon
                       key={app.package}
                       pkg={app.package}
                       name={app.name}
                       getAppIcon={getAppIcon}
                       onLaunch={handleLaunchApp}
                     />
                   ))}
                 </div>
                <div className="px-1 pt-2 space-y-1">
                  <button
                    onClick={() => handleLoadApps(false)}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg transition-colors"
                  >
                    {loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Grid className="w-3.5 h-3.5" />
                    )}
                    {loading ? '加载中...' : '全部应用'}
                  </button>
                  <button
                    onClick={() => handleLoadApps(true)}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1 text-[10px] text-white/30 hover:text-white/50 hover:bg-white/5 rounded-lg transition-colors"
                  >
                    {loading ? '' : '含系统应用'}
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
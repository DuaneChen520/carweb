import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Grid, ArrowLeft, Home, Loader2, X } from 'lucide-react';

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
  compact?: boolean;
}

function AppIcon({ pkg, name, getAppIcon, onLaunch, compact }: AppIconProps) {
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
      className="flex flex-col items-center gap-1 p-1.5 rounded-lg hover:bg-white/10 transition-colors group"
      title={name}
    >
      {iconUrl ? (
        <img src={iconUrl} alt={name} className="w-9 h-9 rounded-lg" />
      ) : (
        <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
          <Loader2 className="w-4 h-4 text-white/30 animate-spin" />
        </div>
      )}
      {!compact && (
        <span className="text-[10px] text-white/50 truncate w-full text-center group-hover:text-white/80 transition-colors">
          {name}
        </span>
      )}
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
  getAppLabel: (pkg: string) => Promise<string>;
}

export function ControlSidebar({ goBack, goHome, showRecentApps, startApp, getAppList, getAppIcon, getAppLabel }: ControlSidebarProps) {
  const [panelMode, setPanelMode] = useState<'closed' | 'search' | 'apps'>('closed');
  const [searchText, setSearchText] = useState('');
  const [apps, setApps] = useState<string[] | null>(null);
  const [appLabels, setAppLabels] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const query = searchText.toLowerCase().trim();

  useEffect(() => {
    if (panelMode !== 'closed') {
      searchRef.current?.focus();
    }
  }, [panelMode]);

  const filteredPinned = PINNED_APPS.filter(
    (a) => !query || a.name.includes(query) || a.package.includes(query),
  );

  const filteredAll = apps
    ? apps.filter((p) => {
        if (!query) return true;
        const label = appLabels.get(p) || '';
        return (
          p.toLowerCase().includes(query) ||
          label.toLowerCase().includes(query)
        );
      })
    : [];

  const loadApps = useCallback(async (includeSystem = false) => {
    setLoading(true);
    setShowSystem(includeSystem);
    try {
      const list = await getAppList(includeSystem);
      setApps(list);
      const labels = new Map<string, string>();
      await Promise.all(
        list.map(async (pkg) => {
          try {
            const label = await getAppLabel(pkg);
            labels.set(pkg, label);
          } catch {
            labels.set(pkg, pkg.split('.').pop() || pkg);
          }
        }),
      );
      setAppLabels(labels);
      setPanelMode('apps');
    } finally {
      setLoading(false);
    }
  }, [getAppList, getAppLabel]);

  const handleLaunchApp = useCallback(
    (pkg: string) => {
      startApp(pkg);
      setSearchText('');
      setPanelMode('closed');
    },
    [startApp],
  );

  const closePanel = useCallback(() => {
    setPanelMode('closed');
    setSearchText('');
  }, []);

  const togglePanel = useCallback((mode: 'search' | 'apps') => {
    if (panelMode === mode) {
      setPanelMode('closed');
    } else {
      setPanelMode(mode);
      setSearchText('');
      if (mode === 'apps' && !apps) {
        loadApps(false);
      }
    }
  }, [panelMode, apps, loadApps]);

  return (
    <>
      {/* 固定窄栏 */}
      <div className="w-13 flex flex-col items-center py-2 gap-1 bg-black/60 border-r border-white/10">
        {/* 搜索按钮 */}
        <button
          onClick={() => togglePanel('search')}
          className={`p-2 rounded-lg transition-colors ${panelMode === 'search' ? 'bg-blue-500/30 text-blue-400' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
          title="搜索应用"
        >
          <Search className="w-5 h-5" />
        </button>

        {/* 全部应用按钮 */}
        <button
          onClick={() => togglePanel('apps')}
          className={`p-2 rounded-lg transition-colors ${panelMode === 'apps' ? 'bg-blue-500/30 text-blue-400' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
          title="全部应用"
        >
          <Grid className="w-5 h-5" />
        </button>

        <div className="w-8 h-px bg-white/10 my-1" />

        {/* 常用应用（仅图标） */}
        {PINNED_APPS.map((app) => (
          <AppIcon
            key={app.package}
            pkg={app.package}
            name={app.name}
            getAppIcon={getAppIcon}
            onLaunch={handleLaunchApp}
            compact
          />
        ))}

        <div className="flex-1" />

        {/* 导航按钮 */}
        <button
          onClick={goBack}
          className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title="返回"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button
          onClick={goHome}
          className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title="桌面"
        >
          <Home className="w-5 h-5" />
        </button>
        <button
          onClick={showRecentApps}
          className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title="最近任务"
        >
          <Grid className="w-5 h-5" />
        </button>
      </div>

      {/* 悬浮弹窗 */}
      {panelMode !== 'closed' && (
        <div className="w-72 bg-black/90 backdrop-blur-md border-r border-white/10 flex flex-col z-30">
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <span className="text-white/80 text-sm font-medium">
              {panelMode === 'search' ? '搜索应用' : showSystem ? '所有应用' : '第三方应用'}
              {panelMode === 'apps' && apps && ` (${filteredAll.length})`}
            </span>
            <button
              onClick={closePanel}
              className="p-1 text-white/40 hover:text-white rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 搜索栏 */}
          <div className="px-3 pb-2">
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

          {/* 系统应用开关 */}
          {panelMode === 'apps' && (
            <div className="px-4 pb-2 flex items-center gap-2">
              <button
                onClick={() => loadApps(!showSystem)}
                disabled={loading}
                className="text-[10px] text-white/30 hover:text-white/50 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
              >
                {showSystem ? '仅第三方' : '含系统'}
              </button>
              {loading && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
            </div>
          )}

          {/* 应用列表 */}
          <div className="flex-1 overflow-y-auto px-2 space-y-1">
            {panelMode === 'search' ? (
              filteredPinned.length > 0 ? (
                <>
                  <div className="text-white/40 text-[10px] uppercase tracking-wider px-1 pt-1 pb-0.5">
                    常用
                  </div>
                  <div className="grid grid-cols-3 gap-0.5">
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
                </>
              ) : (
                <div className="text-white/40 text-xs text-center py-4">
                  无匹配应用
                </div>
              )
            ) : apps ? (
              filteredAll.length > 0 ? (
                <div className="grid grid-cols-3 gap-0.5 py-1">
                  {filteredAll.map((pkg) => (
                    <AppIcon
                      key={pkg}
                      pkg={pkg}
                      name={appLabels.get(pkg) || pkg.split('.').pop() || pkg}
                      getAppIcon={getAppIcon}
                      onLaunch={handleLaunchApp}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-white/40 text-xs text-center py-4">
                  无匹配应用
                </div>
              )
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
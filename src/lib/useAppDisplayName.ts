import { useEffect, useState } from 'react';
import { useScrcpyActions } from '@/contexts/ScrcpyContext';

/**
 * ADR-0012：应用显示名解析。
 *
 * 设计决策（grill-with-docs 收敛）：
 * - 渲染时按包名从设备应用缓存解析真实 label（pull 模型），单一数据源 = app-info-service 缓存。
 * - 缺失 label（如首次启动、设备未扫完）时兜底**完整包名**，不再用末段缩写
 *   （com.tencent.mm → mm 这种 `split('.').pop()` 缩写不可读，已废弃）。
 *
 * 不再依赖 AppInstance.appLabel（push 模型）：该字段在 launch 调用点从未被传入，
 * 且一旦写入不随缓存刷新，跨 resume/backgroundify/paneToFullscreen 易失配；
 * 而所有启动入口（选择器 / 侧栏 / 媒体 / NowPlaying）天然只有包名，
 * 故渲染时按包名查缓存是唯一覆盖全入口且无状态漂移的方案。
 */

/** 纯解析：label 优先，缺失兜底完整包名。便于单测。 */
export function resolveAppDisplayName(label: string | undefined, packageName: string): string {
  return label || packageName;
}

/**
 * 批量解析：包名数组 → pkg→显示名 Map。缺失 label 时兜底完整包名。
 * 单次渲染内多 app 共用一次缓存查询。
 */
export function useAppLabels(packages: string[]): Map<string, string> {
  const { getCachedAppLabels } = useScrcpyActions();
  const key = packages.join(',');

  const [labels, setLabels] = useState<Map<string, string>>(
    () => new Map(packages.map((p) => [p, resolveAppDisplayName(undefined, p)])),
  );

  useEffect(() => {
    let alive = true;
    if (packages.length === 0) {
      setLabels(new Map());
      return;
    }
    getCachedAppLabels(packages)
      .then((map) => {
        if (!alive) return;
        const next = new Map<string, string>();
        for (const p of packages) {
          next.set(p, resolveAppDisplayName(map.get(p), p));
        }
        setLabels(next);
      })
      .catch(() => {
        if (alive) {
          setLabels(new Map(packages.map((p) => [p, resolveAppDisplayName(undefined, p)])));
        }
      });
    return () => {
      alive = false;
    };
    // key 随包名集合变化重新解析；getCachedAppLabels 来自 context，通常稳定
  }, [key, getCachedAppLabels]);

  return labels;
}

/** 单个包名 → 显示名（渲染时按包名查缓存，兜底完整包名）。 */
export function useAppDisplayName(packageName: string | undefined): string {
  const labels = useAppLabels(packageName ? [packageName] : []);
  return packageName ? labels.get(packageName) || packageName : '';
}

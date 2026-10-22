import { useState } from 'react';
import { X, AlertTriangle, Smartphone, Trash2, SlidersHorizontal } from 'lucide-react';

export interface DeviceCacheInfo {
  deviceSerial: string;
  deviceName: string;
  appCacheCount: number;
  appCacheSize: number;
  pinnedCount: number;
  launchCount: number;
}

interface CacheSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  devices: DeviceCacheInfo[];
  onClearDeviceAppCache: (serial: string) => Promise<void>;
  onClearDevicePreferences: (serial: string) => Promise<void>;
  onClearAll: () => Promise<void>;
}

export function CacheSettingsDialog({
  open,
  onClose,
  devices,
  onClearDeviceAppCache,
  onClearDevicePreferences,
  onClearAll,
}: CacheSettingsDialogProps) {
  const [clearing, setClearing] = useState<{ type: 'app' | 'prefs'; serial: string } | null>(null);
  const [confirming, setConfirming] = useState<{ type: 'app' | 'prefs'; serial: string } | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);

  if (!open) return null;

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleClearAppCache = async (serial: string) => {
    setClearing({ type: 'app', serial });
    try {
      await onClearDeviceAppCache(serial);
    } finally {
      setClearing(null);
      setConfirming(null);
    }
  };

  const handleClearPreferences = async (serial: string) => {
    setClearing({ type: 'prefs', serial });
    try {
      await onClearDevicePreferences(serial);
    } finally {
      setClearing(null);
      setConfirming(null);
    }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try {
      await onClearAll();
    } finally {
      setClearingAll(false);
      setConfirmingAll(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-base/80 backdrop-blur-xl animate-fade-in p-4">
      <div className="bg-surface-elevated/95 backdrop-blur-xl border border-surface-card rounded-2xl shadow-float w-[420px] max-w-[92vw] max-h-[82vh] overflow-y-auto animate-scale-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-card sticky top-0 bg-surface-elevated/95 backdrop-blur-xl z-10">
          <h3 className="text-content-primary font-semibold text-sm">缓存管理</h3>
          <button
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center text-content-secondary hover:text-content-primary rounded-xl hover:bg-surface-card active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            aria-label="关闭弹窗"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {devices.length === 0 && (
            <p className="text-content-muted text-sm text-center py-6">暂无设备缓存数据</p>
          )}

          {devices.map((device) => (
            <div
              key={device.deviceSerial}
              className="bg-surface-card/60 border border-surface-card rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-accent-400 shrink-0" />
                <span className="text-content-primary text-sm font-medium truncate">
                  {device.deviceName}
                </span>
                <span className="text-content-muted text-xs ml-auto truncate tabular-nums">
                  {device.deviceSerial.slice(0, 8)}
                </span>
              </div>

              <div className="space-y-1">
                <p className="text-content-secondary text-xs">
                  应用图标缓存: {formatSize(device.appCacheSize)} ({device.appCacheCount} 个)
                </p>
                <p className="text-content-secondary text-xs">
                  使用偏好: {device.pinnedCount} 个固定, {device.launchCount} 次启动
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                {/* Clear App Cache */}
                <div>
                  {confirming?.type === 'app' && confirming.serial === device.deviceSerial ? (
                    <div className="flex items-center gap-1.5 h-full">
                      <button
                        onClick={() => handleClearAppCache(device.deviceSerial)}
                        disabled={clearing?.type === 'app' && clearing.serial === device.deviceSerial}
                        className="flex-1 min-h-[44px] px-2 py-2 text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center"
                      >
                        {clearing?.type === 'app' ? '清除中...' : '确定清除'}
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="px-3 min-h-[44px] text-xs font-medium bg-surface-base text-content-secondary border border-surface-card rounded-xl hover:bg-surface-elevated hover:text-content-primary transition-colors flex items-center justify-center"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirming({ type: 'app', serial: device.deviceSerial })}
                      className="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-surface-base hover:bg-surface-elevated text-content-primary border border-surface-card rounded-xl transition-all active:scale-[0.98]"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-content-secondary" />
                      清除图标
                    </button>
                  )}
                </div>

                {/* Clear Preferences */}
                <div>
                  {confirming?.type === 'prefs' && confirming.serial === device.deviceSerial ? (
                    <div className="flex items-center gap-1.5 h-full">
                      <button
                        onClick={() => handleClearPreferences(device.deviceSerial)}
                        disabled={clearing?.type === 'prefs' && clearing.serial === device.deviceSerial}
                        className="flex-1 min-h-[44px] px-2 py-2 text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center"
                      >
                        {clearing?.type === 'prefs' ? '清除中...' : '确定清除'}
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="px-3 min-h-[44px] text-xs font-medium bg-surface-base text-content-secondary border border-surface-card rounded-xl hover:bg-surface-elevated hover:text-content-primary transition-colors flex items-center justify-center"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirming({ type: 'prefs', serial: device.deviceSerial })}
                      className="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-surface-base hover:bg-surface-elevated text-content-primary border border-surface-card rounded-xl transition-all active:scale-[0.98]"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-content-secondary" />
                      清除偏好
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Clear All */}
        {devices.length > 0 && (
          <div className="px-5 py-3 border-t border-surface-card">
            {confirmingAll ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-1.5 text-amber-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>清除所有数据？</span>
                </div>
                <button
                  onClick={handleClearAll}
                  disabled={clearingAll}
                  className="px-4 py-2.5 min-h-[48px] text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {clearingAll ? '清除中...' : '确定'}
                </button>
                <button
                  onClick={() => setConfirmingAll(false)}
                  className="px-4 py-2.5 min-h-[48px] text-xs font-medium bg-surface-base text-content-secondary border border-surface-card rounded-xl hover:bg-surface-elevated hover:text-content-primary transition-colors"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingAll(true)}
                className="w-full px-4 py-3 min-h-[48px] text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/20 rounded-xl hover:bg-red-500/25 transition-all active:scale-[0.99] flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                清理所有设备数据
              </button>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t border-surface-card">
          <button
            onClick={onClose}
            className="w-full px-4 py-3 min-h-[48px] text-sm font-medium bg-surface-card text-content-primary border border-surface-card rounded-xl hover:bg-surface-elevated transition-colors flex items-center justify-center active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { X, AlertTriangle, Smartphone } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-gray-900 border border-white/10 rounded-xl shadow-2xl w-96 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-gray-900">
          <h3 className="text-white font-medium text-sm">缓存管理</h3>
          <button
            onClick={onClose}
            className="p-1 text-white/40 hover:text-white rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {devices.length === 0 && (
            <p className="text-white/40 text-sm text-center py-4">暂无设备缓存数据</p>
          )}

          {devices.map((device) => (
            <div
              key={device.deviceSerial}
              className="bg-white/5 rounded-lg p-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <Smartphone className="w-4 h-4 text-white/60" />
                <span className="text-white text-sm font-medium truncate">
                  {device.deviceName}
                </span>
                <span className="text-white/30 text-xs ml-auto truncate">
                  {device.deviceSerial.slice(0, 8)}
                </span>
              </div>

              <div className="space-y-1 mb-3">
                <p className="text-white/50 text-xs">
                  应用图标缓存: {formatSize(device.appCacheSize)} ({device.appCacheCount} 个)
                </p>
                <p className="text-white/50 text-xs">
                  使用偏好: {device.pinnedCount} 个固定, {device.launchCount} 次启动
                </p>
              </div>

              <div className="flex gap-2">
                {/* Clear App Cache */}
                <div className="flex-1">
                  {confirming?.type === 'app' && confirming.serial === device.deviceSerial ? (
                    <div className="flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" />
                      <button
                        onClick={() => handleClearAppCache(device.deviceSerial)}
                        disabled={clearing?.type === 'app' && clearing.serial === device.deviceSerial}
                        className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      >
                        {clearing?.type === 'app' ? '清除中...' : '确定'}
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="px-2 py-0.5 text-xs bg-white/10 text-white/60 rounded hover:bg-white/20 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirming({ type: 'app', serial: device.deviceSerial })}
                      className="w-full px-2 py-0.5 text-xs bg-white/10 text-white/60 rounded hover:bg-white/20 transition-colors"
                    >
                      🗑 清除图标
                    </button>
                  )}
                </div>

                {/* Clear Preferences */}
                <div className="flex-1">
                  {confirming?.type === 'prefs' && confirming.serial === device.deviceSerial ? (
                    <div className="flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" />
                      <button
                        onClick={() => handleClearPreferences(device.deviceSerial)}
                        disabled={clearing?.type === 'prefs' && clearing.serial === device.deviceSerial}
                        className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      >
                        {clearing?.type === 'prefs' ? '清除中...' : '确定'}
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="px-2 py-0.5 text-xs bg-white/10 text-white/60 rounded hover:bg-white/20 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirming({ type: 'prefs', serial: device.deviceSerial })}
                      className="w-full px-2 py-0.5 text-xs bg-white/10 text-white/60 rounded hover:bg-white/20 transition-colors"
                    >
                      ⚙ 清除偏好
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Clear All */}
        {devices.length > 0 && (
          <div className="px-4 py-3 border-t border-white/10">
            {confirmingAll ? (
              <div className="flex items-center justify-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-yellow-400 text-xs">清除所有设备数据？</span>
                <button
                  onClick={handleClearAll}
                  disabled={clearingAll}
                  className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {clearingAll ? '清除中...' : '确定'}
                </button>
                <button
                  onClick={() => setConfirmingAll(false)}
                  className="px-2 py-0.5 text-xs bg-white/10 text-white/60 rounded hover:bg-white/20 transition-colors"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingAll(true)}
                className="w-full px-3 py-1.5 text-xs bg-white/10 text-white/60 rounded hover:bg-white/20 transition-colors"
              >
                清理所有设备数据
              </button>
            )}
          </div>
        )}

        <div className="px-4 py-3 border-t border-white/10">
          <button
            onClick={onClose}
            className="w-full px-3 py-1.5 text-xs bg-white/10 text-white/60 rounded hover:bg-white/20 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
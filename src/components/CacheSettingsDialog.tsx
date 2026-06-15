import { useState } from 'react';
import { X, Trash2, AlertTriangle } from 'lucide-react';

interface CacheSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onClearAppCache: () => Promise<void>;
  onClearUsageData: () => Promise<void>;
}

export function CacheSettingsDialog({
  open,
  onClose,
  onClearAppCache,
  onClearUsageData,
}: CacheSettingsDialogProps) {
  const [clearing, setClearing] = useState<'app' | 'usage' | null>(null);
  const [confirming, setConfirming] = useState<'app' | 'usage' | null>(null);

  if (!open) return null;

  const handleClearAppCache = async () => {
    setClearing('app');
    try {
      await onClearAppCache();
    } finally {
      setClearing(null);
      setConfirming(null);
    }
  };

  const handleClearUsageData = async () => {
    setClearing('usage');
    try {
      await onClearUsageData();
    } finally {
      setClearing(null);
      setConfirming(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-gray-900 border border-white/10 rounded-xl shadow-2xl w-80 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="text-white font-medium text-sm">缓存设置</h3>
          <button
            onClick={onClose}
            className="p-1 text-white/40 hover:text-white rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Clear App Cache */}
          <div className="bg-white/5 rounded-lg p-3">
            <div className="flex items-start gap-3">
              <Trash2 className="w-4 h-4 text-white/60 mt-0.5" />
              <div className="flex-1">
                <p className="text-white text-sm">清除应用缓存</p>
                <p className="text-white/40 text-xs mt-0.5">
                  删除所有应用图标和标签缓存
                </p>
                {confirming === 'app' ? (
                  <div className="flex items-center gap-2 mt-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-yellow-400 text-xs">确定清除？</span>
                    <button
                      onClick={handleClearAppCache}
                      disabled={clearing === 'app'}
                      className="ml-auto px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors disabled:opacity-50"
                    >
                      {clearing === 'app' ? '清除中...' : '确定'}
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
                    onClick={() => setConfirming('app')}
                    className="mt-2 px-2 py-0.5 text-xs bg-white/10 text-white/60 rounded hover:bg-white/20 transition-colors"
                  >
                    清除
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Clear Usage Data */}
          <div className="bg-white/5 rounded-lg p-3">
            <div className="flex items-start gap-3">
              <Trash2 className="w-4 h-4 text-white/60 mt-0.5" />
              <div className="flex-1">
                <p className="text-white text-sm">清除使用习惯</p>
                <p className="text-white/40 text-xs mt-0.5">
                  重置置顶应用和启动次数
                </p>
                {confirming === 'usage' ? (
                  <div className="flex items-center gap-2 mt-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-yellow-400 text-xs">确定清除？</span>
                    <button
                      onClick={handleClearUsageData}
                      disabled={clearing === 'usage'}
                      className="ml-auto px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors disabled:opacity-50"
                    >
                      {clearing === 'usage' ? '清除中...' : '确定'}
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
                    onClick={() => setConfirming('usage')}
                    className="mt-2 px-2 py-0.5 text-xs bg-white/10 text-white/60 rounded hover:bg-white/20 transition-colors"
                  >
                    清除
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

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

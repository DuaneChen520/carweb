import { useState, useEffect } from 'react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { VirtualScreen } from './components/VirtualScreen';
import { ScrcpyProvider } from './contexts/ScrcpyContext';
import { useAdbStore } from './hooks/useAdbStore';

function App() {
  const [isMirroring, setIsMirroring] = useState(false);

  // 页面刷新/关闭时清理 ADB 连接和 scrcpy session
  useEffect(() => {
    const handleBeforeUnload = () => {
      const adb = useAdbStore.getState().adb;
      if (adb) {
        // 同步尝试关闭连接（best-effort，页面即将卸载）
        try { adb.close(); } catch { /* ignore */ }
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleStartMirror = () => {
    setIsMirroring(true);
  };

  const handleStopMirror = () => {
    setIsMirroring(false);
  };

  return (
    <div className="w-full h-screen bg-slate-900">
      {isMirroring ? (
        <ScrcpyProvider>
          <VirtualScreen onStop={handleStopMirror} />
        </ScrcpyProvider>
      ) : (
        <ConnectionPanel onStartMirror={handleStartMirror} />
      )}
    </div>
  );
}

export default App;

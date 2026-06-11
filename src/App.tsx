import { useState } from 'react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { VirtualScreen } from './components/VirtualScreen';
import { ScrcpyProvider } from './contexts/ScrcpyContext';

function App() {
  const [isMirroring, setIsMirroring] = useState(false);

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

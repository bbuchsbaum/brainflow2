import { useEffect, useRef } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { GoldenLayoutRoot } from '@/components/layout/GoldenLayoutRoot';
import { NotificationToast } from '@/components/ui/NotificationToast';
import { StatusBar } from '@/components/ui/StatusBar';
import { GlobalProgressBar } from '@/components/ui/GlobalProgressBar';
import { StatusProvider } from '@/contexts/StatusContext';
import { useBackendSync } from '@/hooks/useBackendSync';
import { useMountListener } from '@/hooks/useMountListener';
import { useServicesInit } from '@/hooks/useServicesInit';
import { useStatusBarUpdates } from '@/hooks/useStatusBarUpdates';
import { useWorkspaceMenuListener } from '@/hooks/useWorkspaceMenuListener';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { getProgressService } from '@/services/ProgressService';
import { ProgressDebug } from '@/components/ui/ProgressDebug';
import { MetadataStatusBridge } from '@/components/MetadataStatusBridge';

function ErrorFallback({ error, resetErrorBoundary }: any) {
  return (
    <div className="h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-red-900 border border-red-700 rounded-lg p-6 max-w-md">
        <h2 className="text-red-400 text-lg font-semibold mb-2">Something went wrong</h2>
        <pre className="text-red-300 text-sm mb-4 whitespace-pre-wrap">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <button
            onClick={resetErrorBoundary}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
          >
            Try again
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('brainflow2-workspace');
              window.location.reload();
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Clear Cache & Reload
          </button>
        </div>
      </div>
    </div>
  );
}

// DebugPanel removed - was used for testing

// Component that uses the status context
function AppContent() {
  console.log('[AppContent] AppContent component rendering');
  
  // All hooks must be called before any conditional returns
  const renderCount = useRef(0);
  
  // Initialize services first - this is the root of all initialization
  useServicesInit();
  
  // Enable coalescing after services are initialized
  useEffect(() => {
    console.log('[AppContent] Enabling coalescing middleware');
    coalesceUtils.setEnabled(true);
  }, []);
  
  // Then initialize other hooks that depend on services
  // Re-enable these one by one to test
  // Connect to backend sync - DISABLED: duplicate of useServicesInit callback
  // useBackendSync();
  
  // Listen for mount directory events
  useMountListener();
  
  // Listen for workspace menu events
  useWorkspaceMenuListener();
  
  // Initialize status bar updates - temporarily disabled to debug render loop
  // useStatusBarUpdates();
  
  // Global render logging (after hooks)
  if (typeof window !== 'undefined' && (window as any).__logRender) {
    (window as any).__logRender('AppContent');
  }
  
  // Render loop detection and bailout (after all hooks)
  renderCount.current++;
  if (renderCount.current > 50) {
    console.error('[AppContent] RENDER LOOP DETECTED! Render count:', renderCount.current);
    console.trace('Stack trace:');
    // Bail out to prevent browser crash
    if (renderCount.current > 100) {
      return (
        <div className="h-screen bg-gray-950 flex items-center justify-center text-red-500">
          <div className="text-center">
            <h2 className="text-lg font-semibold mb-2">Render Loop Detected</h2>
            <p className="mb-4">The application encountered an infinite render loop</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
  }
  
  // Progress service is initialized in useServicesInit
  
  // Note: Threshold logic has been fixed in the shader - no workaround needed
  
  console.log('[AppContent] AppContent initialization complete');
  
  return (
    <div className="h-screen flex flex-col">
      <MetadataStatusBridge />
      <ProgressDebug />
      <GlobalProgressBar />
      <div className="flex-1 overflow-hidden">
        <GoldenLayoutRoot />
      </div>
      <StatusBar />
      <NotificationToast />
    </div>
  );
}

// Initial status bar slots configuration
const initialStatusSlots = [
  { id: 'coordSys', label: 'Coordinate System:', value: 'LPI', width: '25ch' },
  { id: 'crosshair', label: 'Crosshair:', value: '(0.0, 0.0, 0.0)', width: '30ch' },
  { id: 'mouse', label: 'Mouse:', value: '--', width: '30ch' },
  { id: 'layer', label: 'Layer:', value: 'None', width: '30ch' },
  { id: 'fps', label: 'FPS:', value: '--', width: '12ch' },
  { id: 'gpu', label: 'GPU:', value: 'Ready', width: '15ch' }
];

function App() {
  console.log('[App] App component rendering');
  
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <StatusProvider initial={initialStatusSlots}>
        <AppContent />
      </StatusProvider>
    </ErrorBoundary>
  );
}

export default App;
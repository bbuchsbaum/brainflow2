import { useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { GoldenLayoutWrapper } from '@/components/layout/GoldenLayoutWrapper';
import { NotificationToast } from '@/components/ui/NotificationToast';
import { StatusBar } from '@/components/ui/StatusBar';
import { StatusProvider } from '@/contexts/StatusContext';
import { useBackendSync } from '@/hooks/useBackendSync';
import { useMountListener } from '@/hooks/useMountListener';
import { useServicesInit } from '@/hooks/useServicesInit';
import { useStatusBarUpdates } from '@/hooks/useStatusBarUpdates';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';

function ErrorFallback({ error, resetErrorBoundary }: any) {
  return (
    <div className="h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-red-900 border border-red-700 rounded-lg p-6 max-w-md">
        <h2 className="text-red-400 text-lg font-semibold mb-2">Something went wrong</h2>
        <pre className="text-red-300 text-sm mb-4 whitespace-pre-wrap">
          {error.message}
        </pre>
        <button
          onClick={resetErrorBoundary}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function DebugPanel() {
  const viewStateLayers = useViewStateStore(state => state.viewState.layers);
  const storeLayers = useLayerStore(state => state.layers);
  
  const handleTestLoad = async () => {
    console.log('[DebugPanel] Test load button clicked');
    try {
      const { getFileLoadingService } = await import('@/services/FileLoadingService');
      const fileService = getFileLoadingService();
      const testPath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii';
      console.log('[DebugPanel] Loading test file:', testPath);
      await fileService.loadFile(testPath);
      console.log('[DebugPanel] File load completed');
      
      // Check state after load
      const layerState = useLayerStore.getState();
      const viewState = useViewStateStore.getState();
      console.log('[DebugPanel] After load - LayerStore:', layerState.layers.length, 'layers');
      console.log('[DebugPanel] After load - ViewState:', viewState.viewState.layers.length, 'layers');
    } catch (error) {
      console.error('[DebugPanel] Test load failed:', error);
    }
  };
  
  const handleForceUpdate = () => {
    console.log('[DebugPanel] Forcing backend update');
    coalesceUtils.flush();
  };
  
  return (
    <div className="fixed bottom-10 right-0 bg-black/80 text-white p-2 text-xs max-w-md">
      <div>LayerStore: {storeLayers.length} layers</div>
      <div>ViewState: {viewStateLayers.length} layers</div>
      {viewStateLayers.map(l => (
        <div key={l.id}>- {l.id.slice(0, 8)}... visible:{l.visible ? 'Y' : 'N'} opacity:{l.opacity}</div>
      ))}
      <button 
        onClick={handleTestLoad}
        className="mt-2 bg-blue-500 hover:bg-blue-600 px-2 py-1 rounded text-xs"
      >
        Test Load MNI
      </button>
      <button 
        onClick={handleForceUpdate}
        className="mt-2 ml-2 bg-green-500 hover:bg-green-600 px-2 py-1 rounded text-xs"
      >
        Force Update
      </button>
    </div>
  );
}

// Component that uses the status context
function AppContent() {
  console.log('[AppContent] AppContent component rendering');
  
  // Initialize services
  useServicesInit();
  
  // Connect to backend sync
  useBackendSync();
  
  // Listen for mount directory events
  useMountListener();
  
  // Initialize status bar updates
  useStatusBarUpdates();
  
  // Fix threshold values for any existing layers (temporary fix for already-loaded volumes)
  useEffect(() => {
    // Subscribe to ViewState changes to continuously monitor and fix threshold values
    const unsubscribe = useViewStateStore.subscribe(
      state => state.viewState.layers,
      layers => {
        const needsFix = layers.some(l => 
          l.threshold[0] !== 0 || l.threshold[1] !== 0
        );
        
        if (needsFix) {
          console.log('[App] Fixing threshold values in ViewState - found layers with non-zero threshold');
          console.log('[App] Current thresholds:', layers.map(l => ({ id: l.id, threshold: l.threshold })));
          console.log('[App] Current intensities (preserving):', layers.map(l => ({ id: l.id, intensity: l.intensity })));
          
          useViewStateStore.getState().setViewState(state => ({
            ...state,
            layers: layers.map(layer => ({
              ...layer,
              threshold: [0, 0],  // Fix threshold to disable thresholding
              // CRITICAL: Preserve existing intensity values to prevent snapback
              intensity: layer.intensity
            }))
          }));
          
          console.log('[App] Threshold values fixed to [0, 0] for all layers, intensity preserved');
        }
      }
    );
    
    // Also fix immediately on mount
    const viewState = useViewStateStore.getState();
    const currentLayers = viewState.viewState.layers;
    
    if (currentLayers.length > 0) {
      const needsFix = currentLayers.some(layer => 
        layer.threshold[0] !== 0 || layer.threshold[1] !== 0
      );
      
      if (needsFix) {
        console.log('[App] Initial fix: Fixing threshold values for existing layers');
        viewState.setViewState((state) => ({
          ...state,
          layers: currentLayers.map(layer => ({
            ...layer,
            threshold: [0, 0],  // Fix threshold to disable thresholding
            // CRITICAL: Preserve existing intensity values to prevent snapback
            intensity: layer.intensity
          }))
        }));
      }
    }
    
    return unsubscribe;
  }, []);
  
  console.log('[AppContent] AppContent initialization complete');
  
  return (
    <>
      <div className="h-screen flex flex-col">
        <div className="flex-1 overflow-hidden">
          <GoldenLayoutWrapper />
        </div>
        <StatusBar />
      </div>
      <NotificationToast />
      <DebugPanel />
    </>
  );
}

// Initial status bar slots configuration
const initialStatusSlots = [
  { id: 'coordSys', label: 'Coordinate System:', value: 'LPI', width: '18ch' },
  { id: 'crosshair', label: 'Crosshair:', value: '(0.0, 0.0, 0.0)', width: '24ch' },
  { id: 'mouse', label: 'Mouse:', value: '--', width: '24ch' },
  { id: 'layer', label: 'Layer:', value: 'None', width: '20ch' },
  { id: 'fps', label: 'FPS:', value: '--', width: '10ch' },
  { id: 'gpu', label: 'GPU:', value: 'Ready', width: '12ch' }
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
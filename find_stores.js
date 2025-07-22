// Find the actual stores and their structure
console.log('=== Finding Stores ===\n');

// Method 1: Check window.__viewStateStore
console.log('1. Checking window.__viewStateStore:', window.__viewStateStore);

// Method 2: Look for React context/hooks
console.log('\n2. Checking for React Fiber stores...');

// Find React root
const reactRoot = document.getElementById('root')?._reactRootContainer || 
                 document.getElementById('root')?._reactRootFiber ||
                 document.querySelector('#root')?._reactRootContainer;
console.log('React root:', reactRoot);

// Method 3: Look for Zustand stores in window
console.log('\n3. Scanning window for stores...');
for (const key in window) {
  if (key.includes('store') || key.includes('Store') || key.includes('zustand')) {
    console.log(`Found: window.${key} =`, window[key]);
  }
}

// Method 4: Check the apiService and see what stores it might reference
console.log('\n4. Checking apiService references...');
console.log('window.apiService:', window.apiService);

// Method 5: Try to find stores through the loaded modules
console.log('\n5. Checking for __viewStateStore...');
if (window.__viewStateStore) {
  const store = window.__viewStateStore;
  console.log('Found __viewStateStore!');
  console.log('Store type:', Object.prototype.toString.call(store));
  console.log('Store methods:', Object.getOwnPropertyNames(store));
  
  // Try to get state
  if (typeof store.getState === 'function') {
    const state = store.getState();
    console.log('\nCurrent state structure:');
    console.log('- Keys:', Object.keys(state));
    console.log('- viewState:', state.viewState);
    console.log('- layers:', state.viewState?.layers);
  }
}

// Create helper to access stores properly
window.getStores = function() {
  const stores = {
    viewState: window.__viewStateStore,
    layers: null,
    volumes: null
  };
  
  // Try to find other stores
  for (const key in window) {
    if (key.endsWith('Store') && key.startsWith('__')) {
      const storeName = key.replace('__', '').replace('Store', '');
      stores[storeName] = window[key];
    }
  }
  
  return stores;
};

// Create helper to check current state
window.checkState = function() {
  console.log('\n=== Current Application State ===');
  
  const stores = window.getStores();
  
  if (stores.viewState?.getState) {
    const state = stores.viewState.getState();
    console.log('\nViewState Store:');
    console.log('- Has viewState:', !!state.viewState);
    console.log('- Layers:', state.viewState?.layers?.length || 0);
    console.log('- Layer IDs:', state.viewState?.layers?.map(l => l.id));
    console.log('- Crosshair:', state.viewState?.crosshair);
    
    // Check the structure
    if (state.viewState?.layers?.length > 0) {
      console.log('\nFirst layer structure:');
      console.log(state.viewState.layers[0]);
    }
  } else {
    console.log('ViewState store not found or not accessible');
  }
  
  // Check if image is visible in DOM
  const canvases = document.querySelectorAll('canvas');
  console.log('\nCanvas elements found:', canvases.length);
  canvases.forEach((canvas, i) => {
    console.log(`Canvas ${i}: ${canvas.width}x${canvas.height}, parent: ${canvas.parentElement?.className}`);
  });
};

// Run initial check
window.checkState();

console.log('\n✅ Helpers created:');
console.log('- window.getStores() - Get all stores');
console.log('- window.checkState() - Check current state');
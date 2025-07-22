// Test script to verify intensity range fix
// Run this in the browser console after loading a NIfTI file

// Monitor layer additions
const originalAddLayer = useLayerStore.getState().addLayer;
useLayerStore.setState({
  addLayer: (layer, render) => {
    console.log('[TEST] addLayer called with:');
    console.log('  Layer:', layer);
    console.log('  Render properties:', render);
    if (render?.intensity) {
      console.log(`  ✓ Intensity range: [${render.intensity[0]}, ${render.intensity[1]}]`);
    } else {
      console.log('  ✗ No render properties provided!');
    }
    originalAddLayer(layer, render);
  }
});

// Monitor ViewState updates
const unsubscribe = useViewStateStore.subscribe(
  (state) => state.viewState,
  (viewState) => {
    console.log('[TEST] ViewState updated:');
    viewState.layers.forEach((layer, idx) => {
      console.log(`  Layer ${idx}: ${layer.name}`);
      console.log(`    Intensity: [${layer.intensity[0]}, ${layer.intensity[1]}]`);
      if (layer.intensity[0] === 0 && layer.intensity[1] === 100) {
        console.log('    ⚠️  WARNING: Default intensity range detected!');
      } else {
        console.log('    ✓ Custom intensity range applied');
      }
    });
  }
);

console.log('Test monitoring enabled. Now load a NIfTI file and check the console output.');
console.log('The intensity range should NOT be [0, 100] after our fix.');
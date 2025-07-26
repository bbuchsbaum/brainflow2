// Test script to manually trigger a render
// Run in browser console after loading an image

async function testRender() {
  console.log('=== TEST RENDER START ===');
  
  // Get current state
  const viewState = window.__viewStateStore.getState().viewState;
  console.log('Current ViewState:', viewState);
  console.log('Number of layers:', viewState.layers.length);
  
  if (viewState.layers.length === 0) {
    console.error('No layers loaded! Load an image first.');
    return;
  }
  
  // Get the API service
  const apiService = window.__BRAINFLOW_SERVICES?.apiService;
  if (!apiService) {
    console.error('API service not available');
    return;
  }
  
  // Try to render axial view
  console.log('Attempting to render axial view...');
  try {
    const imageBitmap = await apiService.applyAndRenderViewState(
      viewState,
      'axial',
      512,
      512
    );
    
    console.log('Render result:', {
      success: !!imageBitmap,
      type: imageBitmap ? Object.prototype.toString.call(imageBitmap) : 'null',
      isImageBitmap: imageBitmap instanceof ImageBitmap
    });
    
    if (imageBitmap) {
      console.log('ImageBitmap dimensions:', imageBitmap.width, 'x', imageBitmap.height);
      
      // Try to display it in a new canvas
      const testCanvas = document.createElement('canvas');
      testCanvas.width = 512;
      testCanvas.height = 512;
      testCanvas.style.border = '2px solid red';
      testCanvas.style.position = 'fixed';
      testCanvas.style.top = '10px';
      testCanvas.style.right = '10px';
      testCanvas.style.zIndex = '9999';
      document.body.appendChild(testCanvas);
      
      const ctx = testCanvas.getContext('2d');
      ctx.drawImage(imageBitmap, 0, 0);
      
      console.log('Test canvas added to page (red border, top-right)');
      
      // Remove after 5 seconds
      setTimeout(() => {
        testCanvas.remove();
        console.log('Test canvas removed');
      }, 5000);
    }
  } catch (error) {
    console.error('Render failed:', error);
  }
  
  console.log('=== TEST RENDER END ===');
}

// Export to window
window.testRender = testRender;
console.log('Test render function added. Run: testRender()');
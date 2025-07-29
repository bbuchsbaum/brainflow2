// Debug script to check what ViewState is being sent to backend
// Run this in browser console after loading a file

// Hook into the apiService to log what's being sent
const originalInvoke = window.__TAURI__.core.invoke;
window.__TAURI__.core.invoke = async function(cmd, args) {
  if (cmd === 'plugin:api-bridge|apply_and_render_view_state') {
    console.log('=== ViewState being sent to backend ===');
    const viewState = JSON.parse(args.viewStateJson);
    console.log('Full ViewState:', viewState);
    console.log('Number of layers:', viewState.layers?.length || 0);
    if (viewState.layers && viewState.layers.length > 0) {
      console.log('First layer:', viewState.layers[0]);
    }
  }
  return originalInvoke.call(this, cmd, args);
};

console.log('ViewState debugging enabled. Now interact with the app and check console.');
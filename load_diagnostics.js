// Load diagnostic scripts
console.log('Loading diagnostic scripts...\n');

// Helper to load script
function loadScript(path) {
  const script = document.createElement('script');
  script.src = path + '?t=' + Date.now(); // Cache bust
  document.head.appendChild(script);
  console.log('✅ Loaded:', path);
}

// Load the diagnostic scripts
loadScript('diagnose_rgba_issue.js');
loadScript('debug_rgba_comprehensive.js');
loadScript('test_rgba_command.js');

console.log('\nWait a moment for scripts to load, then run:');
console.log('- window.diagnoseRGBAIssue() - Main diagnostic');
console.log('- window.rgbaStatus() - Check current status');
console.log('- window.testRawRGBACommand() - Test command directly');
console.log('- window.debugRGBAComprehensive() - Comprehensive debug');
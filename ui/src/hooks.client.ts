/**
 * Client-side hooks for global error handling
 * Catches unhandled promises and errors that can cause white screens
 */

// Add global error handlers to catch issues that cause white screens
window.addEventListener('unhandledrejection', (event) => {
	console.error('🚨 UNHANDLED PROMISE REJECTION:', event.reason);
	console.error('Promise:', event.promise);

	// Disabled alert - errors still logged to console
	// if (import.meta.env.DEV) {
	// 	alert(`Unhandled Promise Rejection: ${event.reason?.message || event.reason}`);
	// }

	// Don't prevent default to ensure the error is still logged normally
});

window.addEventListener('error', (event) => {
	console.error('🚨 GLOBAL ERROR:', event.error);
	console.error('Message:', event.message);
	console.error('Source:', event.filename, 'Line:', event.lineno, 'Col:', event.colno);

	// Disabled alert - errors still logged to console
	// if (import.meta.env.DEV) {
	// 	alert(`Global Error: ${event.error?.message || event.message}`);
	// }
});

// Additional handler for module loading errors
window.addEventListener('unhandledrejection', (event) => {
	if (
		event.reason?.message?.includes('circular dependency') ||
		event.reason?.message?.includes('Cannot resolve')
	) {
		console.error('🔄 POTENTIAL CIRCULAR DEPENDENCY OR MODULE LOADING ISSUE');
		console.error('This might be causing the white screen');
	}
});

console.log('🛡️ Global error handlers initialized');

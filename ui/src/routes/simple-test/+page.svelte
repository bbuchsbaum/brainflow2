<script>
	console.log('=== Simple Test Page Loaded ===');
	
	// Test 1: Can we import the module?
	import('@tauri-apps/api/core')
		.then(module => {
			console.log('✅ Tauri module imported:', module);
			
			// Test 2: Can we invoke a command?
			return module.invoke('plugin:api-bridge|fs_list_directory', {
				path_str: '/tmp'
			});
		})
		.then(result => {
			console.log('✅ API call worked!', result);
		})
		.catch(error => {
			console.error('❌ Error:', error);
		});
</script>

<h1>Simple Test - Check Browser Console</h1>
<p>Press F12 to open developer tools and check the Console tab.</p>
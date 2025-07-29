// Test script to verify progress indicators work
// Run this in the browser console when the app is running

// Test 1: Frontend-only progress task
const testFrontendProgress = () => {
  const progressService = window.__BRAINFLOW_SERVICES?.progressService;
  if (!progressService) {
    console.error('Progress service not available');
    return;
  }
  
  const taskId = progressService.startTask('computation', 'Test Computation', {
    message: 'Processing data...',
    cancellable: true
  });
  
  let progress = 0;
  const interval = setInterval(() => {
    progress += 10;
    progressService.updateTask(taskId, progress, `Progress: ${progress}%`);
    
    if (progress >= 100) {
      clearInterval(interval);
      progressService.completeTask(taskId);
      console.log('Test task completed!');
    }
  }, 500);
  
  return taskId;
};

// Test 2: Simulate file loading (if file service is available)
const testFileLoading = async () => {
  try {
    const fileService = window.__BRAINFLOW_SERVICES?.fileLoadingService;
    if (!fileService) {
      console.error('File loading service not available');
      return;
    }
    
    const testPath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii';
    console.log('Loading test file:', testPath);
    await fileService.loadFile(testPath);
    console.log('File loaded successfully!');
  } catch (error) {
    console.error('File loading failed:', error);
  }
};

// Instructions
console.log('Progress indicator test functions loaded.');
console.log('Run testFrontendProgress() to test a frontend-only progress task');
console.log('Run testFileLoading() to test file loading with progress');
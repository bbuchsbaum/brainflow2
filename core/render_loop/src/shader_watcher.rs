// Shader file watching for hot-reload during development

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, SystemTime};
use std::collections::HashMap;

/// Events emitted by the shader watcher
#[derive(Debug, Clone)]
pub enum ShaderWatchEvent {
    /// A shader file was modified
    Modified { path: PathBuf, name: String },
    /// Error watching shader files
    Error(String),
}

/// Watches shader files for changes and provides hot-reload functionality
pub struct ShaderWatcher {
    shader_dir: PathBuf,
    receiver: Option<Receiver<ShaderWatchEvent>>,
    last_modified: HashMap<PathBuf, SystemTime>,
}

impl ShaderWatcher {
    /// Create a new shader watcher for the given directory
    pub fn new<P: AsRef<Path>>(shader_dir: P) -> Self {
        Self {
            shader_dir: shader_dir.as_ref().to_path_buf(),
            receiver: None,
            last_modified: HashMap::new(),
        }
    }
    
    /// Start watching for shader changes
    pub fn start_watching(&mut self) -> Result<(), String> {
        // Initialize last modified times
        self.scan_initial_files()?;
        
        // For now, we'll use a simple polling approach
        // In production, we'd use notify or similar crate
        let (sender, receiver) = channel();
        self.receiver = Some(receiver);
        
        // Clone data for the polling thread
        let shader_dir = self.shader_dir.clone();
        let mut last_modified = self.last_modified.clone();
        
        // Spawn a thread to poll for changes
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_millis(500)); // Poll every 500ms
                
                // Check each shader file
                if let Ok(entries) = std::fs::read_dir(&shader_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.extension().map_or(false, |ext| ext == "wgsl") {
                            if let Ok(metadata) = std::fs::metadata(&path) {
                                if let Ok(modified) = metadata.modified() {
                                    let should_notify = match last_modified.get(&path) {
                                        Some(last) => modified > *last,
                                        None => true,
                                    };
                                    
                                    if should_notify {
                                        last_modified.insert(path.clone(), modified);
                                        
                                        // Extract shader name from filename
                                        if let Some(name) = path.file_stem() {
                                            let _ = sender.send(ShaderWatchEvent::Modified {
                                                path: path.clone(),
                                                name: name.to_string_lossy().to_string(),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        
        Ok(())
    }
    
    /// Check for shader change events (non-blocking)
    pub fn check_events(&mut self) -> Vec<ShaderWatchEvent> {
        let mut events = Vec::new();
        
        if let Some(receiver) = &self.receiver {
            while let Ok(event) = receiver.try_recv() {
                events.push(event);
            }
        }
        
        events
    }
    
    /// Scan initial shader files to establish baseline
    fn scan_initial_files(&mut self) -> Result<(), String> {
        let entries = std::fs::read_dir(&self.shader_dir)
            .map_err(|e| format!("Failed to read shader directory: {}", e))?;
        
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "wgsl") {
                    if let Ok(metadata) = std::fs::metadata(&path) {
                        if let Ok(modified) = metadata.modified() {
                            self.last_modified.insert(path, modified);
                        }
                    }
                }
            }
        }
        
        Ok(())
    }
}

#[cfg(feature = "hot-reload")]
pub fn enable_hot_reload() -> bool {
    true
}

#[cfg(not(feature = "hot-reload"))]
pub fn enable_hot_reload() -> bool {
    false
}
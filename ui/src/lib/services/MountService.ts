/**
 * MountService - Service layer for file system mount management
 * Handles directory mounting, file pattern filtering, and mount persistence
 */

import type { EventBus } from '$lib/events/EventBus';
import type { ValidationService } from '$lib/validation/ValidationService';
import type { ConfigService } from './ConfigService';
import type { MountConfig } from '$lib/validation/schemas';
import { LRUCache } from '$lib/utils/LRUCache';

export interface MountServiceConfig {
  eventBus: EventBus;
  validator: ValidationService;
  api: any; // CoreAPI type
  configService: ConfigService;
}

export interface Mount {
  id: string;
  path: string;
  label: string;
  filePatterns: string[];
  isAvailable: boolean;
  lastChecked: number;
  fileCount?: number;
  totalSize?: number;
}

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: number;
}

export interface DirectoryContents {
  path: string;
  files: FileInfo[];
  directories: FileInfo[];
  totalSize: number;
}

export class MountService {
  private config: MountServiceConfig;
  private mounts = new Map<string, Mount>();
  private directoryCache = new LRUCache<string, DirectoryContents>(50);
  private checkInterval: number | null = null;

  constructor(config: MountServiceConfig) {
    this.config = config;
    this.loadMounts();
    this.startAvailabilityChecking();
  }

  /**
   * Load mounts from configuration
   */
  private loadMounts() {
    const savedMounts = this.config.configService.getWorkspaceConfig().mounts || [];
    
    for (const mountConfig of savedMounts) {
      try {
        const validatedConfig = this.config.validator.validate('MountConfig', mountConfig);
        this.mounts.set(validatedConfig.id, {
          ...validatedConfig,
          isAvailable: false,
          lastChecked: 0
        });
      } catch (error) {
        console.error('Invalid mount config:', error);
      }
    }
  }

  /**
   * Save mounts to configuration
   */
  private saveMounts() {
    const mountConfigs = Array.from(this.mounts.values()).map(mount => ({
      id: mount.id,
      path: mount.path,
      label: mount.label,
      filePatterns: mount.filePatterns
    }));
    
    this.config.configService.updateWorkspaceConfig({
      ...this.config.configService.getWorkspaceConfig(),
      mounts: mountConfigs
    });
  }

  /**
   * Start periodic availability checking
   */
  private startAvailabilityChecking() {
    // Check every 30 seconds
    this.checkInterval = window.setInterval(() => {
      this.checkAllMounts();
    }, 30000);
    
    // Initial check
    this.checkAllMounts();
  }

  /**
   * Add a new mount
   */
  async addMount(config: MountConfig): Promise<Mount> {
    try {
      // Validate configuration
      const validatedConfig = this.config.validator.validate('MountConfig', config);
      
      // Check if mount already exists
      if (this.mounts.has(validatedConfig.id)) {
        throw new Error(`Mount with id ${validatedConfig.id} already exists`);
      }
      
      // Create mount
      const mount: Mount = {
        ...validatedConfig,
        isAvailable: false,
        lastChecked: 0
      };
      
      // Check availability immediately
      await this.checkMountAvailability(mount);
      
      // Add to mounts
      this.mounts.set(mount.id, mount);
      
      // Save configuration
      this.saveMounts();
      
      // Emit event
      this.config.eventBus.emit('mount.added', { mount });
      
      return mount;
    } catch (error) {
      this.config.eventBus.emit('mount.add.failed', { config, error });
      throw error;
    }
  }

  /**
   * Remove a mount
   */
  async removeMount(mountId: string): Promise<void> {
    const mount = this.mounts.get(mountId);
    if (!mount) {
      throw new Error(`Mount ${mountId} not found`);
    }
    
    // Remove from mounts
    this.mounts.delete(mountId);
    
    // Clear cache entries for this mount
    this.clearMountCache(mount.path);
    
    // Save configuration
    this.saveMounts();
    
    // Emit event
    this.config.eventBus.emit('mount.removed', { mountId });
  }

  /**
   * Update mount configuration
   */
  async updateMount(mountId: string, updates: Partial<MountConfig>): Promise<Mount> {
    const mount = this.mounts.get(mountId);
    if (!mount) {
      throw new Error(`Mount ${mountId} not found`);
    }
    
    try {
      // Validate updates
      const updatedConfig = this.config.validator.validate('MountConfig', {
        ...mount,
        ...updates
      });
      
      // Update mount
      const updatedMount: Mount = {
        ...mount,
        ...updatedConfig
      };
      
      // If path changed, clear old cache and check new path
      if (mount.path !== updatedMount.path) {
        this.clearMountCache(mount.path);
        await this.checkMountAvailability(updatedMount);
      }
      
      // Update in map
      this.mounts.set(mountId, updatedMount);
      
      // Save configuration
      this.saveMounts();
      
      // Emit event
      this.config.eventBus.emit('mount.updated', { mount: updatedMount });
      
      return updatedMount;
    } catch (error) {
      this.config.eventBus.emit('mount.update.failed', { mountId, updates, error });
      throw error;
    }
  }

  /**
   * Get all mounts
   */
  getAllMounts(): Mount[] {
    return Array.from(this.mounts.values());
  }

  /**
   * Get available mounts
   */
  getAvailableMounts(): Mount[] {
    return Array.from(this.mounts.values()).filter(m => m.isAvailable);
  }

  /**
   * Get mount by ID
   */
  getMount(mountId: string): Mount | undefined {
    return this.mounts.get(mountId);
  }

  /**
   * List directory contents
   */
  async listDirectory(path: string, useCache = true): Promise<DirectoryContents> {
    // Check cache first
    if (useCache) {
      const cached = this.directoryCache.get(path);
      if (cached) {
        return cached;
      }
    }
    
    try {
      // Get mount for path
      const mount = this.getMountForPath(path);
      
      // List directory via API
      const tree = await this.config.api.ls_tree(path);
      
      // Parse tree into file info
      const files: FileInfo[] = [];
      const directories: FileInfo[] = [];
      let totalSize = 0;
      
      for (const node of tree.nodes) {
        const fileInfo: FileInfo = {
          path: node.id,
          name: node.name,
          size: node.size || 0,
          isDirectory: node.is_dir,
          modifiedAt: Date.now() // API doesn't provide this yet
        };
        
        // Apply file pattern filtering if this is a mount
        if (mount && !node.is_dir) {
          const matchesPattern = mount.filePatterns.some(pattern => 
            this.matchesPattern(node.name, pattern)
          );
          if (!matchesPattern) continue;
        }
        
        if (node.is_dir) {
          directories.push(fileInfo);
        } else {
          files.push(fileInfo);
          totalSize += fileInfo.size;
        }
      }
      
      // Sort directories and files
      directories.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
      
      const contents: DirectoryContents = {
        path,
        files,
        directories,
        totalSize
      };
      
      // Cache result
      this.directoryCache.set(path, contents);
      
      return contents;
    } catch (error) {
      this.config.eventBus.emit('mount.list.failed', { path, error });
      throw error;
    }
  }

  /**
   * Search for files in mounts
   */
  async searchFiles(
    query: string,
    options?: {
      mountIds?: string[];
      filePatterns?: string[];
      maxResults?: number;
    }
  ): Promise<FileInfo[]> {
    const results: FileInfo[] = [];
    const maxResults = options?.maxResults || 100;
    
    // Get mounts to search
    const mountsToSearch = options?.mountIds
      ? options.mountIds.map(id => this.mounts.get(id)).filter(Boolean) as Mount[]
      : this.getAvailableMounts();
    
    for (const mount of mountsToSearch) {
      if (results.length >= maxResults) break;
      
      try {
        // Search in mount
        const searchResults = await this.searchInPath(
          mount.path,
          query,
          options?.filePatterns || mount.filePatterns,
          maxResults - results.length
        );
        
        results.push(...searchResults);
      } catch (error) {
        console.error(`Search failed in mount ${mount.id}:`, error);
      }
    }
    
    return results;
  }

  /**
   * Check mount availability
   */
  private async checkMountAvailability(mount: Mount): Promise<void> {
    try {
      // Try to list the directory
      const contents = await this.listDirectory(mount.path, false);
      
      // Update mount status
      mount.isAvailable = true;
      mount.lastChecked = Date.now();
      mount.fileCount = contents.files.length;
      mount.totalSize = contents.totalSize;
      
      this.config.eventBus.emit('mount.available', { mount });
    } catch (error) {
      // Mount is not available
      mount.isAvailable = false;
      mount.lastChecked = Date.now();
      mount.fileCount = undefined;
      mount.totalSize = undefined;
      
      this.config.eventBus.emit('mount.unavailable', { mount, error });
    }
  }

  /**
   * Check all mounts
   */
  private async checkAllMounts() {
    const promises = Array.from(this.mounts.values()).map(mount => 
      this.checkMountAvailability(mount)
    );
    
    await Promise.allSettled(promises);
  }

  /**
   * Get mount for path
   */
  private getMountForPath(path: string): Mount | undefined {
    for (const mount of this.mounts.values()) {
      if (path.startsWith(mount.path)) {
        return mount;
      }
    }
    return undefined;
  }

  /**
   * Match file pattern
   */
  private matchesPattern(filename: string, pattern: string): boolean {
    // Simple pattern matching - convert glob to regex
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    return new RegExp(`^${regex}$`, 'i').test(filename);
  }

  /**
   * Search in path
   */
  private async searchInPath(
    path: string,
    query: string,
    filePatterns: string[],
    maxResults: number
  ): Promise<FileInfo[]> {
    // This would ideally use a Rust API for efficient searching
    // For now, we'll do a simple recursive search
    const results: FileInfo[] = [];
    const queue = [path];
    const queryLower = query.toLowerCase();
    
    while (queue.length > 0 && results.length < maxResults) {
      const currentPath = queue.shift()!;
      
      try {
        const contents = await this.listDirectory(currentPath);
        
        // Check files
        for (const file of contents.files) {
          if (results.length >= maxResults) break;
          
          if (file.name.toLowerCase().includes(queryLower)) {
            // Check if matches file patterns
            const matchesPattern = filePatterns.some(pattern =>
              this.matchesPattern(file.name, pattern)
            );
            
            if (matchesPattern) {
              results.push(file);
            }
          }
        }
        
        // Add subdirectories to queue
        for (const dir of contents.directories) {
          queue.push(dir.path);
        }
      } catch (error) {
        // Skip directories we can't access
        console.warn(`Failed to search in ${currentPath}:`, error);
      }
    }
    
    return results;
  }

  /**
   * Clear mount cache
   */
  private clearMountCache(mountPath: string) {
    // Clear all cache entries that start with mount path
    for (const key of this.directoryCache.keys()) {
      if (key.startsWith(mountPath)) {
        this.directoryCache.delete(key);
      }
    }
  }

  /**
   * Dispose of the service
   */
  dispose() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    this.directoryCache.clear();
  }
}

// Factory function for dependency injection
export function createMountService(config: MountServiceConfig): MountService {
  return new MountService(config);
}
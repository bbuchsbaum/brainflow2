/**
 * VolumeRepository - Repository pattern for volume data access
 * Abstracts the data source and provides a clean interface for volume operations
 */

import type { VolumeHandleInfo } from '@brainflow/api';
import type { EventBus } from '$lib/events/EventBus';

export interface VolumeData {
  id: string;
  handle: VolumeHandleInfo;
  metadata: {
    name: string;
    path: string;
    size: number;
    loadedAt: number;
    lastAccessedAt: number;
  };
}

export interface VolumeQuery {
  id?: string;
  name?: string;
  path?: string;
  loadedAfter?: number;
  loadedBefore?: number;
}

export interface VolumeRepositoryConfig {
  eventBus: EventBus;
  maxVolumes?: number;
}

export interface IVolumeRepository {
  add(volume: VolumeData): Promise<void>;
  update(id: string, updates: Partial<VolumeData>): Promise<void>;
  remove(id: string): Promise<void>;
  findById(id: string): Promise<VolumeData | null>;
  findByPath(path: string): Promise<VolumeData | null>;
  findAll(query?: VolumeQuery): Promise<VolumeData[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

/**
 * In-memory implementation of VolumeRepository
 */
export class InMemoryVolumeRepository implements IVolumeRepository {
  private volumes = new Map<string, VolumeData>();
  private config: VolumeRepositoryConfig;

  constructor(config: VolumeRepositoryConfig) {
    this.config = config;
  }

  async add(volume: VolumeData): Promise<void> {
    // Check max volumes limit
    if (this.config.maxVolumes && this.volumes.size >= this.config.maxVolumes) {
      // Remove oldest volume
      const oldest = await this.findOldestVolume();
      if (oldest) {
        await this.remove(oldest.id);
      }
    }

    this.volumes.set(volume.id, volume);
    this.config.eventBus.emit('repository.volume.added', { volume });
  }

  async update(id: string, updates: Partial<VolumeData>): Promise<void> {
    const volume = this.volumes.get(id);
    if (!volume) {
      throw new Error(`Volume ${id} not found`);
    }

    const updated = {
      ...volume,
      ...updates,
      metadata: {
        ...volume.metadata,
        ...(updates.metadata || {}),
        lastAccessedAt: Date.now()
      }
    };

    this.volumes.set(id, updated);
    this.config.eventBus.emit('repository.volume.updated', { id, updates });
  }

  async remove(id: string): Promise<void> {
    const volume = this.volumes.get(id);
    if (!volume) {
      throw new Error(`Volume ${id} not found`);
    }

    this.volumes.delete(id);
    this.config.eventBus.emit('repository.volume.removed', { id });
  }

  async findById(id: string): Promise<VolumeData | null> {
    const volume = this.volumes.get(id);
    if (volume) {
      // Update last accessed time
      volume.metadata.lastAccessedAt = Date.now();
    }
    return volume || null;
  }

  async findByPath(path: string): Promise<VolumeData | null> {
    for (const volume of this.volumes.values()) {
      if (volume.metadata.path === path) {
        // Update last accessed time
        volume.metadata.lastAccessedAt = Date.now();
        return volume;
      }
    }
    return null;
  }

  async findAll(query?: VolumeQuery): Promise<VolumeData[]> {
    let results = Array.from(this.volumes.values());

    if (query) {
      results = results.filter(volume => {
        if (query.id && volume.id !== query.id) return false;
        if (query.name && !volume.metadata.name.includes(query.name)) return false;
        if (query.path && volume.metadata.path !== query.path) return false;
        if (query.loadedAfter && volume.metadata.loadedAt <= query.loadedAfter) return false;
        if (query.loadedBefore && volume.metadata.loadedAt >= query.loadedBefore) return false;
        return true;
      });
    }

    // Sort by last accessed time (most recent first)
    return results.sort((a, b) => b.metadata.lastAccessedAt - a.metadata.lastAccessedAt);
  }

  async count(): Promise<number> {
    return this.volumes.size;
  }

  async clear(): Promise<void> {
    this.volumes.clear();
    this.config.eventBus.emit('repository.volume.cleared', {});
  }

  private async findOldestVolume(): Promise<VolumeData | null> {
    let oldest: VolumeData | null = null;
    let oldestTime = Infinity;

    for (const volume of this.volumes.values()) {
      if (volume.metadata.lastAccessedAt < oldestTime) {
        oldest = volume;
        oldestTime = volume.metadata.lastAccessedAt;
      }
    }

    return oldest;
  }
}

/**
 * IndexedDB implementation of VolumeRepository
 * For persistent storage across sessions
 */
export class IndexedDBVolumeRepository implements IVolumeRepository {
  private config: VolumeRepositoryConfig;
  private dbName = 'brainflow-volumes';
  private storeName = 'volumes';
  private db: IDBDatabase | null = null;

  constructor(config: VolumeRepositoryConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('path', 'metadata.path', { unique: true });
          store.createIndex('loadedAt', 'metadata.loadedAt', { unique: false });
          store.createIndex('lastAccessedAt', 'metadata.lastAccessedAt', { unique: false });
        }
      };
    });
  }

  private ensureDb(): IDBDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db;
  }

  async add(volume: VolumeData): Promise<void> {
    const db = this.ensureDb();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.add(volume);
      request.onsuccess = () => {
        this.config.eventBus.emit('repository.volume.added', { volume });
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async update(id: string, updates: Partial<VolumeData>): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Volume ${id} not found`);
    }

    const updated = {
      ...existing,
      ...updates,
      metadata: {
        ...existing.metadata,
        ...(updates.metadata || {}),
        lastAccessedAt: Date.now()
      }
    };

    const db = this.ensureDb();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.put(updated);
      request.onsuccess = () => {
        this.config.eventBus.emit('repository.volume.updated', { id, updates });
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async remove(id: string): Promise<void> {
    const db = this.ensureDb();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => {
        this.config.eventBus.emit('repository.volume.removed', { id });
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async findById(id: string): Promise<VolumeData | null> {
    const db = this.ensureDb();
    const transaction = db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const volume = request.result || null;
        if (volume) {
          // Update last accessed time
          this.update(id, {
            metadata: { ...volume.metadata, lastAccessedAt: Date.now() }
          });
        }
        resolve(volume);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async findByPath(path: string): Promise<VolumeData | null> {
    const db = this.ensureDb();
    const transaction = db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);
    const index = store.index('path');

    return new Promise((resolve, reject) => {
      const request = index.get(path);
      request.onsuccess = () => {
        const volume = request.result || null;
        if (volume) {
          // Update last accessed time
          this.update(volume.id, {
            metadata: { ...volume.metadata, lastAccessedAt: Date.now() }
          });
        }
        resolve(volume);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async findAll(query?: VolumeQuery): Promise<VolumeData[]> {
    const db = this.ensureDb();
    const transaction = db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        let results = request.result || [];

        if (query) {
          results = results.filter(volume => {
            if (query.id && volume.id !== query.id) return false;
            if (query.name && !volume.metadata.name.includes(query.name)) return false;
            if (query.path && volume.metadata.path !== query.path) return false;
            if (query.loadedAfter && volume.metadata.loadedAt <= query.loadedAfter) return false;
            if (query.loadedBefore && volume.metadata.loadedAt >= query.loadedBefore) return false;
            return true;
          });
        }

        // Sort by last accessed time (most recent first)
        results.sort((a, b) => b.metadata.lastAccessedAt - a.metadata.lastAccessedAt);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async count(): Promise<number> {
    const db = this.ensureDb();
    const transaction = db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    const db = this.ensureDb();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => {
        this.config.eventBus.emit('repository.volume.cleared', {});
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Factory function to create appropriate repository
export function createVolumeRepository(
  config: VolumeRepositoryConfig,
  persistent = false
): IVolumeRepository {
  if (persistent && typeof indexedDB !== 'undefined') {
    const repo = new IndexedDBVolumeRepository(config);
    // Initialize IndexedDB asynchronously
    repo.init().catch(err => {
      console.error('Failed to initialize IndexedDB:', err);
      // Fall back to in-memory if IndexedDB fails
    });
    return repo;
  }
  
  return new InMemoryVolumeRepository(config);
}
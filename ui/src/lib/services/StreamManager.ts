/**
 * StreamManager - Service for managing data streams and real-time updates
 * Handles WebSocket connections, data streaming, and backpressure
 */

import type { EventBus } from '$lib/events/EventBus';
import type { ValidationService } from '$lib/validation/ValidationService';

export interface StreamManagerConfig {
  eventBus: EventBus;
  validator: ValidationService;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

export interface StreamConfig {
  id: string;
  url: string;
  protocol?: string;
  reconnect?: boolean;
  bufferSize?: number;
  compression?: boolean;
}

export interface StreamMessage {
  streamId: string;
  type: string;
  data: any;
  timestamp: number;
  sequence: number;
}

export interface StreamStats {
  messagesReceived: number;
  bytesSent: number;
  bytesReceived: number;
  connectionTime: number;
  lastMessageTime: number;
  bufferSize: number;
  droppedMessages: number;
}

interface Stream {
  config: StreamConfig;
  socket: WebSocket | null;
  state: 'connecting' | 'connected' | 'disconnected' | 'error';
  stats: StreamStats;
  buffer: StreamMessage[];
  sequence: number;
  reconnectAttempts: number;
  reconnectTimeout?: number;
  subscribers: Set<(message: StreamMessage) => void>;
}

export class StreamManager {
  private config: StreamManagerConfig;
  private streams = new Map<string, Stream>();
  private maxReconnectAttempts: number;
  private reconnectDelay: number;

  constructor(config: StreamManagerConfig) {
    this.config = config;
    this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
    this.reconnectDelay = config.reconnectDelay || 1000;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Handle app visibility changes
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.reconnectAll();
        }
      });
    }

    // Handle online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.reconnectAll());
      window.addEventListener('offline', () => this.pauseAll());
    }
  }

  /**
   * Connect to a stream
   */
  async connect(config: StreamConfig): Promise<void> {
    try {
      // Validate configuration
      const validConfig = this.validateStreamConfig(config);
      
      // Check if already connected
      if (this.streams.has(validConfig.id)) {
        throw new Error(`Stream ${validConfig.id} already connected`);
      }
      
      // Create stream
      const stream: Stream = {
        config: validConfig,
        socket: null,
        state: 'connecting',
        stats: {
          messagesReceived: 0,
          bytesSent: 0,
          bytesReceived: 0,
          connectionTime: Date.now(),
          lastMessageTime: 0,
          bufferSize: 0,
          droppedMessages: 0
        },
        buffer: [],
        sequence: 0,
        reconnectAttempts: 0,
        subscribers: new Set()
      };
      
      this.streams.set(validConfig.id, stream);
      
      // Connect
      await this.connectStream(stream);
      
      this.config.eventBus.emit('stream.connected', { streamId: validConfig.id });
    } catch (error) {
      this.config.eventBus.emit('stream.connect.failed', { config, error });
      throw error;
    }
  }

  /**
   * Disconnect from a stream
   */
  async disconnect(streamId: string): Promise<void> {
    const stream = this.streams.get(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }
    
    // Clear reconnect timeout
    if (stream.reconnectTimeout) {
      clearTimeout(stream.reconnectTimeout);
    }
    
    // Close socket
    if (stream.socket) {
      stream.socket.close(1000, 'User requested disconnect');
    }
    
    // Remove stream
    this.streams.delete(streamId);
    
    this.config.eventBus.emit('stream.disconnected', { streamId });
  }

  /**
   * Send data to a stream
   */
  async send(streamId: string, type: string, data: any): Promise<void> {
    const stream = this.streams.get(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }
    
    if (stream.state !== 'connected' || !stream.socket) {
      throw new Error(`Stream ${streamId} is not connected`);
    }
    
    try {
      const message = {
        type,
        data,
        timestamp: Date.now(),
        sequence: ++stream.sequence
      };
      
      const payload = JSON.stringify(message);
      stream.socket.send(payload);
      
      stream.stats.bytesSent += payload.length;
      
      this.config.eventBus.emit('stream.message.sent', {
        streamId,
        message
      });
    } catch (error) {
      this.config.eventBus.emit('stream.send.failed', {
        streamId,
        type,
        data,
        error
      });
      throw error;
    }
  }

  /**
   * Subscribe to stream messages
   */
  subscribe(
    streamId: string,
    callback: (message: StreamMessage) => void
  ): () => void {
    const stream = this.streams.get(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }
    
    stream.subscribers.add(callback);
    
    // Process buffered messages
    if (stream.buffer.length > 0) {
      stream.buffer.forEach(message => callback(message));
      stream.buffer = [];
    }
    
    // Return unsubscribe function
    return () => {
      stream.subscribers.delete(callback);
    };
  }

  /**
   * Get stream status
   */
  getStreamStatus(streamId: string): {
    state: string;
    stats: StreamStats;
  } | null {
    const stream = this.streams.get(streamId);
    if (!stream) return null;
    
    return {
      state: stream.state,
      stats: { ...stream.stats }
    };
  }

  /**
   * Get all streams
   */
  getAllStreams(): Array<{
    id: string;
    state: string;
    stats: StreamStats;
  }> {
    return Array.from(this.streams.entries()).map(([id, stream]) => ({
      id,
      state: stream.state,
      stats: { ...stream.stats }
    }));
  }

  /**
   * Private methods
   */
  private async connectStream(stream: Stream): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const socket = new WebSocket(stream.config.url, stream.config.protocol);
        
        socket.onopen = () => {
          stream.socket = socket;
          stream.state = 'connected';
          stream.reconnectAttempts = 0;
          stream.stats.connectionTime = Date.now();
          
          this.config.eventBus.emit('stream.state.changed', {
            streamId: stream.config.id,
            state: 'connected'
          });
          
          resolve();
        };
        
        socket.onclose = (event) => {
          stream.state = 'disconnected';
          stream.socket = null;
          
          this.config.eventBus.emit('stream.state.changed', {
            streamId: stream.config.id,
            state: 'disconnected',
            code: event.code,
            reason: event.reason
          });
          
          // Attempt reconnect if configured
          if (stream.config.reconnect && stream.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect(stream);
          }
        };
        
        socket.onerror = (error) => {
          stream.state = 'error';
          
          this.config.eventBus.emit('stream.error', {
            streamId: stream.config.id,
            error
          });
          
          if (!stream.socket) {
            reject(new Error('Failed to connect'));
          }
        };
        
        socket.onmessage = (event) => {
          this.handleMessage(stream, event.data);
        };
        
      } catch (error) {
        stream.state = 'error';
        reject(error);
      }
    });
  }

  private handleMessage(stream: Stream, rawData: any) {
    try {
      // Parse message
      let data: any;
      if (typeof rawData === 'string') {
        data = JSON.parse(rawData);
        stream.stats.bytesReceived += rawData.length;
      } else if (rawData instanceof Blob) {
        // Handle binary data
        rawData.arrayBuffer().then(buffer => {
          stream.stats.bytesReceived += buffer.byteLength;
          this.processBinaryMessage(stream, buffer);
        });
        return;
      }
      
      // Create stream message
      const message: StreamMessage = {
        streamId: stream.config.id,
        type: data.type || 'data',
        data: data.data || data,
        timestamp: data.timestamp || Date.now(),
        sequence: data.sequence || ++stream.sequence
      };
      
      stream.stats.messagesReceived++;
      stream.stats.lastMessageTime = Date.now();
      
      // Handle backpressure
      if (stream.subscribers.size === 0) {
        // Buffer messages if no subscribers
        if (stream.config.bufferSize && stream.buffer.length >= stream.config.bufferSize) {
          stream.stats.droppedMessages++;
          stream.buffer.shift(); // Drop oldest
        }
        stream.buffer.push(message);
        stream.stats.bufferSize = stream.buffer.length;
      } else {
        // Deliver to subscribers
        stream.subscribers.forEach(callback => {
          try {
            callback(message);
          } catch (error) {
            console.error('Stream subscriber error:', error);
          }
        });
      }
      
      this.config.eventBus.emit('stream.message.received', message);
      
    } catch (error) {
      this.config.eventBus.emit('stream.message.error', {
        streamId: stream.config.id,
        error
      });
    }
  }

  private processBinaryMessage(stream: Stream, buffer: ArrayBuffer) {
    // Handle binary messages (e.g., for efficient data transfer)
    const message: StreamMessage = {
      streamId: stream.config.id,
      type: 'binary',
      data: buffer,
      timestamp: Date.now(),
      sequence: ++stream.sequence
    };
    
    stream.stats.messagesReceived++;
    stream.stats.lastMessageTime = Date.now();
    
    // Deliver to subscribers
    stream.subscribers.forEach(callback => {
      try {
        callback(message);
      } catch (error) {
        console.error('Stream subscriber error:', error);
      }
    });
  }

  private scheduleReconnect(stream: Stream) {
    stream.reconnectAttempts++;
    
    const delay = this.reconnectDelay * Math.pow(2, stream.reconnectAttempts - 1);
    
    this.config.eventBus.emit('stream.reconnecting', {
      streamId: stream.config.id,
      attempt: stream.reconnectAttempts,
      delay
    });
    
    stream.reconnectTimeout = window.setTimeout(() => {
      this.connectStream(stream).catch(error => {
        console.error('Reconnect failed:', error);
      });
    }, delay);
  }

  private validateStreamConfig(config: StreamConfig): StreamConfig {
    // Validate URL
    try {
      new URL(config.url);
    } catch {
      throw new Error('Invalid stream URL');
    }
    
    // Set defaults
    return {
      ...config,
      reconnect: config.reconnect ?? true,
      bufferSize: config.bufferSize ?? 100,
      compression: config.compression ?? false
    };
  }

  private reconnectAll() {
    for (const stream of this.streams.values()) {
      if (stream.state === 'disconnected' && stream.config.reconnect) {
        this.connectStream(stream).catch(error => {
          console.error(`Failed to reconnect stream ${stream.config.id}:`, error);
        });
      }
    }
  }

  private pauseAll() {
    for (const stream of this.streams.values()) {
      if (stream.socket && stream.state === 'connected') {
        stream.socket.close(1001, 'Going offline');
      }
    }
  }

  /**
   * Dispose of the service
   */
  dispose() {
    // Disconnect all streams
    for (const streamId of this.streams.keys()) {
      this.disconnect(streamId).catch(error => {
        console.error(`Error disconnecting stream ${streamId}:`, error);
      });
    }
    
    this.streams.clear();
  }
}

// Factory function for dependency injection
export function createStreamManager(config: StreamManagerConfig): StreamManager {
  return new StreamManager(config);
}
/**
 * Plugin Message Bus
 * Enables secure communication between plugins while maintaining isolation
 */

import type { EventBus } from '$lib/events/EventBus';
import type {
	PluginMessageBus as IPluginMessageBus,
	MessageHandler,
	MessageMetadata,
	PrivateChannel,
	Unsubscribe
} from './types';

export class PluginMessageBus implements IPluginMessageBus {
	private eventBus: EventBus;
	private subscriptions = new Map<string, Map<string, MessageHandler[]>>();
	private privateChannels = new Map<string, Map<string, MessageHandler[]>>();
	private publicChannels = new Set<string>();
	private pluginPermissions = new Map<string, Set<string>>();
	private isShuttingDown = false;

	constructor(eventBus: EventBus) {
		this.eventBus = eventBus;
	}

	/**
	 * Publish a message to a public channel
	 */
	async publish(channel: string, data: any): Promise<void> {
		if (this.isShuttingDown) {
			throw new Error('Message bus is shutting down');
		}

		if (!this.isValidChannel(channel)) {
			throw new Error(`Invalid channel name: ${channel}`);
		}

		// Mark as public channel
		this.publicChannels.add(channel);

		const metadata: MessageMetadata = {
			senderId: 'system', // Will be set by plugin interface
			timestamp: new Date(),
			channel
		};

		// Get all subscribers for this channel
		const channelSubscriptions = this.subscriptions.get(channel);
		if (channelSubscriptions) {
			for (const [pluginId, handlers] of channelSubscriptions) {
				// Check if plugin has permission to receive on this channel
				if (this.hasPermission(pluginId, channel, 'receive')) {
					for (const handler of handlers) {
						try {
							handler(data, { ...metadata, senderId: 'system' });
						} catch (error) {
							console.error(`Error in message handler for plugin ${pluginId}:`, error);
						}
					}
				}
			}
		}

		// Also emit on the main event bus for system components
		this.eventBus.emit('plugin.message' as any, {
			channel,
			data,
			metadata
		});
	}

	/**
	 * Subscribe to a public channel
	 */
	subscribe(channel: string, handler: MessageHandler): Unsubscribe {
		if (this.isShuttingDown) {
			throw new Error('Message bus is shutting down');
		}

		if (!this.isValidChannel(channel)) {
			throw new Error(`Invalid channel name: ${channel}`);
		}

		const pluginId = 'system'; // Will be set by plugin interface
		return this.addSubscription(pluginId, channel, handler);
	}

	/**
	 * Create a private channel for a plugin
	 */
	createPrivateChannel(pluginId: string): PrivateChannel {
		return new PluginPrivateChannel(this, pluginId);
	}

	/**
	 * Get list of public channels
	 */
	getPublicChannels(): string[] {
		return Array.from(this.publicChannels);
	}

	/**
	 * Create a plugin-specific interface
	 */
	createPluginInterface(pluginId: string): IPluginMessageBus {
		return new PluginMessageBusInterface(this, pluginId);
	}

	/**
	 * Set permissions for a plugin
	 */
	setPluginPermissions(pluginId: string, channels: string[]): void {
		this.pluginPermissions.set(pluginId, new Set(channels));
	}

	/**
	 * Remove all subscriptions for a plugin
	 */
	unsubscribeAll(pluginId: string, channel?: string): void {
		if (channel) {
			// Unsubscribe from specific channel
			const channelSubscriptions = this.subscriptions.get(channel);
			if (channelSubscriptions) {
				channelSubscriptions.delete(pluginId);
				if (channelSubscriptions.size === 0) {
					this.subscriptions.delete(channel);
				}
			}

			// Also check private channels
			const privateChannelSubs = this.privateChannels.get(channel);
			if (privateChannelSubs) {
				privateChannelSubs.delete(pluginId);
				if (privateChannelSubs.size === 0) {
					this.privateChannels.delete(channel);
				}
			}
		} else {
			// Unsubscribe from all channels
			for (const [channelName, channelSubs] of this.subscriptions) {
				channelSubs.delete(pluginId);
				if (channelSubs.size === 0) {
					this.subscriptions.delete(channelName);
				}
			}

			for (const [channelName, channelSubs] of this.privateChannels) {
				channelSubs.delete(pluginId);
				if (channelSubs.size === 0) {
					this.privateChannels.delete(channelName);
				}
			}
		}
	}

	/**
	 * Shutdown the message bus
	 */
	shutdown(): void {
		this.isShuttingDown = true;
		this.subscriptions.clear();
		this.privateChannels.clear();
		this.publicChannels.clear();
		this.pluginPermissions.clear();
	}

	// Internal methods

	private addSubscription(pluginId: string, channel: string, handler: MessageHandler): Unsubscribe {
		let channelSubscriptions = this.subscriptions.get(channel);
		if (!channelSubscriptions) {
			channelSubscriptions = new Map();
			this.subscriptions.set(channel, channelSubscriptions);
		}

		let pluginHandlers = channelSubscriptions.get(pluginId);
		if (!pluginHandlers) {
			pluginHandlers = [];
			channelSubscriptions.set(pluginId, pluginHandlers);
		}

		pluginHandlers.push(handler);

		// Return unsubscribe function
		return () => {
			const index = pluginHandlers!.indexOf(handler);
			if (index >= 0) {
				pluginHandlers!.splice(index, 1);

				// Cleanup empty arrays and maps
				if (pluginHandlers!.length === 0) {
					channelSubscriptions!.delete(pluginId);
					if (channelSubscriptions!.size === 0) {
						this.subscriptions.delete(channel);
					}
				}
			}
		};
	}

	private sendPrivateMessage(
		fromPluginId: string,
		toPluginId: string,
		data: any,
		channel: string
	): void {
		const privateChannelKey = `${fromPluginId}->${toPluginId}`;
		const channelSubscriptions = this.privateChannels.get(privateChannelKey);

		if (channelSubscriptions) {
			const handlers = channelSubscriptions.get(toPluginId);
			if (handlers) {
				const metadata: MessageMetadata = {
					senderId: fromPluginId,
					timestamp: new Date(),
					channel
				};

				for (const handler of handlers) {
					try {
						handler(data, metadata);
					} catch (error) {
						console.error(`Error in private message handler for plugin ${toPluginId}:`, error);
					}
				}
			}
		}
	}

	private addPrivateSubscription(
		pluginId: string,
		fromPluginId: string,
		handler: MessageHandler
	): Unsubscribe {
		const privateChannelKey = `${fromPluginId}->${pluginId}`;
		let channelSubscriptions = this.privateChannels.get(privateChannelKey);
		if (!channelSubscriptions) {
			channelSubscriptions = new Map();
			this.privateChannels.set(privateChannelKey, channelSubscriptions);
		}

		let pluginHandlers = channelSubscriptions.get(pluginId);
		if (!pluginHandlers) {
			pluginHandlers = [];
			channelSubscriptions.set(pluginId, pluginHandlers);
		}

		pluginHandlers.push(handler);

		return () => {
			const index = pluginHandlers!.indexOf(handler);
			if (index >= 0) {
				pluginHandlers!.splice(index, 1);

				if (pluginHandlers!.length === 0) {
					channelSubscriptions!.delete(pluginId);
					if (channelSubscriptions!.size === 0) {
						this.privateChannels.delete(privateChannelKey);
					}
				}
			}
		};
	}

	private hasPermission(pluginId: string, channel: string, action: 'send' | 'receive'): boolean {
		const permissions = this.pluginPermissions.get(pluginId);
		if (!permissions) {
			return true; // Default to allowing all channels if no permissions set
		}

		return permissions.has(channel) || permissions.has('*');
	}

	private isValidChannel(channel: string): boolean {
		// Channel names must be alphanumeric with dots, hyphens, and underscores
		return /^[a-zA-Z0-9._-]+$/.test(channel) && channel.length <= 100;
	}
}

/**
 * Plugin-specific message bus interface
 * Provides scoped access to message bus functionality
 */
class PluginMessageBusInterface implements IPluginMessageBus {
	constructor(
		private messageBus: PluginMessageBus,
		private pluginId: string
	) {}

	async publish(channel: string, data: any): Promise<void> {
		// Check permissions
		if (!this.messageBus['hasPermission'](this.pluginId, channel, 'send')) {
			throw new Error(
				`Plugin ${this.pluginId} does not have permission to send on channel ${channel}`
			);
		}

		return this.messageBus.publish(channel, data);
	}

	subscribe(channel: string, handler: MessageHandler): Unsubscribe {
		// Check permissions
		if (!this.messageBus['hasPermission'](this.pluginId, channel, 'receive')) {
			throw new Error(
				`Plugin ${this.pluginId} does not have permission to receive on channel ${channel}`
			);
		}

		return this.messageBus['addSubscription'](this.pluginId, channel, handler);
	}

	createPrivateChannel(targetPluginId: string): PrivateChannel {
		return new PluginPrivateChannel(this.messageBus, this.pluginId, targetPluginId);
	}

	getPublicChannels(): string[] {
		return this.messageBus.getPublicChannels();
	}
}

/**
 * Private channel implementation
 */
class PluginPrivateChannel implements PrivateChannel {
	constructor(
		private messageBus: PluginMessageBus,
		private pluginId: string,
		private targetPluginId?: string
	) {}

	async send(targetPluginId: string, data: any): Promise<void> {
		const target = this.targetPluginId || targetPluginId;
		this.messageBus['sendPrivateMessage'](this.pluginId, target, data, 'private');
	}

	onReceive(handler: MessageHandler): Unsubscribe {
		if (!this.targetPluginId) {
			throw new Error('Cannot receive on a multi-target private channel');
		}

		return this.messageBus['addPrivateSubscription'](this.pluginId, this.targetPluginId, handler);
	}
}

// Message validation utilities
export function sanitizeMessage(data: any): any {
	// Remove functions and other unsafe content
	return JSON.parse(JSON.stringify(data));
}

export function validateChannelName(channel: string): boolean {
	return /^[a-zA-Z0-9._-]+$/.test(channel) && channel.length <= 100;
}

// Common channel constants
export const PLUGIN_CHANNELS = {
	SYSTEM: 'system',
	DATA: 'data',
	UI: 'ui',
	EVENTS: 'events',
	ERRORS: 'errors'
} as const;

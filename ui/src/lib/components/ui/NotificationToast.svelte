<!--
  NotificationToast Component
  Displays notifications from the NotificationService
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { getService } from '$lib/di/Container';
  import { getEventBus } from '$lib/events/EventBus';
  import type { Notification, NotificationService } from '$lib/services/NotificationService';
  import { AlertCircle, CheckCircle, Info, XCircle, X } from 'lucide-svelte';
  
  // State
  let notifications = $state<Notification[]>([]);
  let notificationService: NotificationService | null = null;
  const eventBus = getEventBus();
  
  // Icon mapping
  const icons = {
    info: Info,
    success: CheckCircle,
    warning: AlertCircle,
    error: XCircle
  };
  
  // Color mapping
  const colors = {
    info: 'bg-blue-500',
    success: 'bg-green-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500'
  };
  
  onMount(async () => {
    // Get notification service
    notificationService = await getService<NotificationService>('notificationService');
    
    // Get initial notifications
    if (notificationService) {
      notifications = notificationService.getActiveNotifications();
    }
    
    // Subscribe to notification events
    const unsubscribes = [
      eventBus.on('notification.show', (notification: Notification) => {
        notifications = [...notifications, notification];
      }),
      
      eventBus.on('notification.update', (notification: Notification) => {
        notifications = notifications.map(n => 
          n.id === notification.id ? notification : n
        );
      }),
      
      eventBus.on('notification.dismiss', ({ id }) => {
        notifications = notifications.filter(n => n.id !== id);
      })
    ];
    
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  });
  
  function dismiss(id: string) {
    notificationService?.dismiss(id);
  }
  
  function handleAction(notification: Notification) {
    if (notification.action) {
      notification.action.handler();
      dismiss(notification.id);
    }
  }
</script>

<div class="notification-container">
  {#each notifications as notification (notification.id)}
    <div
      class="notification notification-{notification.type}"
      in:fly={{ x: 300, duration: 300 }}
      out:fade={{ duration: 200 }}
    >
      <div class="notification-icon {colors[notification.type]}">
        <svelte:component 
          this={icons[notification.type]} 
          size={20} 
          color="white"
        />
      </div>
      
      <div class="notification-content">
        <div class="notification-title">
          {notification.title}
        </div>
        
        {#if notification.message}
          <div class="notification-message">
            {notification.message}
          </div>
        {/if}
        
        {#if notification.progress}
          <div class="notification-progress">
            {#if notification.progress.indeterminate}
              <div class="progress-bar indeterminate" />
            {:else}
              <div 
                class="progress-bar"
                style:width="{notification.progress.value}%"
              />
            {/if}
          </div>
        {/if}
        
        {#if notification.action}
          <button
            class="notification-action"
            onclick={() => handleAction(notification)}
          >
            {notification.action.label}
          </button>
        {/if}
      </div>
      
      {#if notification.duration !== 0}
        <button
          class="notification-close"
          onclick={() => dismiss(notification.id)}
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .notification-container {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 24rem;
    pointer-events: none;
  }
  
  .notification {
    display: flex;
    align-items: flex-start;
    background: white;
    border-radius: 0.5rem;
    box-shadow: 
      0 10px 15px -3px rgba(0, 0, 0, 0.1),
      0 4px 6px -2px rgba(0, 0, 0, 0.05);
    padding: 1rem;
    pointer-events: auto;
    position: relative;
    min-width: 20rem;
  }
  
  :global(.dark) .notification {
    background: #1f2937;
    box-shadow: 
      0 10px 15px -3px rgba(0, 0, 0, 0.3),
      0 4px 6px -2px rgba(0, 0, 0, 0.2);
  }
  
  .notification-icon {
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 0.75rem;
  }
  
  .notification-content {
    flex: 1;
    min-width: 0;
  }
  
  .notification-title {
    font-weight: 600;
    font-size: 0.875rem;
    line-height: 1.25rem;
    color: #111827;
    margin-bottom: 0.125rem;
  }
  
  :global(.dark) .notification-title {
    color: #f3f4f6;
  }
  
  .notification-message {
    font-size: 0.875rem;
    line-height: 1.25rem;
    color: #6b7280;
    margin-bottom: 0.5rem;
  }
  
  :global(.dark) .notification-message {
    color: #9ca3af;
  }
  
  .notification-progress {
    height: 0.25rem;
    background: #e5e7eb;
    border-radius: 0.125rem;
    overflow: hidden;
    margin: 0.5rem 0;
  }
  
  :global(.dark) .notification-progress {
    background: #374151;
  }
  
  .progress-bar {
    height: 100%;
    background: #3b82f6;
    transition: width 0.3s ease;
  }
  
  .progress-bar.indeterminate {
    width: 30%;
    animation: indeterminate 1.5s infinite;
  }
  
  @keyframes indeterminate {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(400%);
    }
  }
  
  .notification-action {
    font-size: 0.875rem;
    font-weight: 500;
    color: #3b82f6;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
  }
  
  .notification-action:hover {
    color: #2563eb;
  }
  
  .notification-close {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: none;
    border: none;
    padding: 0.25rem;
    cursor: pointer;
    color: #6b7280;
    border-radius: 0.25rem;
    transition: all 0.15s;
  }
  
  .notification-close:hover {
    background: #f3f4f6;
    color: #111827;
  }
  
  :global(.dark) .notification-close:hover {
    background: #374151;
    color: #f3f4f6;
  }
  
  /* Type-specific borders */
  .notification-info {
    border-left: 4px solid #3b82f6;
  }
  
  .notification-success {
    border-left: 4px solid #10b981;
  }
  
  .notification-warning {
    border-left: 4px solid #f59e0b;
  }
  
  .notification-error {
    border-left: 4px solid #ef4444;
  }
</style>
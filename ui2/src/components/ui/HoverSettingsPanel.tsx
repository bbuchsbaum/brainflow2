/**
 * HoverSettingsPanel
 *
 * Settings panel for configuring hover information display.
 * Can be used in a popover, dialog, or settings page.
 */

import React from 'react';
import { useHoverSettingsStore } from '@/stores/hoverSettingsStore';
import { hoverInfoService } from '@/services/HoverInfoService';

export function HoverSettingsPanel() {
  const {
    enabled,
    enabledProviders,
    showInTooltip,
    showInStatusBar,
    throttleMs,
    setEnabled,
    toggleProvider,
    setShowInTooltip,
    setShowInStatusBar,
    setThrottleMs,
  } = useHoverSettingsStore();

  const providers = hoverInfoService.getProviderInfo();

  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="font-medium text-foreground">Hover Information</div>

      {/* Master toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-border bg-muted text-primary focus:ring-ring"
        />
        <span className="text-foreground">Enable hover information</span>
      </label>

      {/* Provider toggles */}
      {enabled && (
        <>
          <div className="border-t border-border pt-3">
            <div className="text-xs text-muted-foreground mb-2">Providers</div>
            <div className="space-y-2">
              {providers.map((provider) => (
                <label
                  key={provider.id}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={enabledProviders.includes(provider.id)}
                    onChange={() => toggleProvider(provider.id)}
                    className="rounded border-border bg-muted text-primary focus:ring-ring"
                  />
                  <span className="text-foreground">{provider.displayName}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Display targets */}
          <div className="border-t border-border pt-3">
            <div className="text-xs text-muted-foreground mb-2">Show in</div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInTooltip}
                  onChange={(e) => setShowInTooltip(e.target.checked)}
                  className="rounded border-border bg-muted text-primary focus:ring-ring"
                />
                <span className="text-foreground">Tooltip</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInStatusBar}
                  onChange={(e) => setShowInStatusBar(e.target.checked)}
                  className="rounded border-border bg-muted text-primary focus:ring-ring"
                />
                <span className="text-foreground">Status Bar</span>
              </label>
            </div>
          </div>

          {/* Performance */}
          <div className="border-t border-border pt-3">
            <div className="text-xs text-muted-foreground mb-2">Update rate</div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={10}
                max={200}
                step={10}
                value={throttleMs}
                onChange={(e) => setThrottleMs(Number(e.target.value))}
                className="flex-1 h-1 bg-muted rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-muted-foreground text-xs w-12 text-right">
                {throttleMs}ms
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Lower = smoother, higher CPU
            </div>
          </div>
        </>
      )}
    </div>
  );
}

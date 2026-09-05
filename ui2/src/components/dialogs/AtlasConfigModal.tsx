/**
 * AtlasConfigModal - Modal for configuring atlas loading parameters
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { AtlasService } from '@/services/AtlasService';
import { Button } from '@/components/ui/shadcn/button';
import { Modal } from '@/components/ui/Modal';
import type {
  AtlasCatalogEntry,
  AtlasConfig,
  AtlasLoadResult,
  SpaceInfo,
  ResolutionInfo,
} from '@/types/atlas';
import { getDataTypeDisplayName } from '@/types/atlas';

interface AtlasConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  atlas: AtlasCatalogEntry;
  onLoad?: () => void; // Callback to refresh data after loading
}

export const AtlasConfigModal: React.FC<AtlasConfigModalProps> = ({
  isOpen,
  onClose,
  atlas,
  onLoad,
}) => {
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  // Configuration state
  const [config, setConfig] = useState<AtlasConfig>({
    atlas_id: atlas.id,
    space: atlas.allowed_spaces[0]?.id || '',
    resolution: atlas.resolutions[0]?.value || '',
    networks: atlas.network_options?.[0],
    parcels: atlas.parcel_options?.[0],
  });

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [loadResult, setLoadResult] = useState<AtlasLoadResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Cancellation token ref to handle component unmounting and operation cancellation
  const cancelTokenRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Safe state setter that checks if component is still mounted
  const safeSetState = useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: NoInfer<React.SetStateAction<T>>) => {
    if (isMountedRef.current) {
      setter(value);
    }
  }, []);

  // Component lifecycle management
  useEffect(() => {
    if (isOpen) {
      isMountedRef.current = true;
      // Cancel any existing operations when modal opens
      if (cancelTokenRef.current) {
        cancelTokenRef.current.abort();
      }
    }

    return () => {
      isMountedRef.current = false;
      if (cancelTokenRef.current) {
        cancelTokenRef.current.abort();
      }
    };
  }, [isOpen]);

  // Reset state when atlas changes
  useEffect(() => {
    if (isOpen) {
      setConfig({
        atlas_id: atlas.id,
        space: atlas.allowed_spaces[0]?.id || '',
        resolution: atlas.resolutions[0]?.value || '',
        networks: atlas.network_options?.[0],
        parcels: atlas.parcel_options?.[0],
      });
      setLoadResult(null);
      setValidationError(null);
    }
  }, [atlas, isOpen]);

  // Validate configuration when it changes
  useEffect(() => {
    if (isOpen && config.atlas_id) {
      validateConfiguration();
    }
  }, [config, isOpen]);

  const validateConfiguration = async () => {
    // Create new cancellation token for this operation
    if (cancelTokenRef.current) {
      cancelTokenRef.current.abort();
    }
    cancelTokenRef.current = new AbortController();
    const currentToken = cancelTokenRef.current;

    try {
      safeSetState(setValidationError, null);
      const isValid = await AtlasService.validateConfig(config, currentToken.signal);
      
      // Check if component is still mounted and operation wasn't cancelled
      if (!currentToken.signal.aborted && isMountedRef.current) {
        if (!isValid) {
          safeSetState(setValidationError, 'Invalid configuration');
        }
      }
    } catch (error) {
      // Only update error state if not cancelled and component is mounted
      if (!currentToken.signal.aborted && isMountedRef.current) {
        const errorMessage = error instanceof Error ? error.message : 'Validation failed';
        safeSetState(setValidationError, errorMessage);
      }
    }
  };

  const handleLoadAtlas = async () => {
    // Create new cancellation token for this operation
    if (cancelTokenRef.current) {
      cancelTokenRef.current.abort();
    }
    cancelTokenRef.current = new AbortController();
    const currentToken = cancelTokenRef.current;

    try {
      safeSetState(setIsLoading, true);
      safeSetState(setLoadResult, null);
      
      const { result } = await AtlasService.loadAtlasAndCreateLayer(config, currentToken.signal);
      
      // Check if component is still mounted and operation wasn't cancelled
      if (!currentToken.signal.aborted && isMountedRef.current) {
        safeSetState(setLoadResult, result);
        
        if (result.success && onLoad) {
          // Refresh atlas data in the parent component
          onLoad();
        }
      }
    } catch (error) {
      // Only update error state if not cancelled and component is mounted
      if (!currentToken.signal.aborted && isMountedRef.current) {
        safeSetState(setLoadResult, {
          success: false,
          error_message: error instanceof Error ? error.message : 'Failed to load atlas',
        });
      }
    } finally {
      // Only update loading state if not cancelled and component is mounted
      if (!currentToken.signal.aborted && isMountedRef.current) {
        safeSetState(setIsLoading, false);
      }
    }
  };

  const getSpaceInfo = (spaceId: string): SpaceInfo | undefined => {
    return atlas.allowed_spaces.find(space => space.id === spaceId);
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeButtonDisabled={isLoading}
      closeOnEscape={!isLoading}
      closeOnOverlayClick={!isLoading}
      title={atlas.name}
      ariaLabel={`${atlas.name} atlas configuration`}
      size="xl"
      initialFocusRef={firstFieldRef}
      bodyClassName="p-0"
      className="max-w-2xl"
    >
      <div className="max-h-[90vh] overflow-y-auto">
        <div className="space-y-6 p-6">
          <div>
            <p className="text-sm mt-1" style={{ color: 'var(--app-text-secondary)' }}>
              Configure atlas loading parameters
            </p>
          </div>

          {/* Atlas Information */}
          <div 
            className="rounded-lg p-4"
            style={{ backgroundColor: 'var(--app-bg-tertiary)', border: '1px solid var(--app-border)' }}
          >
            <h3 className="font-medium mb-2" style={{ color: 'var(--app-text-primary)' }}>Atlas Information</h3>
            <div className="text-sm space-y-1" style={{ color: 'var(--app-text-secondary)' }}>
              <p>{atlas.description}</p>
              {atlas.citation && (
                <div 
                  className="mt-2 p-2 rounded border-l-4"
                  style={{ 
                    backgroundColor: 'rgba(59, 130, 246, 0.1)', 
                    borderLeftColor: 'var(--app-accent)' 
                  }}
                >
                  <p className="text-xs" style={{ color: 'var(--app-accent)' }}>
                    <strong>Citation:</strong> {atlas.citation}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Configuration Options */}
          <div className="space-y-4">
            <h3 className="font-medium" style={{ color: 'var(--app-text-primary)' }}>Configuration</h3>

            {/* Space Selection */}
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--app-text-primary)' }}>
                Space/Template
              </label>
              <select
                ref={firstFieldRef}
                value={config.space}
                onChange={(e) => setConfig(prev => ({ ...prev, space: e.target.value }))}
                className="w-full rounded-md px-3 py-2 text-sm"
                style={{
                  backgroundColor: 'var(--app-bg-tertiary)',
                  border: '1px solid var(--app-border)',
                  color: 'var(--app-text-primary)',
                }}
              >
                {atlas.allowed_spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name} ({getDataTypeDisplayName(space.data_type)})
                  </option>
                ))}
              </select>
              {getSpaceInfo(config.space)?.description && (
                <p className="text-xs mt-1" style={{ color: 'var(--app-text-secondary)' }}>
                  {getSpaceInfo(config.space)?.description}
                </p>
              )}
            </div>

            {/* Resolution Selection */}
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--app-text-primary)' }}>
                Resolution
              </label>
              <select
                value={config.resolution}
                onChange={(e) => setConfig(prev => ({ ...prev, resolution: e.target.value }))}
                className="w-full rounded-md px-3 py-2 text-sm"
                style={{
                  backgroundColor: 'var(--app-bg-tertiary)',
                  border: '1px solid var(--app-border)',
                  color: 'var(--app-text-primary)',
                }}
              >
                {atlas.resolutions.map((resolution) => (
                  <option key={resolution.value} value={resolution.value}>
                    {resolution.value} - {resolution.description}
                  </option>
                ))}
              </select>
            </div>

            {/* Schaefer-specific options */}
            {atlas.id === 'schaefer2018' && (
              <>
                {/* Networks */}
                {atlas.network_options && (
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--app-text-primary)' }}>
                      Networks
                    </label>
                    <select
                      value={config.networks || ''}
                      onChange={(e) => setConfig(prev => ({ 
                        ...prev, 
                        networks: e.target.value ? parseInt(e.target.value) : undefined 
                      }))}
                      className="w-full rounded-md px-3 py-2 text-sm"
                      style={{
                        backgroundColor: 'var(--app-bg-tertiary)',
                        border: '1px solid var(--app-border)',
                        color: 'var(--app-text-primary)',
                      }}
                    >
                      {atlas.network_options.map((networks) => (
                        <option key={networks} value={networks}>
                          {networks} networks
                        </option>
                      ))}
                    </select>
                    <p className="text-xs mt-1" style={{ color: 'var(--app-text-secondary)' }}>
                      Number of functional networks to use for parcellation
                    </p>
                  </div>
                )}

                {/* Parcels */}
                {atlas.parcel_options && (
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--app-text-primary)' }}>
                      Parcels
                    </label>
                    <select
                      value={config.parcels || ''}
                      onChange={(e) => setConfig(prev => ({ 
                        ...prev, 
                        parcels: e.target.value ? parseInt(e.target.value) : undefined 
                      }))}
                      className="w-full rounded-md px-3 py-2 text-sm"
                      style={{
                        backgroundColor: 'var(--app-bg-tertiary)',
                        border: '1px solid var(--app-border)',
                        color: 'var(--app-text-primary)',
                      }}
                    >
                      {atlas.parcel_options.map((parcels) => (
                        <option key={parcels} value={parcels}>
                          {parcels} parcels
                        </option>
                      ))}
                    </select>
                    <p className="text-xs mt-1" style={{ color: 'var(--app-text-secondary)' }}>
                      Number of cortical parcels in the atlas
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Validation Error */}
          {validationError && (
            <div 
              className="flex items-center gap-2 p-3 rounded-md"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
            >
              <AlertTriangle size={16} className="flex-shrink-0" style={{ color: 'var(--app-error)' }} />
              <p className="text-sm" style={{ color: 'var(--app-error)' }}>{validationError}</p>
            </div>
          )}

          {/* Load Result */}
          {loadResult && (
            <div 
              className="p-4 rounded-md"
              style={{
                backgroundColor: loadResult.success 
                  ? 'rgba(34, 197, 94, 0.1)' 
                  : 'rgba(239, 68, 68, 0.1)',
                border: loadResult.success 
                  ? '1px solid rgba(34, 197, 94, 0.3)' 
                  : '1px solid rgba(239, 68, 68, 0.3)'
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                {loadResult.success ? (
                  <CheckCircle size={16} style={{ color: 'var(--app-success)' }} />
                ) : (
                  <AlertTriangle size={16} style={{ color: 'var(--app-error)' }} />
                )}
                <h4 
                  className="font-medium"
                  style={{ 
                    color: loadResult.success ? 'var(--app-success)' : 'var(--app-error)' 
                  }}
                >
                  {loadResult.success ? 'Atlas Loaded Successfully' : 'Loading Failed'}
                </h4>
              </div>
              
              {loadResult.success && loadResult.atlas_metadata && (
                <div className="text-sm space-y-1" style={{ color: 'var(--app-success)' }}>
                  <p><strong>Regions:</strong> {loadResult.atlas_metadata.n_regions}</p>
                  <p><strong>Space:</strong> {loadResult.atlas_metadata.space}</p>
                  <p><strong>Resolution:</strong> {loadResult.atlas_metadata.resolution}</p>
                  {loadResult.volume_handle && (
                    <p><strong>Volume Handle:</strong> {loadResult.volume_handle}</p>
                  )}
                </div>
              )}
              
              {loadResult.error_message && (
                <p className="text-sm" style={{ color: 'var(--app-error)' }}>{loadResult.error_message}</p>
              )}
            </div>
          )}

          {/* Download Size Warning */}
          {atlas.download_size_mb && atlas.download_size_mb > 50 && !atlas.is_cached && (
            <div 
              className="flex items-center gap-2 p-3 rounded-md"
              style={{ backgroundColor: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)' }}
            >
              <Info size={16} className="flex-shrink-0" style={{ color: 'var(--app-warning)' }} />
              <p className="text-sm" style={{ color: 'var(--app-warning)' }}>
                This atlas is {atlas.download_size_mb.toFixed(1)} MB and will be downloaded on first use.
              </p>
            </div>
          )}
        </div>
      </div>

      <div 
          className="flex items-center justify-between p-6"
          style={{ 
            borderTop: '1px solid var(--app-border)', 
            backgroundColor: 'var(--app-bg-tertiary)' 
          }}
        >
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--app-text-secondary)' }}>
            {atlas.is_cached ? (
              <>
                <CheckCircle size={14} style={{ color: 'var(--app-success)' }} />
                Cached locally
              </>
            ) : (
              <>
                <Info size={14} />
                Will download on load
              </>
            )}
          </div>

          <div className="flex gap-3">
            <Button
              onClick={onClose}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              onClick={handleLoadAtlas}
              disabled={isLoading || !!validationError}
              className="flex items-center gap-2"
            >
              {isLoading && <Loader size={14} className="animate-spin" />}
              {isLoading ? 'Loading...' : 'Load Atlas'}
            </Button>
          </div>
      </div>
    </Modal>
  );
};

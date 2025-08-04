/**
 * AtlasPanel - Main panel for browsing and loading brain atlases
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, Star, Clock, Filter, Download, Info } from 'lucide-react';
import { AtlasService } from '../../services/AtlasService';
import { AtlasConfigModal } from '../dialogs/AtlasConfigModal';
import { PanelErrorBoundary } from '../common/PanelErrorBoundary';
import {
  AtlasCategory,
  AtlasSource,
  AtlasDataType,
} from '../../types/atlas';
import type {
  AtlasCatalogEntry,
  AtlasFilter,
} from '../../types/atlas';
import {
  createDefaultAtlasFilter,
  getAtlasCategoryDisplayName,
  getAtlasSourceDisplayName,
  getDataTypeDisplayName,
} from '../../types/atlas';

interface AtlasPanelProps {
  className?: string;
}

const AtlasPanelContent: React.FC<AtlasPanelProps> = ({ className = '' }) => {
  console.log('AtlasPanel: Component instantiated');
  
  // State management
  const [atlases, setAtlases] = useState<AtlasCatalogEntry[]>(() => {
    console.log('AtlasPanel: Initializing atlases state with empty array');
    return [];
  });
  const [recentAtlases, setRecentAtlases] = useState<AtlasCatalogEntry[]>(() => {
    console.log('AtlasPanel: Initializing recentAtlases state with empty array');
    return [];
  });
  const [favoriteAtlases, setFavoriteAtlases] = useState<AtlasCatalogEntry[]>(() => {
    console.log('AtlasPanel: Initializing favoriteAtlases state with empty array');
    return [];
  });
  const [filter, setFilter] = useState<AtlasFilter>(createDefaultAtlasFilter());
  const [selectedAtlas, setSelectedAtlas] = useState<AtlasCatalogEntry | null>(null);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'recent' | 'favorites'>('all');
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // Cancellation token ref to handle component unmounting
  const cancelTokenRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (cancelTokenRef.current) {
        cancelTokenRef.current.abort();
      }
    };
  }, []);

  // Safe state setter that checks if component is still mounted
  const safeSetState = useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: React.SetStateAction<T>) => {
    if (isMountedRef.current) {
      console.log('AtlasPanel: safeSetState called, component is mounted, updating state');
      setter(value);
    } else {
      console.log('AtlasPanel: safeSetState called but component is not mounted, skipping update');
    }
  }, []);

  const loadAtlasData = useCallback(async () => {
    // Create new cancellation token for this operation
    if (cancelTokenRef.current) {
      cancelTokenRef.current.abort();
    }
    cancelTokenRef.current = new AbortController();
    const currentToken = cancelTokenRef.current;

    try {
      console.log('AtlasPanel: Starting to load atlas data...');
      safeSetState(setIsLoading, true);
      safeSetState(setError, null);

      console.log('AtlasPanel: Making parallel requests to backend...');
      const [catalogData, recentData, favoritesData] = await Promise.all([
        AtlasService.getCatalog(currentToken.signal),
        AtlasService.getRecentAtlases(currentToken.signal),
        AtlasService.getFavoriteAtlases(currentToken.signal),
      ]);

      console.log('AtlasPanel: Received data:', {
        catalog: catalogData?.length || 0,
        recent: recentData?.length || 0,
        favorites: favoritesData?.length || 0
      });

      // Check if component is still mounted and operation wasn't cancelled
      if (!currentToken.signal.aborted && isMountedRef.current) {
        safeSetState(setAtlases, catalogData);
        safeSetState(setRecentAtlases, recentData);
        safeSetState(setFavoriteAtlases, favoritesData);
        setHasLoadedOnce(true);
        console.log('AtlasPanel: State updated successfully');
      }
    } catch (err) {
      // Only update error state if not cancelled and component is mounted
      if (!currentToken.signal.aborted && isMountedRef.current) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load atlas data';
        console.error('AtlasPanel: Error loading atlas data:', err);
        safeSetState(setError, errorMessage);
        console.error('Failed to load atlas data:', err);
      }
    } finally {
      // Always try to clear loading state if component is mounted
      if (isMountedRef.current) {
        // Check if we have any data (might be from a previous successful call)
        const hasAnyData = atlases.length > 0 || recentAtlases.length > 0 || favoriteAtlases.length > 0;
        
        if (!currentToken.signal.aborted) {
          console.log('AtlasPanel: Operation completed, setting loading to false');
          safeSetState(setIsLoading, false);
        } else if (hasAnyData) {
          console.log('AtlasPanel: Operation aborted but we have data, clearing loading state');
          safeSetState(setIsLoading, false);
        } else {
          console.log('AtlasPanel: Operation aborted and no data, keeping loading state');
        }
      } else {
        console.log('AtlasPanel: Component unmounted, skipping loading state update');
      }
    }
  }, [safeSetState]);

  const applyFilters = useCallback(async () => {
    if (activeTab !== 'all') return;

    // Create new cancellation token for this operation
    if (cancelTokenRef.current) {
      cancelTokenRef.current.abort();
    }
    cancelTokenRef.current = new AbortController();
    const currentToken = cancelTokenRef.current;

    try {
      const filteredAtlases = await AtlasService.getFilteredAtlases(filter, currentToken.signal);
      
      // Check if component is still mounted and operation wasn't cancelled
      if (!currentToken.signal.aborted && isMountedRef.current) {
        safeSetState(setAtlases, filteredAtlases);
      }
    } catch (err) {
      // Only log error if not cancelled
      if (!currentToken.signal.aborted) {
        console.error('Failed to apply filters:', err);
      }
    }
  }, [activeTab, filter, safeSetState]);

  // Check if data already exists on mount (handles persistence/double-mounting)
  useEffect(() => {
    const hasExistingData = atlases.length > 0 || recentAtlases.length > 0 || favoriteAtlases.length > 0;
    if (hasExistingData && isLoading) {
      console.log('AtlasPanel: Found existing data on mount, clearing loading state');
      setIsLoading(false);
      setHasLoadedOnce(true);
      return;
    }
  }, [atlases.length, recentAtlases.length, favoriteAtlases.length, isLoading]);

  // Load atlas data on mount
  useEffect(() => {
    // Skip loading if we already have data and haven't explicitly requested a reload
    if (hasLoadedOnce && (atlases.length > 0 || recentAtlases.length > 0 || favoriteAtlases.length > 0)) {
      console.log('AtlasPanel: Skipping load - data already exists and has been loaded once');
      return;
    }
    
    console.log('AtlasPanel: useEffect triggered, calling loadAtlasData');
    loadAtlasData();
  }, [loadAtlasData, hasLoadedOnce, atlases.length, recentAtlases.length, favoriteAtlases.length]);

  // Apply filters when filter changes
  useEffect(() => {
    if (activeTab === 'all') {
      applyFilters();
    }
  }, [filter, activeTab, applyFilters]);

  const handleToggleFavorite = async (atlasId: string) => {
    // Create new cancellation token for this operation
    if (cancelTokenRef.current) {
      cancelTokenRef.current.abort();
    }
    cancelTokenRef.current = new AbortController();
    const currentToken = cancelTokenRef.current;

    try {
      const newFavoriteStatus = await AtlasService.toggleFavorite(atlasId, currentToken.signal);
      
      // Check if component is still mounted and operation wasn't cancelled
      if (!currentToken.signal.aborted && isMountedRef.current) {
        // Update the atlas in the current list
        safeSetState(setAtlases, prev => prev.map(atlas => 
          atlas.id === atlasId ? { ...atlas, is_favorite: newFavoriteStatus } : atlas
        ));

        // Refresh favorites list
        const updatedFavorites = await AtlasService.getFavoriteAtlases(currentToken.signal);
        
        // Check again before final update
        if (!currentToken.signal.aborted && isMountedRef.current) {
          safeSetState(setFavoriteAtlases, updatedFavorites);
        }
      }
    } catch (err) {
      // Only log error if not cancelled
      if (!currentToken.signal.aborted) {
        console.error('Failed to toggle favorite:', err);
      }
    }
  };

  const handleLoadAtlas = (atlas: AtlasCatalogEntry) => {
    setSelectedAtlas(atlas);
    setIsConfigModalOpen(true);
  };

  const handleCloseConfigModal = () => {
    setIsConfigModalOpen(false);
    setSelectedAtlas(null);
  };

  // Get current atlas list based on active tab
  const currentAtlases = useMemo(() => {
    console.log('AtlasPanel: Computing currentAtlases with:', {
      activeTab,
      atlasesLength: atlases?.length || 0,
      recentLength: recentAtlases?.length || 0,
      favoritesLength: favoriteAtlases?.length || 0
    });
    
    const result = (() => {
      switch (activeTab) {
        case 'recent':
          return recentAtlases;
        case 'favorites':
          return favoriteAtlases;
        default:
          return atlases;
      }
    })();
    console.log(`AtlasPanel: Current atlases for tab '${activeTab}':`, result?.length || 0, 'items', result);
    return result;
  }, [activeTab, atlases, recentAtlases, favoriteAtlases]);

  console.log('AtlasPanel: Checking loading state:', { isLoading, hasAtlases: currentAtlases?.length > 0 });
  
  if (isLoading) {
    console.log('AtlasPanel: Rendering loading state');
    return (
      <div className={`p-4 ${className}`} style={{ backgroundColor: 'var(--app-bg-secondary)', color: 'var(--app-text-primary)' }}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 rounded" style={{ backgroundColor: 'var(--app-bg-tertiary)' }}></div>
          <div className="h-32 rounded" style={{ backgroundColor: 'var(--app-bg-tertiary)' }}></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded" style={{ backgroundColor: 'var(--app-bg-tertiary)' }}></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    console.log('AtlasPanel: Rendering error state:', error);
    return (
      <div className={`p-4 ${className}`} style={{ backgroundColor: 'var(--app-bg-secondary)' }}>
        <div className="rounded-md p-4" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
          <p className="text-sm" style={{ color: 'var(--app-error)' }}>Error: {error}</p>
          <button
            onClick={loadAtlasData}
            className="mt-2 px-3 py-1 text-xs rounded transition-colors"
            style={{ backgroundColor: 'var(--app-error)', color: 'white' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#dc2626';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--app-error)';
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  console.log('AtlasPanel: Rendering main content', {
    isLoading,
    error,
    currentAtlasesLength: currentAtlases?.length || 0,
    activeTab
  });

  return (
    <div className={`flex flex-col h-full ${className}`} style={{ 
      backgroundColor: 'var(--app-bg-secondary)', 
      color: 'var(--app-text-primary)' 
    }}>
      {/* Header */}
      <div className="p-4" style={{ borderBottom: '1px solid var(--app-border)' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--app-text-primary)' }}>Brain Atlases</h2>
        
        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-4">
          <button
            onClick={() => setActiveTab('all')}
            className="px-3 py-1 text-sm rounded-md transition-colors"
            style={{
              backgroundColor: activeTab === 'all' ? 'var(--app-accent)' : 'transparent',
              color: activeTab === 'all' ? 'white' : 'var(--app-text-secondary)',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'all') {
                e.currentTarget.style.color = 'var(--app-text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'all') {
                e.currentTarget.style.color = 'var(--app-text-secondary)';
              }
            }}
          >
            All Atlases
          </button>
          <button
            onClick={() => setActiveTab('recent')}
            className="px-3 py-1 text-sm rounded-md transition-colors flex items-center gap-1"
            style={{
              backgroundColor: activeTab === 'recent' ? 'var(--app-accent)' : 'transparent',
              color: activeTab === 'recent' ? 'white' : 'var(--app-text-secondary)',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'recent') {
                e.currentTarget.style.color = 'var(--app-text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'recent') {
                e.currentTarget.style.color = 'var(--app-text-secondary)';
              }
            }}
          >
            <Clock size={14} />
            Recent ({recentAtlases.length})
          </button>
          <button
            onClick={() => setActiveTab('favorites')}
            className="px-3 py-1 text-sm rounded-md transition-colors flex items-center gap-1"
            style={{
              backgroundColor: activeTab === 'favorites' ? 'var(--app-accent)' : 'transparent',
              color: activeTab === 'favorites' ? 'white' : 'var(--app-text-secondary)',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'favorites') {
                e.currentTarget.style.color = 'var(--app-text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'favorites') {
                e.currentTarget.style.color = 'var(--app-text-secondary)';
              }
            }}
          >
            <Star size={14} />
            Favorites ({favoriteAtlases.length})
          </button>
        </div>

        {/* Search and Filters - Only shown on "All" tab */}
        {activeTab === 'all' && (
          <div className="space-y-3">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2" style={{ color: 'var(--app-text-muted)' }} size={16} />
              <input
                type="text"
                placeholder="Search atlases..."
                value={filter.search_query || ''}
                onChange={(e) => setFilter(prev => ({ ...prev, search_query: e.target.value || undefined }))}
                className="w-full pl-10 pr-4 py-2 text-sm rounded-md"
                style={{
                  backgroundColor: 'var(--app-bg-tertiary)',
                  border: '1px solid var(--app-border)',
                  color: 'var(--app-text-primary)',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'var(--app-accent)';
                  e.target.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'var(--app-border)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Quick Filters */}
            <div className="flex flex-wrap gap-2">
              {/* Category Filter */}
              <select
                value={filter.category || ''}
                onChange={(e) => setFilter(prev => ({ 
                  ...prev, 
                  category: e.target.value ? e.target.value as AtlasCategory : undefined 
                }))}
                className="text-xs rounded px-2 py-1"
                style={{
                  backgroundColor: 'var(--app-bg-tertiary)',
                  border: '1px solid var(--app-border)',
                  color: 'var(--app-text-primary)',
                }}
              >
                <option value="">All Categories</option>
                {Object.values(AtlasCategory).map(category => (
                  <option key={category} value={category}>
                    {getAtlasCategoryDisplayName(category)}
                  </option>
                ))}
              </select>

              {/* Source Filter */}
              <select
                value={filter.source || ''}
                onChange={(e) => setFilter(prev => ({ 
                  ...prev, 
                  source: e.target.value ? e.target.value as AtlasSource : undefined 
                }))}
                className="text-xs rounded px-2 py-1"
                style={{
                  backgroundColor: 'var(--app-bg-tertiary)',
                  border: '1px solid var(--app-border)',
                  color: 'var(--app-text-primary)',
                }}
              >
                <option value="">All Sources</option>
                {Object.values(AtlasSource).map(source => (
                  <option key={source} value={source}>
                    {getAtlasSourceDisplayName(source)}
                  </option>
                ))}
              </select>

              {/* Data Type Filter */}
              <select
                value={filter.data_type || ''}
                onChange={(e) => setFilter(prev => ({ 
                  ...prev, 
                  data_type: e.target.value ? e.target.value as AtlasDataType : undefined 
                }))}
                className="text-xs rounded px-2 py-1"
                style={{
                  backgroundColor: 'var(--app-bg-tertiary)',
                  border: '1px solid var(--app-border)',
                  color: 'var(--app-text-primary)',
                }}
              >
                <option value="">All Types</option>
                {Object.values(AtlasDataType).map(dataType => (
                  <option key={dataType} value={dataType}>
                    {getDataTypeDisplayName(dataType)}
                  </option>
                ))}
              </select>
            </div>

            {/* Toggle Filters */}
            <div className="flex gap-4 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filter.show_favorites_only}
                  onChange={(e) => setFilter(prev => ({ ...prev, show_favorites_only: e.target.checked }))}
                  className="rounded"
                />
                <span>Favorites only</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filter.show_cached_only}
                  onChange={(e) => setFilter(prev => ({ ...prev, show_cached_only: e.target.checked }))}
                  className="rounded"
                />
                <span>Cached only</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Atlas List */}
      <div className="flex-1 overflow-y-auto">
        {currentAtlases.length === 0 ? (
          <div className="p-4 text-center" style={{ color: 'var(--app-text-muted)' }}>
            <Info size={48} className="mx-auto mb-2" style={{ color: 'var(--app-text-disabled)' }} />
            <p>No atlases found</p>
            {activeTab === 'all' && filter.search_query && (
              <p className="text-xs mt-1">Try adjusting your search or filters</p>
            )}
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {currentAtlases.map((atlas) => (
              <AtlasCard
                key={atlas.id}
                atlas={atlas}
                onToggleFavorite={handleToggleFavorite}
                onLoad={handleLoadAtlas}
              />
            ))}
          </div>
        )}
      </div>

      {/* Atlas Configuration Modal */}
      {selectedAtlas && (
        <AtlasConfigModal
          isOpen={isConfigModalOpen}
          onClose={handleCloseConfigModal}
          atlas={selectedAtlas}
          onLoad={loadAtlasData} // Refresh data after loading
        />
      )}
    </div>
  );
};

// Atlas Card Component
interface AtlasCardProps {
  atlas: AtlasCatalogEntry;
  onToggleFavorite: (id: string) => void;
  onLoad: (atlas: AtlasCatalogEntry) => void;
}

const AtlasCard: React.FC<AtlasCardProps> = ({ atlas, onToggleFavorite, onLoad }) => {
  return (
    <div 
      className="rounded-md p-3 transition-colors cursor-pointer"
      style={{
        border: '1px solid var(--app-border)',
        backgroundColor: 'var(--app-bg-tertiary)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--app-bg-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--app-bg-tertiary)';
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-sm truncate" style={{ color: 'var(--app-text-primary)' }}>{atlas.name}</h3>
            <span 
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: atlas.category === 'Cortical' ? '#1e40af' :
                                atlas.category === 'Subcortical' ? '#047857' :
                                atlas.category === 'WholeBrain' ? '#7c3aed' :
                                atlas.category === 'Specialized' ? '#c2410c' :
                                'var(--app-bg-quaternary)',
                color: atlas.category === 'Cortical' ? '#dbeafe' :
                       atlas.category === 'Subcortical' ? '#d1fae5' :
                       atlas.category === 'WholeBrain' ? '#ddd6fe' :
                       atlas.category === 'Specialized' ? '#fed7aa' :
                       'var(--app-text-secondary)',
              }}
            >
              {getAtlasCategoryDisplayName(atlas.category)}
            </span>
          </div>
          
          <p className="text-xs mb-2 line-clamp-2" style={{ color: 'var(--app-text-secondary)' }}>{atlas.description}</p>
          
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--app-text-muted)' }}>
            <span>{getAtlasSourceDisplayName(atlas.source)}</span>
            <span>{atlas.allowed_spaces.length} space{atlas.allowed_spaces.length !== 1 ? 's' : ''}</span>
            {atlas.download_size_mb && (
              <span>{atlas.download_size_mb.toFixed(1)} MB</span>
            )}
            {atlas.is_cached && (
              <span style={{ color: 'var(--app-success)' }}>Cached</span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => onToggleFavorite(atlas.id)}
            className="p-1 rounded transition-colors"
            style={{ 
              color: atlas.is_favorite ? '#eab308' : 'var(--app-text-muted)' 
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--app-bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title={atlas.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star size={16} fill={atlas.is_favorite ? 'currentColor' : 'none'} />
          </button>
          
          <button
            onClick={() => onLoad(atlas)}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--app-accent)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--app-bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Load atlas"
          >
            <Download size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

// Export wrapped component with error boundary
export const AtlasPanel: React.FC<AtlasPanelProps> = (props) => {
  return (
    <PanelErrorBoundary panelName="AtlasPanel">
      <AtlasPanelContent {...props} />
    </PanelErrorBoundary>
  );
};
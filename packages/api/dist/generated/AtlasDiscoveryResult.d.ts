import type { DiscoveredAtlas } from "./DiscoveredAtlas";
/**
 * Result of atlas discovery operation
 */
export type AtlasDiscoveryResult = {
    /**
     * All discovered atlases
     */
    atlases: Array<DiscoveredAtlas>;
    /**
     * Whether this came from cache
     */
    from_cache: boolean;
};

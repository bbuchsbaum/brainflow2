import type { DiscoveredTemplate } from "./DiscoveredTemplate";
import type { TemplateDiscoveryStats } from "./TemplateDiscoveryStats";
/**
 * Result of template discovery operation
 */
export type TemplateDiscoveryResult = {
    /**
     * All discovered templates
     */
    templates: Array<DiscoveredTemplate>;
    /**
     * Statistics about the discovery
     */
    stats: TemplateDiscoveryStats;
    /**
     * Whether this came from cache
     */
    from_cache: boolean;
};

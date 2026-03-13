/**
 * Summary of a discovered atlas from TemplateFlow
 */
export type DiscoveredAtlas = {
    /**
     * Atlas name/ID
     */
    id: string;
    /**
     * Human-readable display name
     */
    display_name: string;
    /**
     * Which templates this atlas is available for
     */
    available_for_templates: Array<string>;
};

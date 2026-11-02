/**
 * Identifies one exclusion row: an entity can be excluded under several criteria.
 */
export type BidsExclusionKey = {
    entity: string;
    criterion: string;
};

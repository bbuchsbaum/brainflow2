/**
 * What a folder is, as far as BIDS goes. `bids`: it has
 * `dataset_description.json` (participants.tsv is only recommended).
 * `layout_only`: no description, but subject folders hold modality folders
 * with BIDS-named files; the UI offers to open it by layout, never by itself.
 * `none`: neither.
 */
export type BidsDirectoryStatus = "bids" | "layout_only" | "none";

/**
 * Images that share one per-subject relative path, the subject, session and
 * run labels replaced by `*`.
 */
export type DatasetImageKind = {
    path: string;
    count: number;
    /**
     * The subject folders beside the ones these images are in: how many
     * `sub-*` folders their common parent folder holds. `None` when the
     * images are not in subject folders (subjects named in file names
     * only), or are in subject folders of more than one folder. Only this,
     * never `subjectCount`, says how many images of the kind to expect.
     */
    subjectFolders: number | null;
};

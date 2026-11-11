import type { DatasetContainer } from "./DatasetContainer";
export type DatasetGeneratedBy = {
    name: string | null;
    version: string | null;
    description: string | null;
    codeUrl: string | null;
    container: DatasetContainer | null;
};

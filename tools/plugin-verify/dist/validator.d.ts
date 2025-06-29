/**
 * Result of plugin validation
 */
export interface ValidationResult {
    valid: boolean;
    fileCount: number;
    errorCount: number;
    errors?: Array<{
        file: string;
        errors: any[];
    }>;
}
/**
 * Class for validating Brainflow plugin manifests
 */
export declare class PluginValidator {
    private ajv;
    private schemaPath;
    private verbose;
    private schemaCache;
    /**
     * Create a new validator instance
     * @param schemaPath Path to the JSON schema for validation
     * @param verbose Whether to show verbose output
     */
    constructor(schemaPath: string, verbose?: boolean);
    /**
     * Load the JSON schema for validation
     * @returns The loaded schema
     */
    private loadSchema;
    /**
     * Validate a single plugin manifest file
     * @param filePath Path to the manifest file
     * @returns Validation result
     */
    validateFile(filePath: string): Promise<{
        valid: boolean;
        errors?: any[];
    }>;
    /**
     * Validate a directory of plugin manifests or a single file
     * @param path Path to a directory containing manifests or a single manifest file
     * @returns Validation results for all manifests
     */
    validatePath(path: string): Promise<ValidationResult>;
}

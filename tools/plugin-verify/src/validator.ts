// @ts-ignore
import AjvDefault from 'ajv';
const Ajv = AjvDefault.default || AjvDefault;
import { readFile } from 'fs/promises';
import { existsSync, lstatSync } from 'fs';
import { glob } from 'glob';
import { join, resolve } from 'path';
import chalk from 'chalk';

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
export class PluginValidator {
  private ajv: any;
  private schemaPath: string;
  private verbose: boolean;
  private schemaCache: any;

  /**
   * Create a new validator instance
   * @param schemaPath Path to the JSON schema for validation
   * @param verbose Whether to show verbose output
   */
  constructor(schemaPath: string, verbose = false) {
    this.schemaPath = schemaPath;
    this.verbose = verbose;
    this.ajv = new Ajv({ allErrors: true });
    this.schemaCache = null;
  }

  /**
   * Load the JSON schema for validation
   * @returns The loaded schema
   */
  private async loadSchema(): Promise<any> {
    if (this.schemaCache) return this.schemaCache;

    if (!existsSync(this.schemaPath)) {
      throw new Error(`Schema file not found: ${this.schemaPath}`);
    }

    try {
      const schemaContent = await readFile(this.schemaPath, 'utf-8');
      this.schemaCache = JSON.parse(schemaContent);
      return this.schemaCache;
    } catch (error) {
      throw new Error(`Failed to load schema: ${error}`);
    }
  }

  /**
   * Validate a single plugin manifest file
   * @param filePath Path to the manifest file
   * @returns Validation result
   */
  async validateFile(filePath: string): Promise<{valid: boolean, errors?: any[]}> {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    try {
      // Load the schema
      const schema = await this.loadSchema();
      
      // Load the manifest
      const content = await readFile(filePath, 'utf-8');
      const manifest = JSON.parse(content);
      
      // Validate the manifest against the schema
      const validate = this.ajv.compile(schema);
      const valid = validate(manifest);
      
      if (!valid) {
        return { valid: false, errors: validate.errors };
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, errors: [{ keyword: 'parse', message: `Failed to parse JSON: ${error}` }] };
    }
  }

  /**
   * Validate a directory of plugin manifests or a single file
   * @param path Path to a directory containing manifests or a single manifest file
   * @returns Validation results for all manifests
   */
  async validatePath(path: string): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      fileCount: 0,
      errorCount: 0,
      errors: []
    };

    if (!existsSync(path)) {
      throw new Error(`Path not found: ${path}`);
    }

    let filesToValidate: string[] = [];
    
    if (lstatSync(path).isDirectory()) {
      // Find all brainflow-plugin.json files in the directory and subdirectories
      filesToValidate = await glob('**/brainflow-plugin.json', { cwd: path, absolute: true });
      
      if (filesToValidate.length === 0) {
        console.warn(chalk.yellow(`⚠️ No brainflow-plugin.json files found in: ${path}`));
        return result;
      }
    } else {
      // Single file mode
      filesToValidate = [path];
    }

    // Process each file
    for (const file of filesToValidate) {
      result.fileCount++;
      
      if (this.verbose) {
        console.log(chalk.blue(`Validating: ${file}`));
      }
      
      const fileResult = await this.validateFile(file);
      
      if (!fileResult.valid) {
        result.valid = false;
        result.errorCount++;
        
        if (result.errors) {
          result.errors.push({
            file,
            errors: fileResult.errors || []
          });
        }
        
        // Print errors in verbose mode
        if (this.verbose && fileResult.errors) {
          console.error(chalk.red(`❌ ${file} is invalid:`));
          console.error(JSON.stringify(fileResult.errors, null, 2));
        } else if (!this.verbose) {
          console.error(chalk.red(`❌ ${file} is invalid`));
        }
      } else if (this.verbose) {
        console.log(chalk.green(`✓ ${file} is valid`));
      }
    }

    return result;
  }
} 
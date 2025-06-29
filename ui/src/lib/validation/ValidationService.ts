/**
 * ValidationService - Centralized validation with helpful error messages
 */
import { z } from 'zod';
import * as schemas from './schemas';

export class ValidationError extends Error {
  constructor(public errors: z.ZodError['errors']) {
    const messages = errors.map(e => `${e.path.join('.')}: ${e.message}`);
    super(`Validation failed:\n${messages.join('\n')}`);
    this.name = 'ValidationError';
  }
}

export class ValidationService {
  private schemas = new Map<string, z.ZodSchema>();
  
  constructor() {
    // Register all schemas
    this.register('FilePath', schemas.FilePathSchema);
    this.register('FileName', schemas.FileNameSchema);
    this.register('VolumeSpec', schemas.VolumeSpecSchema);
    this.register('LayerSpec', schemas.LayerSpecSchema);
    this.register('WorldCoord', schemas.WorldCoordSchema);
    this.register('VoxelCoord', schemas.VoxelCoordSchema);
    this.register('RenderRequest', schemas.RenderRequestSchema);
    this.register('TreeNode', schemas.TreeNodeSchema);
    this.register('MountConfig', schemas.MountConfigSchema);
  }
  
  /**
   * Register a schema
   */
  register(name: string, schema: z.ZodSchema): void {
    this.schemas.set(name, schema);
  }
  
  /**
   * Validate data against a schema
   */
  validate<T>(schemaName: string, data: unknown): T {
    const schema = this.schemas.get(schemaName);
    if (!schema) {
      throw new Error(`Unknown schema: ${schemaName}`);
    }
    
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new ValidationError(result.error.errors);
    }
    
    return result.data as T;
  }
  
  /**
   * Check if data is valid without throwing
   */
  isValid(schemaName: string, data: unknown): boolean {
    const schema = this.schemas.get(schemaName);
    if (!schema) return false;
    
    return schema.safeParse(data).success;
  }
  
  /**
   * Get validation errors without throwing
   */
  getErrors(schemaName: string, data: unknown): z.ZodError['errors'] | null {
    const schema = this.schemas.get(schemaName);
    if (!schema) return null;
    
    const result = schema.safeParse(data);
    if (result.success) return null;
    
    return result.error.errors;
  }
  
  /**
   * Create a validated function wrapper
   */
  createValidatedFunction<TArgs extends any[], TReturn>(
    fn: (...args: TArgs) => TReturn | Promise<TReturn>,
    argsSchema: z.ZodSchema<TArgs>
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args: TArgs) => {
      const validatedArgs = argsSchema.parse(args);
      return await fn(...validatedArgs);
    };
  }
}

// Singleton instance
let validationService: ValidationService | null = null;

export function getValidationService(): ValidationService {
  if (!validationService) {
    validationService = new ValidationService();
  }
  return validationService;
}
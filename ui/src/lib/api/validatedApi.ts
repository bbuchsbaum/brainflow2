/**
 * Validated API wrapper
 * Adds input validation and sanitization to all API calls
 */
import { coreApi } from '$lib/api';
import { getValidationService } from '$lib/validation/ValidationService';
import { sanitizePath, sanitizeResourceId } from '$lib/utils/sanitize';
import { z } from 'zod';
import type { CoreApi } from '$lib/api';

// Define validation schemas for each API method
const apiValidations = {
  load_file: z.tuple([z.string().transform(sanitizePath)]),
  
  fs_list_directory: z.tuple([z.string().transform(sanitizePath)]),
  
  request_layer_gpu_resources: z.tuple([z.any()]), // Already validated by LayerService
  
  release_view_resources: z.tuple([z.string().transform(sanitizeResourceId)]),
  
  world_to_voxel: z.tuple([
    z.string().transform(sanitizeResourceId),
    z.tuple([z.number(), z.number(), z.number()])
  ]),
  
  voxel_to_world: z.tuple([
    z.string().transform(sanitizeResourceId),
    z.tuple([z.number(), z.number(), z.number()])
  ]),
  
  get_slice_data: z.tuple([
    z.string().transform(sanitizeResourceId),
    z.number().int().min(0).max(2),
    z.number().int().min(0)
  ]),
  
  get_timeseries_matrix: z.tuple([
    z.string().transform(sanitizeResourceId),
    z.array(z.number().int().min(0))
  ])
};

/**
 * Create a validated version of the API
 */
export function createValidatedApi(api: typeof coreApi): typeof coreApi {
  const validator = getValidationService();
  
  return new Proxy(api, {
    get(target, prop: keyof typeof coreApi) {
      const original = target[prop];
      
      // If it's a function with validation schema, wrap it
      if (typeof original === 'function' && prop in apiValidations) {
        return async (...args: any[]) => {
          try {
            // Validate and transform arguments
            const schema = apiValidations[prop as keyof typeof apiValidations];
            const validatedArgs = schema.parse(args);
            
            // Call original function with validated args
            return await original.apply(target, validatedArgs);
          } catch (error) {
            if (error instanceof z.ZodError) {
              console.error(`Validation error in ${String(prop)}:`, error.errors);
              throw new Error(`Invalid arguments for ${String(prop)}: ${error.errors.map(e => e.message).join(', ')}`);
            }
            throw error;
          }
        };
      }
      
      return original;
    }
  }) as typeof coreApi;
}

// Export validated API as default
export const validatedApi = createValidatedApi(coreApi);

// Re-export types
export type { CoreApi };
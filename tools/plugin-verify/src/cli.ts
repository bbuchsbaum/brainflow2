#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
// @ts-ignore
import AjvDefault from 'ajv';
// @ts-ignore
import addFormatsDefault from 'ajv-formats';

const Ajv = AjvDefault.default || AjvDefault;
const addFormats = addFormatsDefault.default || addFormatsDefault;
import { fileURLToPath } from 'url';

// Helper to get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('plugin-verify')
  .description('Validates a Brainflow plugin manifest against the JSON schema.')
  .version('0.1.0') // Match package.json
  .argument('<manifestPath>', 'Path to the plugin manifest JSON file')
  .action(async (manifestPath) => {
    console.log(`Validating manifest: ${manifestPath}`);

    try {
      // --- 1. Resolve Schema Path --- 
      // The compiled code is in tools/plugin-verify/dist/, so we need to go up 3 levels to reach the project root
      const schemaPath = path.resolve(__dirname, '../../..', 'schemas/0.1.1/brainflow-plugin.json'); 
      console.log(`Using schema: ${schemaPath}`);

      // --- 2. Read Schema --- 
      let schema;
      try {
        const schemaContent = await fs.readFile(schemaPath, 'utf-8');
        schema = JSON.parse(schemaContent);
      } catch (err: any) {
        console.error(`Error reading or parsing schema file at ${schemaPath}:`, err.message);
        process.exit(1);
      }
      
      // --- 3. Read Manifest --- 
      const absoluteManifestPath = path.resolve(manifestPath);
      let manifestData;
      try {
        const manifestContent = await fs.readFile(absoluteManifestPath, 'utf-8');
        manifestData = JSON.parse(manifestContent);
      } catch (err: any) {
        console.error(`Error reading or parsing manifest file at ${absoluteManifestPath}:`, err.message);
        process.exit(1);
      }

      // --- 4. Validate --- 
      const ajv = new Ajv({ allErrors: true });
      addFormats(ajv);
      
      const validate = ajv.compile(schema);
      const valid = validate(manifestData);

      if (valid) {
        console.log(`✅ Manifest ${manifestPath} is valid.`);
        process.exit(0);
      } else {
        console.error(`❌ Manifest ${manifestPath} is invalid. Errors:`);
        // Improve error formatting
        validate.errors?.forEach((error: any, index: number) => {
          console.error(`  ${index + 1}. Path: ${error.instancePath || '/'}`);
          console.error(`     Keyword: ${error.keyword}`);
          console.error(`     Message: ${error.message}`);
          if (error.params) {
            console.error(`     Params: ${JSON.stringify(error.params)}`);
          }
        });
        process.exit(1);
      }

    } catch (error: any) {
      console.error('An unexpected error occurred:', error.message);
      process.exit(1);
    }
  });

program.parse(process.argv); 
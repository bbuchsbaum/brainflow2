# Brainflow Plugin Verify

A CLI tool to validate Brainflow plugin manifests against the JSON schema.

## Installation

```bash
# From the project root
cd tools/plugin-verify
npm install
npm run build
```

## Usage

```bash
# Validate a single manifest file
npx plugin-verify path/to/brainflow-plugin.json

# Validate all manifest files in a directory recursively
npx plugin-verify path/to/plugins/directory

# Show verbose output
npx plugin-verify path/to/plugins/directory --verbose

# Specify a different schema version
npx plugin-verify path/to/plugins/directory --schema-version 0.1.1
```

## Options

- `-s, --schema-version <version>`: Specify the schema version to use for validation (default: `0.1.1`)
- `-v, --verbose`: Show verbose output, including detailed validation errors
- `-h, --help`: Display help information
- `-V, --version`: Display version information

## Examples

Example plugin manifests can be found in the `examples` directory:

- `examples/nifti-loader-example/brainflow-plugin.json` - A simple NIfTI loader plugin
- `examples/plot-ts-plotly/brainflow-plugin.json` - A time-series plot plugin

To validate these examples:

```bash
npx plugin-verify examples
``` 
---

## `docs/SPEC-json-schemas-v0.1.1.md`

```markdown
# Brainflow Phase 1 JSON Specifications (v0.1.1)

This document provides the formal JSON Schema definitions (draft-07) and examples for the key data structures and message formats used in Brainflow Phase 1 (API version 0.1.1).

**Versioning:** These specifications correspond to `@brainflow/api@0.1.1`.

**Schema Publication & Validation:** Schemas will be published (e.g., to `https://brainflow.dev/schemas/0.1/`) and used for validation via tools like AJV.

**Note on Binary Data:** Placeholders like `"SharedArrayBuffer"` or properties like `contentMediaType` represent binary data transferred efficiently via Tauri bridge / `postMessage`, not embedded directly in JSON.

---

## 1. `brainflow-plugin.json`

**Purpose:** Manifest file for plugins, describing identity, capabilities, and compatibility.

**JSON Schema:**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Brainflow Plugin Manifest (v0.1.1)",
  "description": "Manifest file describing a Brainflow plugin.",
  "type": "object",
  "required": [
    "id", "name", "version", "compatibleCore", "type", "apiVersion", "entrypoint", "handles"
  ],
  "properties": {
    "id": {
      "description": "Unique identifier (lowercase, alphanumeric, hyphens).",
      "type": "string", "pattern": "^[a-z0-9-]+$"
    },
    "name": {
      "description": "Human-readable name.",
      "type": "string", "minLength": 1
    },
    "version": {
      "description": "Plugin's SemVer version.",
      "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$"
    },
    "compatibleCore": {
      "description": "SemVer range for compatible Brainflow core versions (e.g., '^0.1.0').",
      "type": "string", "pattern": "^[\\^~]?\\d+\\.\\d+(\\.\\d+)?$"
    },
    "type": {
      "description": "Plugin type.",
      "enum": ["loader", "plot"]
    },
    "apiVersion": {
      "description": "Target @brainflow/api version.",
      "const": "0.1.1"
    },
    "entrypoint": {
      "description": "Relative path to main JS entry file (e.g., 'dist/index.js').",
      "type": "string", "pattern": "^[^/].*\\.js$"
    },
    "description": { "type": "string" },
    "author": { "type": "string" },
    "handles": {
      "description": "Specifies what the plugin processes. Loaders use file patterns (*.nii) or MIME types. Plotters use data type identifiers ('timeseries').",
      "type": "array", "minItems": 1,
      "items": { "type": "string", "minLength": 1 }
    }
  },
  "additionalProperties": false
}
Use code with caution.
Clarification Note on handles: For v0.1.1, this is a flat array of strings. A structured format may be adopted in v0.2+ (RFC #18).
Loader Example:
{
  "id": "nifti-loader-basic", "name": "NIfTI Loader (Basic)", "version": "0.3.2",
  "compatibleCore": "^0.1", "type": "loader", "apiVersion": "0.1.1",
  "entrypoint": "dist/index.js", "description": "Parses .nii/.nii.gz files.",
  "author": "Brainflow Team", "handles": ["*.nii", "*.nii.gz"]
}
Use code with caution.
Json
Plot Example:
{
  "id": "plot-ts-plotly", "name": "Voxel Time-series (Plotly)", "version": "0.1.0",
  "compatibleCore": "^0.1", "type": "plot", "apiVersion": "0.1.1",
  "entrypoint": "dist/timeSeriesPlot.js", "description": "Renders 1xT Float32Array.",
  "handles": ["timeseries"]
}
Use code with caution.
Json
2. PlotWorkerMessage
Purpose: Structure of messages for the Plotting Web Worker.
JSON Schema:
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Plot Worker Message (v0.1.1)",
  "description": "Structure for messages sent to/from the Plotting Web Worker.",
  "type": "object", "required": ["type"],
  "oneOf": [
    {
      "properties": {
        "type": { "const": "init" },
        "canvas": { "description": "Transferred OffscreenCanvas.", "instanceof": "OffscreenCanvas" }
      }, "required": ["type", "canvas"]
    },
    {
      "properties": {
        "type": { "enum": ["plot", "resize"] },
        "payload": {
          "type": "object", "required": ["targetId"],
          "properties": {
            "targetId": { "type": "string" },
            "sample":   { "description": "DataSample object (generic in v0.1.1).", "type": "object" },
            "options":  { "description": "PlotOptions object (generic in v0.1.1).", "type": "object" },
            "width":    { "type": "number", "minimum": 0 },
            "height":   { "type": "number", "minimum": 0 }
          }, "additionalProperties": false
        }
      }, "required": ["type", "payload"]
    },
    {
      "properties": { "type": { "const": "terminate" } },
      "required": ["type"]
    }
  ],
  "additionalProperties": false
}
Use code with caution.
Json
Clarification Notes:
instanceof: "OffscreenCanvas": JS runtime type hint.
payload.sample / options: Generic objects for v0.1.1 flexibility. TODO: Define specific DataSample schemas in v0.2 (RFC #19).
Example Sequence: See ADR-002 document.
3. getTimeseriesMatrix Request Payload
Purpose: JSON payload for the getTimeseriesMatrix Tauri command.
JSON Schema:
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Timeseries Matrix Request Payload (v0.1.1)",
  "description": "Payload for the getTimeseriesMatrix Tauri command.",
  "type": "object", "required": ["sourceId", "axis", "indices"],
  "properties": {
    "sourceId": { "type": "string" },
    "axis":     { "enum": ["voxel", "vertex"] },
    "indices":  { "description": "0-based linear indices (sent as binary Uint32Array).", "type": "array", "items": { "type": "integer", "minimum": 0 } },
    "agg":      { "enum": ["none", "mean", "median"], "default": "none" }
  }, "additionalProperties": false
}
Use code with caution.
Json
Example (Logical):
{ "sourceId": "func-bold-run1", "axis": "voxel", "indices": [1024, 1025, ...], "agg": "none" }
Use code with caution.
Json
4. getTimeseriesMatrix Response Payload
Purpose: JSON payload returned by the getTimeseriesMatrix command on success.
JSON Schema:
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Timeseries Matrix Response Payload (v0.1.1)",
  "description": "Payload returned by the getTimeseriesMatrix Tauri command.",
  "type": "object", "required": ["data", "shape", "dtype"],
  "properties": {
    "data":  { "description": "Binary data buffer (SAB/ArrayBuffer) [N x T, row-major].", "contentMediaType": "application/octet-stream" },
    "shape": { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "integer", "minimum": 1 } },
    "dtype": { "enum": ["float32", "float64", "int16", "int32", "uint8", "uint16", "uint32", "int8"] }
  }, "additionalProperties": false
}
Use code with caution.
Json
Example (Logical):
{ "data": "SharedArrayBuffer", "shape": [5, 900], "dtype": "float32" }
Use code with caution.
Json
5. Atlas Label List (within AtlasLayer)
Purpose: Structure of the labels array within an AtlasLayer object.
JSON Schema (Partial for labels property):
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Atlas Layer Labels Structure (v0.1.1)",
  "description": "Structure of the 'labels' array within an AtlasLayer object.",
  "type": "object", "required": ["labels"],
  "properties": {
    "labels": { "type": "array", "items": { "$ref": "#/definitions/AtlasLabel" } }
    // ... other Volume/Surface properties ...
  }, "additionalProperties": true,
  "definitions": {
    "AtlasLabel": {
      "type": "object", "required": ["id", "name", "color"],
      "properties": {
        "id":    { "type": "integer", "minimum": 0 },
        "name":  { "type": "string" },
        "color": { "type": "array", "items": { "type": "number", "minimum": 0, "maximum": 1 }, "minItems": 3, "maxItems": 3 }
      }, "additionalProperties": false
    }
  }
}
Use code with caution.
Json
Example (AtlasLayer - Relevant Parts): See ADR-002 document.
6. brainflow-config.json (User Config)
Purpose: Stores user-specific application preferences.
JSON Schema:
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Brainflow User Config (v0.1.1)",
  "description": "User-specific configuration settings for Brainflow.",
  "type": "object",
  "properties": {
    "theme":         { "enum": ["light", "dark", "system"], "default": "system" },
    "maxVRAMMB":     { "description": "Target VRAM limit (MB) for GPU caches.", "type": "integer", "minimum": 256, "default": 1024 },
    "exampleDataPath": { "type": "string" },
    "recentProjects":  { "type": "array", "items": { "type": "string" }, "maxItems": 10, "default": [] }
  }, "additionalProperties": false
}
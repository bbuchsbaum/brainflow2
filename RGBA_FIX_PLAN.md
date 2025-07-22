# Raw RGBA Fix Plan

## Issue Identified

1. Backend returns `ArrayBuffer` (1048584 bytes - correct size for 512x512 RGBA + 8 byte header)
2. Frontend expects `Uint8Array`
3. The conversion happens inside the raw RGBA path, but `imageData` variable is used later
4. `isRawRGBAFormat` is set to true inside the raw RGBA block, but the logs show it as false

## Root Cause

The variable scoping is wrong. When we have:
```javascript
let imageData: Uint8Array;
let isRawRGBAFormat = false;

if (this.useRawRGBA) {
  try {
    const rawResult = await ...
    imageData = new Uint8Array(rawResult);  // This works
    isRawRGBAFormat = true;  // This should work
  } catch (error) {
    // fallback
  }
}

// Later...
console.log(imageData);  // This might be undefined if conversion failed
console.log(isRawRGBAFormat);  // This might still be false
```

## Solution

The ArrayBuffer to Uint8Array conversion is working, but something else is wrong. The logs suggest that either:
1. An error is being thrown after setting the values
2. The code is being called multiple times and we're seeing logs from different calls
3. There's another code path being taken

## Next Steps

1. Need to see the full console output including any errors
2. Need to verify the conversion is actually happening
3. Need to ensure the raw RGBA decoding path is reached
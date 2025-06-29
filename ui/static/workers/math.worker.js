/**
 * Math computation worker
 * Handles heavy mathematical operations off the main thread
 */

// Message handler
self.onmessage = async function(event) {
  const { id, type, data } = event.data;
  
  try {
    let result;
    
    switch (type) {
      case 'init':
        result = { initialized: true };
        break;
        
      case 'matrix_multiply':
        result = matrixMultiply(data.a, data.b);
        break;
        
      case 'transform_coordinates':
        result = transformCoordinates(data.coords, data.matrix);
        break;
        
      case 'calculate_histogram':
        result = calculateHistogram(data.values, data.bins);
        break;
        
      case 'compute_statistics':
        result = computeStatistics(data.values);
        break;
        
      case 'resample_volume':
        result = resampleVolume(data.volume, data.targetDims);
        break;
        
      case 'apply_threshold':
        result = applyThreshold(data.values, data.lower, data.upper);
        break;
        
      default:
        throw new Error(`Unknown operation: ${type}`);
    }
    
    self.postMessage({ id, type, result });
    
  } catch (error) {
    self.postMessage({ 
      id, 
      type, 
      error: error.message || 'Worker computation failed' 
    });
  }
};

// Matrix multiplication
function matrixMultiply(a, b) {
  const aRows = a.length;
  const aCols = a[0].length;
  const bRows = b.length;
  const bCols = b[0].length;
  
  if (aCols !== bRows) {
    throw new Error('Matrix dimensions do not match for multiplication');
  }
  
  const result = new Array(aRows);
  
  for (let i = 0; i < aRows; i++) {
    result[i] = new Array(bCols);
    for (let j = 0; j < bCols; j++) {
      let sum = 0;
      for (let k = 0; k < aCols; k++) {
        sum += a[i][k] * b[k][j];
      }
      result[i][j] = sum;
    }
  }
  
  return result;
}

// Transform 3D coordinates using 4x4 matrix
function transformCoordinates(coords, matrix) {
  const result = new Float32Array(coords.length);
  
  for (let i = 0; i < coords.length; i += 3) {
    const x = coords[i];
    const y = coords[i + 1];
    const z = coords[i + 2];
    
    result[i] = matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3];
    result[i + 1] = matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7];
    result[i + 2] = matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11];
  }
  
  return result;
}

// Calculate histogram
function calculateHistogram(values, numBins = 256) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const binSize = range / numBins;
  
  const histogram = new Uint32Array(numBins);
  
  for (const value of values) {
    const bin = Math.min(
      Math.floor((value - min) / binSize),
      numBins - 1
    );
    histogram[bin]++;
  }
  
  return {
    histogram,
    min,
    max,
    binSize,
    numBins
  };
}

// Compute statistics
function computeStatistics(values) {
  const n = values.length;
  if (n === 0) return null;
  
  // Sort for percentiles
  const sorted = Float32Array.from(values).sort((a, b) => a - b);
  
  // Basic stats
  let sum = 0;
  let sumSq = 0;
  
  for (const val of values) {
    sum += val;
    sumSq += val * val;
  }
  
  const mean = sum / n;
  const variance = (sumSq / n) - (mean * mean);
  const stdDev = Math.sqrt(variance);
  
  // Percentiles
  const percentile = (p) => {
    const index = (p / 100) * (n - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };
  
  return {
    count: n,
    mean,
    stdDev,
    variance,
    min: sorted[0],
    max: sorted[n - 1],
    median: percentile(50),
    q1: percentile(25),
    q3: percentile(75),
    p5: percentile(5),
    p95: percentile(95)
  };
}

// Resample volume (simple nearest neighbor for now)
function resampleVolume(volume, targetDims) {
  const { data, dims } = volume;
  const [sx, sy, sz] = dims;
  const [tx, ty, tz] = targetDims;
  
  const result = new Float32Array(tx * ty * tz);
  
  const scaleX = sx / tx;
  const scaleY = sy / ty;
  const scaleZ = sz / tz;
  
  for (let z = 0; z < tz; z++) {
    for (let y = 0; y < ty; y++) {
      for (let x = 0; x < tx; x++) {
        // Nearest neighbor sampling
        const sx_idx = Math.round(x * scaleX);
        const sy_idx = Math.round(y * scaleY);
        const sz_idx = Math.round(z * scaleZ);
        
        const srcIdx = sx_idx + sy_idx * sx + sz_idx * sx * sy;
        const dstIdx = x + y * tx + z * tx * ty;
        
        result[dstIdx] = data[srcIdx];
      }
    }
  }
  
  return {
    data: result,
    dims: targetDims
  };
}

// Apply threshold
function applyThreshold(values, lower = -Infinity, upper = Infinity) {
  const result = new Float32Array(values.length);
  let count = 0;
  
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (val >= lower && val <= upper) {
      result[i] = val;
      count++;
    } else {
      result[i] = 0;
    }
  }
  
  return {
    data: result,
    count,
    percentage: (count / values.length) * 100
  };
}
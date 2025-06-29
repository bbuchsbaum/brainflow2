import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

interface RenderValidation {
  hasContent: boolean;
  averageBrightness: number;
  pixelStats: {
    black: number;
    nonBlack: number;
    total: number;
  };
  colorChannels: {
    red: number;
    green: number;
    blue: number;
  };
}

/**
 * Validate GPU rendering output from a screenshot
 */
export async function validateGPURendering(screenshot: Buffer): Promise<RenderValidation> {
  return new Promise((resolve, reject) => {
    const png = new PNG();
    
    png.parse(screenshot, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      
      let blackPixels = 0;
      let totalRed = 0;
      let totalGreen = 0;
      let totalBlue = 0;
      let totalBrightness = 0;
      
      const pixelCount = data.width * data.height;
      
      for (let i = 0; i < data.data.length; i += 4) {
        const r = data.data[i];
        const g = data.data[i + 1];
        const b = data.data[i + 2];
        const a = data.data[i + 3];
        
        // Check if pixel is black
        if (r === 0 && g === 0 && b === 0) {
          blackPixels++;
        }
        
        // Calculate brightness (simple average)
        const brightness = (r + g + b) / 3 / 255;
        totalBrightness += brightness;
        
        // Sum color channels
        totalRed += r;
        totalGreen += g;
        totalBlue += b;
      }
      
      const validation: RenderValidation = {
        hasContent: blackPixels < pixelCount * 0.95, // Less than 95% black
        averageBrightness: totalBrightness / pixelCount,
        pixelStats: {
          black: blackPixels,
          nonBlack: pixelCount - blackPixels,
          total: pixelCount
        },
        colorChannels: {
          red: totalRed / pixelCount / 255,
          green: totalGreen / pixelCount / 255,
          blue: totalBlue / pixelCount / 255
        }
      };
      
      resolve(validation);
    });
  });
}

/**
 * Compare two screenshots for differences
 */
export async function compareScreenshots(
  screenshot1Path: string,
  screenshot2Path: string,
  threshold = 0.1
): Promise<boolean> {
  const screenshotDir = path.join(__dirname, '../screenshots');
  const path1 = path.join(screenshotDir, screenshot1Path);
  const path2 = path.join(screenshotDir, screenshot2Path);
  
  if (!fs.existsSync(path1) || !fs.existsSync(path2)) {
    throw new Error('Screenshot files not found');
  }
  
  const img1 = PNG.sync.read(fs.readFileSync(path1));
  const img2 = PNG.sync.read(fs.readFileSync(path2));
  
  if (img1.width !== img2.width || img1.height !== img2.height) {
    return true; // Different sizes means different
  }
  
  let diffPixels = 0;
  const totalPixels = img1.width * img1.height;
  
  for (let i = 0; i < img1.data.length; i += 4) {
    const r1 = img1.data[i];
    const g1 = img1.data[i + 1];
    const b1 = img1.data[i + 2];
    
    const r2 = img2.data[i];
    const g2 = img2.data[i + 1];
    const b2 = img2.data[i + 2];
    
    // Calculate color difference
    const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
    if (diff > threshold * 255 * 3) {
      diffPixels++;
    }
  }
  
  // Return true if more than 5% of pixels are different
  return diffPixels > totalPixels * 0.05;
}

/**
 * Extract render timing from GPU
 */
export async function extractGPUMetrics(page: any): Promise<any> {
  return await page.evaluate(() => {
    // Try to access WebGPU metrics if available
    if ((navigator as any).gpu) {
      // This would need actual GPU metrics API
      return {
        available: true,
        vendor: 'WebGPU',
      };
    }
    
    // Try WebGL as fallback
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    
    if (gl) {
      return {
        available: true,
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
      };
    }
    
    return { available: false };
  });
}

/**
 * Validate specific rendering features
 */
export async function validateRenderingFeatures(screenshot: Buffer): Promise<{
  hasGradients: boolean;
  hasSharpEdges: boolean;
  colorVariety: number;
}> {
  const validation = await validateGPURendering(screenshot);
  
  // Simple heuristics for feature detection
  return {
    // Gradients would show smooth brightness variations
    hasGradients: validation.averageBrightness > 0.1 && validation.averageBrightness < 0.9,
    
    // Sharp edges would show high contrast (this is simplified)
    hasSharpEdges: validation.pixelStats.nonBlack > validation.pixelStats.total * 0.1,
    
    // Color variety based on channel differences
    colorVariety: Math.abs(validation.colorChannels.red - validation.colorChannels.green) +
                  Math.abs(validation.colorChannels.green - validation.colorChannels.blue) +
                  Math.abs(validation.colorChannels.blue - validation.colorChannels.red)
  };
}
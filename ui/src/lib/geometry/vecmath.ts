/**
 * Vector math utilities
 */
import type { Vec3, Vec2, Mat3, Mat4 } from './types';

// Vector operations
export const vec3 = {
  /** Create a new vector */
  create: (x = 0, y = 0, z = 0): Vec3 => [x, y, z],
  
  /** Add two vectors */
  add: (a: Vec3, b: Vec3): Vec3 => [
    a[0] + b[0],
    a[1] + b[1],
    a[2] + b[2]
  ],
  
  /** Subtract b from a */
  sub: (a: Vec3, b: Vec3): Vec3 => [
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2]
  ],
  
  /** Scale a vector by a scalar */
  scale: (v: Vec3, s: number): Vec3 => [
    v[0] * s,
    v[1] * s,
    v[2] * s
  ],
  
  /** Dot product */
  dot: (a: Vec3, b: Vec3): number => 
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  
  /** Cross product */
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ],
  
  /** Vector length */
  length: (v: Vec3): number => 
    Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]),
  
  /** Normalize to unit length */
  normalize: (v: Vec3): Vec3 => {
    const len = vec3.length(v);
    return len > 0 ? vec3.scale(v, 1 / len) : [0, 0, 0];
  },
  
  /** Linear interpolation */
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ],
  
  /** Distance between two points */
  distance: (a: Vec3, b: Vec3): number => 
    vec3.length(vec3.sub(b, a)),
  
  /** Check if approximately equal */
  equals: (a: Vec3, b: Vec3, epsilon = 1e-6): boolean =>
    Math.abs(a[0] - b[0]) < epsilon &&
    Math.abs(a[1] - b[1]) < epsilon &&
    Math.abs(a[2] - b[2]) < epsilon,
  
  /** Apply 3x3 matrix transform */
  transformMat3: (v: Vec3, m: Mat3): Vec3 => [
    v[0] * m[0][0] + v[1] * m[0][1] + v[2] * m[0][2],
    v[0] * m[1][0] + v[1] * m[1][1] + v[2] * m[1][2],
    v[0] * m[2][0] + v[1] * m[2][1] + v[2] * m[2][2]
  ],
  
  /** Apply 4x4 matrix transform (w=1) */
  transformMat4: (v: Vec3, m: Mat4): Vec3 => {
    const x = v[0] * m[0][0] + v[1] * m[0][1] + v[2] * m[0][2] + m[0][3];
    const y = v[0] * m[1][0] + v[1] * m[1][1] + v[2] * m[1][2] + m[1][3];
    const z = v[0] * m[2][0] + v[1] * m[2][1] + v[2] * m[2][2] + m[2][3];
    const w = v[0] * m[3][0] + v[1] * m[3][1] + v[2] * m[3][2] + m[3][3];
    return [x / w, y / w, z / w];
  }
};

// 2D vector operations
export const vec2 = {
  create: (x = 0, y = 0): Vec2 => ({ x, y }),
  add: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y }),
  scale: (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s }),
  length: (v: Vec2): number => Math.sqrt(v.x * v.x + v.y * v.y),
  normalize: (v: Vec2): Vec2 => {
    const len = vec2.length(v);
    return len > 0 ? vec2.scale(v, 1 / len) : { x: 0, y: 0 };
  }
};

// Matrix operations
export const mat3 = {
  /** Create identity matrix */
  identity: (): Mat3 => [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ],
  
  /** Matrix multiply */
  multiply: (a: Mat3, b: Mat3): Mat3 => {
    const result: Mat3 = [[0,0,0], [0,0,0], [0,0,0]];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) {
          result[i][j] += a[i][k] * b[k][j];
        }
      }
    }
    return result;
  },
  
  /** Transpose matrix */
  transpose: (m: Mat3): Mat3 => [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]]
  ]
};

export const mat4 = {
  /** Create identity matrix */
  identity: (): Mat4 => [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1]
  ],
  
  /** Create from 3x3 rotation and translation */
  fromRotationTranslation: (rot: Mat3, trans: Vec3): Mat4 => [
    [rot[0][0], rot[0][1], rot[0][2], trans[0]],
    [rot[1][0], rot[1][1], rot[1][2], trans[1]],
    [rot[2][0], rot[2][1], rot[2][2], trans[2]],
    [0, 0, 0, 1]
  ],
  
  /** Matrix multiply */
  multiply: (a: Mat4, b: Mat4): Mat4 => {
    const result: Mat4 = [[0,0,0,0], [0,0,0,0], [0,0,0,0], [0,0,0,0]];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          result[i][j] += a[i][k] * b[k][j];
        }
      }
    }
    return result;
  },
  
  /** Invert matrix */
  invert: (m: Mat4): Mat4 | null => {
    // Simplified 4x4 matrix inversion for affine transforms
    // Assumes last row is [0, 0, 0, 1]
    const [
      [m00, m01, m02, m03],
      [m10, m11, m12, m13],
      [m20, m21, m22, m23],
      [m30, m31, m32, m33]
    ] = m;
    
    // Check if it's an affine transform
    if (m30 !== 0 || m31 !== 0 || m32 !== 0 || m33 !== 1) {
      // Full 4x4 inversion would be needed here
      // For now, return null for non-affine transforms
      return null;
    }
    
    // Calculate determinant of the 3x3 rotation part
    const det = m00 * (m11 * m22 - m12 * m21) -
                m01 * (m10 * m22 - m12 * m20) +
                m02 * (m10 * m21 - m11 * m20);
    
    if (Math.abs(det) < 1e-8) return null;
    
    // Invert the 3x3 rotation part
    const invDet = 1 / det;
    const r00 = (m11 * m22 - m12 * m21) * invDet;
    const r01 = (m02 * m21 - m01 * m22) * invDet;
    const r02 = (m01 * m12 - m02 * m11) * invDet;
    const r10 = (m12 * m20 - m10 * m22) * invDet;
    const r11 = (m00 * m22 - m02 * m20) * invDet;
    const r12 = (m02 * m10 - m00 * m12) * invDet;
    const r20 = (m10 * m21 - m11 * m20) * invDet;
    const r21 = (m01 * m20 - m00 * m21) * invDet;
    const r22 = (m00 * m11 - m01 * m10) * invDet;
    
    // Calculate inverted translation
    const tx = -(r00 * m03 + r01 * m13 + r02 * m23);
    const ty = -(r10 * m03 + r11 * m13 + r12 * m23);
    const tz = -(r20 * m03 + r21 * m13 + r22 * m23);
    
    return [
      [r00, r01, r02, tx],
      [r10, r11, r12, ty],
      [r20, r21, r22, tz],
      [0, 0, 0, 1]
    ];
  }
};
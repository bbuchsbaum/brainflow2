/**
 * Vector math utilities for object-based vectors
 * These work with Vec3 as { x, y, z } instead of [x, y, z]
 */
import type { Vec3, Vec2, Mat3, Mat4 } from './types';

// Vector operations for object-based Vec3
export const vec3 = {
  /** Create a new vector */
  create: (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z }),
  
  /** Add two vectors */
  add: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z
  }),
  
  /** Subtract b from a */
  sub: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z
  }),
  
  /** Scale a vector by a scalar */
  scale: (v: Vec3, s: number): Vec3 => ({
    x: v.x * s,
    y: v.y * s,
    z: v.z * s
  }),
  
  /** Dot product */
  dot: (a: Vec3, b: Vec3): number => 
    a.x * b.x + a.y * b.y + a.z * b.z,
  
  /** Cross product */
  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  }),
  
  /** Vector length */
  length: (v: Vec3): number => 
    Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
  
  /** Normalize to unit length */
  normalize: (v: Vec3): Vec3 => {
    const len = vec3.length(v);
    return len > 0 ? vec3.scale(v, 1 / len) : { x: 0, y: 0, z: 0 };
  },
  
  /** Linear interpolation */
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t
  }),
  
  /** Convert to array format */
  toArray: (v: Vec3): [number, number, number] => [v.x, v.y, v.z],
  
  /** Convert from array format */
  fromArray: (arr: [number, number, number]): Vec3 => ({
    x: arr[0],
    y: arr[1],
    z: arr[2]
  })
};

// Vector operations for Vec2
export const vec2 = {
  /** Create a new 2D vector */
  create: (x = 0, y = 0): Vec2 => ({ x, y }),
  
  /** Add two vectors */
  add: (a: Vec2, b: Vec2): Vec2 => ({
    x: a.x + b.x,
    y: a.y + b.y
  }),
  
  /** Subtract b from a */
  sub: (a: Vec2, b: Vec2): Vec2 => ({
    x: a.x - b.x,
    y: a.y - b.y
  }),
  
  /** Scale a vector by a scalar */
  scale: (v: Vec2, s: number): Vec2 => ({
    x: v.x * s,
    y: v.y * s
  }),
  
  /** Dot product */
  dot: (a: Vec2, b: Vec2): number => 
    a.x * b.x + a.y * b.y,
  
  /** Vector length */
  length: (v: Vec2): number => 
    Math.sqrt(v.x * v.x + v.y * v.y),
  
  /** Normalize to unit length */
  normalize: (v: Vec2): Vec2 => {
    const len = vec2.length(v);
    return len > 0 ? vec2.scale(v, 1 / len) : { x: 0, y: 0 };
  }
};

// Matrix operations (keep same as before)
export const mat3 = {
  /** Create identity matrix */
  identity: (): Mat3 => [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ],
  
  /** Create rotation matrix around X axis */
  rotateX: (angle: number): Mat3 => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      [1, 0, 0],
      [0, c, -s],
      [0, s, c]
    ];
  },
  
  /** Create rotation matrix around Y axis */
  rotateY: (angle: number): Mat3 => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      [c, 0, s],
      [0, 1, 0],
      [-s, 0, c]
    ];
  },
  
  /** Create rotation matrix around Z axis */
  rotateZ: (angle: number): Mat3 => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      [c, -s, 0],
      [s, c, 0],
      [0, 0, 1]
    ];
  },
  
  /** Multiply matrix by vector */
  mulVec3: (m: Mat3, v: Vec3): Vec3 => ({
    x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
    y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
    z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z
  }),
  
  /** Multiply two matrices */
  mul: (a: Mat3, b: Mat3): Mat3 => {
    const result: Mat3 = [[0,0,0], [0,0,0], [0,0,0]];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) {
          result[i][j] += a[i][k] * b[k][j];
        }
      }
    }
    return result;
  }
};

// 4x4 Matrix operations
export const mat4 = {
  /** Create identity matrix */
  identity: (): Mat4 => [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1]
  ],
  
  /** Create translation matrix */
  translation: (v: Vec3): Mat4 => [
    [1, 0, 0, v.x],
    [0, 1, 0, v.y],
    [0, 0, 1, v.z],
    [0, 0, 0, 1]
  ],
  
  /** Create scale matrix */
  scale: (s: Vec3): Mat4 => [
    [s.x, 0, 0, 0],
    [0, s.y, 0, 0],
    [0, 0, s.z, 0],
    [0, 0, 0, 1]
  ],
  
  /** Multiply matrix by vector (homogeneous) */
  mulVec4: (m: Mat4, v: [number, number, number, number]): [number, number, number, number] => [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3] * v[3],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3] * v[3],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3] * v[3],
    m[3][0] * v[0] + m[3][1] * v[1] + m[3][2] * v[2] + m[3][3] * v[3]
  ],
  
  /** Transform a point (w=1) */
  transformPoint: (m: Mat4, p: Vec3): Vec3 => {
    const v = mat4.mulVec4(m, [p.x, p.y, p.z, 1]);
    return {
      x: v[0] / v[3],
      y: v[1] / v[3],
      z: v[2] / v[3]
    };
  },
  
  /** Transform a vector (w=0) */
  transformVector: (m: Mat4, v: Vec3): Vec3 => {
    const result = mat4.mulVec4(m, [v.x, v.y, v.z, 0]);
    return {
      x: result[0],
      y: result[1],
      z: result[2]
    };
  },
  
  /** Multiply two matrices */
  mul: (a: Mat4, b: Mat4): Mat4 => {
    const result: Mat4 = [
      [0,0,0,0], [0,0,0,0], [0,0,0,0], [0,0,0,0]
    ];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          result[i][j] += a[i][k] * b[k][j];
        }
      }
    }
    return result;
  }
};

// Helper to convert Mat4 to flat array for GPU
export function mat4ToArray(m: Mat4): number[] {
  return [
    m[0][0], m[0][1], m[0][2], m[0][3],
    m[1][0], m[1][1], m[1][2], m[1][3],
    m[2][0], m[2][1], m[2][2], m[2][3],
    m[3][0], m[3][1], m[3][2], m[3][3]
  ];
}
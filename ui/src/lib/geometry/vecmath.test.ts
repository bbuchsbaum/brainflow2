/**
 * Unit tests for vector math utilities
 */
import { describe, it, expect } from 'vitest';
import { vec3, vec2, mat3, mat4 } from './vecmath';

describe('vec3', () => {
  it('should create vectors', () => {
    expect(vec3.create()).toEqual([0, 0, 0]);
    expect(vec3.create(1, 2, 3)).toEqual([1, 2, 3]);
  });

  it('should add vectors', () => {
    const a = [1, 2, 3] as [number, number, number];
    const b = [4, 5, 6] as [number, number, number];
    expect(vec3.add(a, b)).toEqual([5, 7, 9]);
  });

  it('should subtract vectors', () => {
    const a = [4, 5, 6] as [number, number, number];
    const b = [1, 2, 3] as [number, number, number];
    expect(vec3.sub(a, b)).toEqual([3, 3, 3]);
  });

  it('should scale vectors', () => {
    const v = [1, 2, 3] as [number, number, number];
    expect(vec3.scale(v, 2)).toEqual([2, 4, 6]);
    expect(vec3.scale(v, -1)).toEqual([-1, -2, -3]);
    expect(vec3.scale(v, 0)).toEqual([0, 0, 0]);
  });

  it('should calculate dot product', () => {
    const a = [1, 2, 3] as [number, number, number];
    const b = [4, 5, 6] as [number, number, number];
    expect(vec3.dot(a, b)).toBe(32); // 1*4 + 2*5 + 3*6

    // Orthogonal vectors
    const x = [1, 0, 0] as [number, number, number];
    const y = [0, 1, 0] as [number, number, number];
    expect(vec3.dot(x, y)).toBe(0);
  });

  it('should calculate cross product', () => {
    const x = [1, 0, 0] as [number, number, number];
    const y = [0, 1, 0] as [number, number, number];
    const z = [0, 0, 1] as [number, number, number];

    expect(vec3.cross(x, y)).toEqual(z);
    expect(vec3.cross(y, z)).toEqual(x);
    expect(vec3.cross(z, x)).toEqual(y);

    // Anti-commutative
    expect(vec3.cross(y, x)).toEqual([0, 0, -1]);
  });

  it('should calculate vector length', () => {
    expect(vec3.length([3, 4, 0])).toBe(5);
    expect(vec3.length([1, 0, 0])).toBe(1);
    expect(vec3.length([0, 0, 0])).toBe(0);
    expect(vec3.length([1, 1, 1])).toBeCloseTo(Math.sqrt(3));
  });

  it('should normalize vectors', () => {
    const v = [3, 4, 0] as [number, number, number];
    const normalized = vec3.normalize(v);
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[1]).toBeCloseTo(0.8);
    expect(normalized[2]).toBeCloseTo(0);
    expect(vec3.length(normalized)).toBeCloseTo(1);

    // Zero vector
    expect(vec3.normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('should interpolate vectors', () => {
    const a = [0, 0, 0] as [number, number, number];
    const b = [10, 20, 30] as [number, number, number];

    expect(vec3.lerp(a, b, 0)).toEqual(a);
    expect(vec3.lerp(a, b, 1)).toEqual(b);
    expect(vec3.lerp(a, b, 0.5)).toEqual([5, 10, 15]);
    expect(vec3.lerp(a, b, 0.25)).toEqual([2.5, 5, 7.5]);
  });

  it('should calculate distance', () => {
    const a = [0, 0, 0] as [number, number, number];
    const b = [3, 4, 0] as [number, number, number];
    expect(vec3.distance(a, b)).toBe(5);

    const c = [1, 1, 1] as [number, number, number];
    const d = [2, 2, 2] as [number, number, number];
    expect(vec3.distance(c, d)).toBeCloseTo(Math.sqrt(3));
  });

  it('should check equality', () => {
    const a = [1, 2, 3] as [number, number, number];
    const b = [1, 2, 3] as [number, number, number];
    const c = [1.0000001, 2, 3] as [number, number, number];

    expect(vec3.equals(a, b)).toBe(true);
    expect(vec3.equals(a, c)).toBe(true); // Within epsilon
    expect(vec3.equals(a, c, 1e-7)).toBe(false); // Tighter epsilon
  });

  it('should transform by mat3', () => {
    const v = [1, 0, 0] as [number, number, number];
    
    // 90 degree rotation around Z (counterclockwise)
    // Row-major order: each inner array is a row
    const rot90z: mat3.Mat3 = [
      [0, -1, 0],  // First row
      [1, 0, 0],   // Second row
      [0, 0, 1]    // Third row
    ];
    
    expect(vec3.transformMat3(v, rot90z)).toEqual([0, 1, 0]);
    
    // Identity
    expect(vec3.transformMat3(v, mat3.identity())).toEqual(v);
  });

  it('should transform by mat4', () => {
    const v = [1, 2, 3] as [number, number, number];
    
    // Translation matrix (row-major)
    const translate: mat4.Mat4 = [
      [1, 0, 0, 10],  // X translation
      [0, 1, 0, 20],  // Y translation
      [0, 0, 1, 30],  // Z translation
      [0, 0, 0, 1]    // Homogeneous
    ];
    
    expect(vec3.transformMat4(v, translate)).toEqual([11, 22, 33]);
    
    // Identity
    expect(vec3.transformMat4(v, mat4.identity())).toEqual(v);
  });
});

describe('vec2', () => {
  it('should create 2D vectors', () => {
    expect(vec2.create()).toEqual({ x: 0, y: 0 });
    expect(vec2.create(3, 4)).toEqual({ x: 3, y: 4 });
  });

  it('should perform 2D operations', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 3, y: 4 };

    expect(vec2.add(a, b)).toEqual({ x: 4, y: 6 });
    expect(vec2.sub(b, a)).toEqual({ x: 2, y: 2 });
    expect(vec2.scale(a, 3)).toEqual({ x: 3, y: 6 });
    expect(vec2.length({ x: 3, y: 4 })).toBe(5);
    
    const normalized = vec2.normalize({ x: 3, y: 4 });
    expect(normalized.x).toBeCloseTo(0.6);
    expect(normalized.y).toBeCloseTo(0.8);
  });
});

describe('mat3', () => {
  it('should create identity matrix', () => {
    const I = mat3.identity();
    expect(I).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ]);
  });

  it('should multiply matrices', () => {
    const A: mat3.Mat3 = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9]
    ];
    
    const I = mat3.identity();
    const result = mat3.multiply(A, I);
    
    // A * I = A
    expect(result).toEqual(A);
    
    // Test specific multiplication
    const B: mat3.Mat3 = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2]
    ];
    
    const scaled = mat3.multiply(A, B);
    expect(scaled[0][0]).toBe(2); // 1*2 + 2*0 + 3*0
    expect(scaled[1][1]).toBe(10); // 4*0 + 5*2 + 6*0
  });

  it('should transpose matrix', () => {
    const A: mat3.Mat3 = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9]
    ];
    
    const At = mat3.transpose(A);
    expect(At).toEqual([
      [1, 4, 7],
      [2, 5, 8],
      [3, 6, 9]
    ]);
    
    // Transpose of transpose is original
    expect(mat3.transpose(At)).toEqual(A);
  });
});

describe('mat4', () => {
  it('should create identity matrix', () => {
    const I = mat4.identity();
    expect(I[0][0]).toBe(1);
    expect(I[1][1]).toBe(1);
    expect(I[2][2]).toBe(1);
    expect(I[3][3]).toBe(1);
    expect(I[0][1]).toBe(0);
  });

  it('should create from rotation and translation', () => {
    const rot: mat3.Mat3 = mat3.identity();
    const trans: vec3.Vec3 = [10, 20, 30];
    
    const M = mat4.fromRotationTranslation(rot, trans);
    
    // Check rotation part
    expect(M[0][0]).toBe(1);
    expect(M[1][1]).toBe(1);
    expect(M[2][2]).toBe(1);
    
    // Check translation part (in last column)
    expect(M[0][3]).toBe(10);
    expect(M[1][3]).toBe(20);
    expect(M[2][3]).toBe(30);
    expect(M[3][3]).toBe(1);
  });

  it('should multiply 4x4 matrices', () => {
    const A = mat4.identity();
    const B = mat4.identity();
    
    const result = mat4.multiply(A, B);
    expect(result).toEqual(mat4.identity());
  });

  it('should invert simple matrices', () => {
    // Translation matrix (row-major)
    const T: mat4.Mat4 = [
      [1, 0, 0, 5],   // X translation = 5
      [0, 1, 0, 10],  // Y translation = 10
      [0, 0, 1, 15],  // Z translation = 15
      [0, 0, 0, 1]
    ];
    
    const Tinv = mat4.invert(T);
    expect(Tinv).not.toBeNull();
    
    if (Tinv) {
      // Inverse translation should negate the translation
      expect(Tinv[0][3]).toBe(-5);
      expect(Tinv[1][3]).toBe(-10);
      expect(Tinv[2][3]).toBe(-15);
      
      // T * T^-1 should be identity
      const I = mat4.multiply(T, Tinv);
      expect(I[0][0]).toBeCloseTo(1);
      expect(I[1][1]).toBeCloseTo(1);
      expect(I[2][2]).toBeCloseTo(1);
      expect(I[3][3]).toBeCloseTo(1);
      expect(I[0][1]).toBeCloseTo(0);
    }
  });

  it('should return null for singular matrices', () => {
    // Singular matrix (all zeros)
    const singular: mat4.Mat4 = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1]
    ];
    
    expect(mat4.invert(singular)).toBeNull();
  });
});
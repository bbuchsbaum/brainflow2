/** Nearest categorical sampling in anatomical world space. No renderer or host state. */
export function sampleVolumeLabels(vertices, values, dims, affine) {
    const [nx, ny, nz] = dims;
    if (dims.some((n) => !Number.isSafeInteger(n) || n <= 0) || nx * ny * nz !== values.length)
        throw new Error('Label volume dimensions do not match its values.');
    if (vertices.length % 3 || !vertices.every(Number.isFinite))
        throw new Error('Surface vertices must be finite world-coordinate triples.');
    if (affine.length !== 16 ||
        !affine.every(Number.isFinite) ||
        affine[3] !== 0 ||
        affine[7] !== 0 ||
        affine[11] !== 0 ||
        affine[15] !== 1)
        throw new Error('Label projection requires a finite voxel-to-world affine.');
    const inverse = invertLinearPart(affine, 'Label');
    const labels = new Uint32Array(vertices.length / 3);
    for (let v = 0; v < labels.length; v++) {
        const x = vertices[3 * v] - affine[12], y = vertices[3 * v + 1] - affine[13], z = vertices[3 * v + 2] - affine[14];
        const ix = Math.floor(inverse[0] * x + inverse[1] * y + inverse[2] * z + 0.5);
        const iy = Math.floor(inverse[3] * x + inverse[4] * y + inverse[5] * z + 0.5);
        const iz = Math.floor(inverse[6] * x + inverse[7] * y + inverse[8] * z + 0.5);
        // Half-voxel support is [-0.5, n-0.5); outside is background, never edge clamping.
        if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz)
            continue;
        const label = values[ix + nx * (iy + ny * iz)];
        if (!Number.isInteger(label) || label < 0 || label > 0xffffffff)
            throw new Error('Categorical projection requires unsigned integer labels.');
        labels[v] = label;
    }
    return labels;
}
/**
 * Invert a voxel-to-world affine's linear part in double precision, keeping
 * its translation separate. Supports rotations, reflections and shear.
 */
function invertLinearPart(affine, what) {
    const [a, b, c, d, e, f, g, h, i] = [
        affine[0],
        affine[4],
        affine[8],
        affine[1],
        affine[5],
        affine[9],
        affine[2],
        affine[6],
        affine[10],
    ];
    const inverse = [
        e * i - f * h,
        c * h - b * i,
        b * f - c * e,
        f * g - d * i,
        a * i - c * g,
        c * d - a * f,
        d * h - e * g,
        b * g - a * h,
        a * e - b * d,
    ];
    const determinant = a * inverse[0] + b * inverse[3] + c * inverse[6];
    if (!Number.isFinite(determinant) || determinant === 0)
        throw new Error(`${what} projection requires an invertible affine.`);
    for (let n = 0; n < 9; n++)
        inverse[n] /= determinant;
    if (!inverse.every(Number.isFinite))
        throw new Error(`${what} projection affine inverse is not finite.`);
    return inverse;
}
/**
 * Trilinear sampling of a scalar volume at anatomical world vertices (the
 * values a GPU volume-projection layer shows on a folded mesh), for drawing
 * on an inflated or spherical embedding of the same vertices. Outside the
 * volume (beyond half a voxel from its edge centres) is NaN.
 */
export function sampleVolumeLinear(vertices, values, dims, affine) {
    const [nx, ny, nz] = dims;
    if (dims.some((n) => !Number.isSafeInteger(n) || n <= 0) || nx * ny * nz !== values.length)
        throw new Error('Volume dimensions do not match its values.');
    if (vertices.length % 3)
        throw new Error('Surface vertices must be xyz triples.');
    if (affine.length !== 16 || !affine.every(Number.isFinite))
        throw new Error('Volume projection requires a finite voxel-to-world affine.');
    const inverse = invertLinearPart(affine, 'Volume');
    const clampIndex = (value, n) => Math.min(Math.max(value, 0), n - 1);
    const out = new Float32Array(vertices.length / 3);
    for (let v = 0; v < out.length; v++) {
        const x = vertices[3 * v] - affine[12], y = vertices[3 * v + 1] - affine[13], z = vertices[3 * v + 2] - affine[14];
        const fx = inverse[0] * x + inverse[1] * y + inverse[2] * z;
        const fy = inverse[3] * x + inverse[4] * y + inverse[5] * z;
        const fz = inverse[6] * x + inverse[7] * y + inverse[8] * z;
        if (!(fx >= -0.5 && fy >= -0.5 && fz >= -0.5 && fx < nx - 0.5 && fy < ny - 0.5 && fz < nz - 0.5)) {
            out[v] = NaN;
            continue;
        }
        // Clamp to the edge centres inside the half-voxel border.
        const cx = clampIndex(fx, nx), cy = clampIndex(fy, ny), cz = clampIndex(fz, nz);
        const x0 = Math.floor(cx), y0 = Math.floor(cy), z0 = Math.floor(cz);
        const x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1), z1 = Math.min(z0 + 1, nz - 1);
        const tx = cx - x0, ty = cy - y0, tz = cz - z0;
        const at = (i, j, k) => values[i + nx * (j + ny * k)];
        const c00 = at(x0, y0, z0) * (1 - tx) + at(x1, y0, z0) * tx;
        const c10 = at(x0, y1, z0) * (1 - tx) + at(x1, y1, z0) * tx;
        const c01 = at(x0, y0, z1) * (1 - tx) + at(x1, y0, z1) * tx;
        const c11 = at(x0, y1, z1) * (1 - tx) + at(x1, y1, z1) * tx;
        const c0 = c00 * (1 - ty) + c10 * ty;
        const c1 = c01 * (1 - ty) + c11 * ty;
        out[v] = c0 * (1 - tz) + c1 * tz;
    }
    return out;
}
//# sourceMappingURL=volumeLabels.js.map
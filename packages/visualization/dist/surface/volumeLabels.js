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
    // Invert the affine's linear part in double precision, keeping its translation
    // separate. This supports rotations, reflections and shear without rounding IDs.
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
        throw new Error('Label projection requires an invertible affine.');
    for (let n = 0; n < 9; n++)
        inverse[n] /= determinant;
    if (!inverse.every(Number.isFinite))
        throw new Error('Label projection affine inverse is not finite.');
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
//# sourceMappingURL=volumeLabels.js.map
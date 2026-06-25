#!/usr/bin/env python3
"""Generate small NIfTI-1 fixtures for the native-dtype decode tests.

Pure stdlib (no nibabel). Writes 2x2x2 volumes with controlled datatype and
data scaling so the loader's native-vs-f32 dispatch can be exercised:

  unscaled_i16.nii  int16,  scl_slope=1, scl_inter=0  -> loads native VolI16
  unscaled_u8.nii   uint8,  scl_slope=1, scl_inter=0  -> loads native VolU8
  scaled_u16.nii    uint16, scl_slope=0.1             -> stays VolF32 (physical)

Run from anywhere:  python3 test-data/unit/make_dtype_fixtures.py
"""
import struct
import pathlib

HERE = pathlib.Path(__file__).resolve().parent


def build_nii(dims, datatype, bitpix, scl_slope, scl_inter, data_bytes):
    """Return bytes for a minimal little-endian NIfTI-1 (.nii) file."""
    hdr = bytearray(348)
    struct.pack_into("<i", hdr, 0, 348)  # sizeof_hdr
    # dim[8]: dim[0] = ndim, then sizes; unused entries = 1
    dim = [3, dims[0], dims[1], dims[2], 1, 1, 1, 1]
    struct.pack_into("<8h", hdr, 40, *dim)
    struct.pack_into("<h", hdr, 70, datatype)
    struct.pack_into("<h", hdr, 72, bitpix)
    # pixdim[8]: pixdim[0] = qfac, spatial spacings = 1mm
    pixdim = [1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0]
    struct.pack_into("<8f", hdr, 76, *pixdim)
    struct.pack_into("<f", hdr, 108, 352.0)  # vox_offset
    struct.pack_into("<f", hdr, 112, scl_slope)
    struct.pack_into("<f", hdr, 116, scl_inter)
    struct.pack_into("<b", hdr, 123, 2)  # xyzt_units = mm
    struct.pack_into("<h", hdr, 252, 0)  # qform_code
    struct.pack_into("<h", hdr, 254, 1)  # sform_code = scanner
    struct.pack_into("<4f", hdr, 280, 1.0, 0.0, 0.0, 0.0)  # srow_x
    struct.pack_into("<4f", hdr, 296, 0.0, 1.0, 0.0, 0.0)  # srow_y
    struct.pack_into("<4f", hdr, 312, 0.0, 0.0, 1.0, 0.0)  # srow_z
    hdr[344:348] = b"n+1\x00"  # magic
    return bytes(hdr) + b"\x00\x00\x00\x00" + data_bytes  # 348 -> 352, then data


def main():
    dims = (2, 2, 2)
    # x-fastest voxel order
    i16_vals = [10, 20, 30, 40, 50, 60, 70, 80]
    u8_vals = [1, 2, 3, 4, 5, 6, 7, 8]
    u16_raw = [123, 200, 327, 500, 999, 1000, 5, 50]  # *0.1 -> physical floats

    (HERE / "unscaled_i16.nii").write_bytes(
        build_nii(dims, 4, 16, 1.0, 0.0, struct.pack("<8h", *i16_vals))
    )
    (HERE / "unscaled_u8.nii").write_bytes(
        build_nii(dims, 2, 8, 1.0, 0.0, struct.pack("<8B", *u8_vals))
    )
    (HERE / "scaled_u16.nii").write_bytes(
        build_nii(dims, 512, 16, 0.1, 0.0, struct.pack("<8H", *u16_raw))
    )
    print("wrote unscaled_i16.nii, unscaled_u8.nii, scaled_u16.nii to", HERE)


if __name__ == "__main__":
    main()

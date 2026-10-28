"""Generate tiny, public synthetic NIfTI-1 fixtures without third-party packages.

f(i,j,k)=i+10*j+100*k; world=(10-2*j, -7+3*i, 5+4*k).
The rotated anisotropic sform is deliberately independent of viewer code.
"""
from pathlib import Path
import gzip
import json
import struct

root = Path(__file__).resolve().parents[1]
output = root / "test-data/browser"
output.mkdir(exist_ok=True)
header = bytearray(352)
struct.pack_into("<i", header, 0, 348)
struct.pack_into("<8h", header, 40, 3, 5, 7, 9, 1, 1, 1, 1)
struct.pack_into("<hh", header, 70, 16, 32)
struct.pack_into("<8f", header, 76, 1, 3, 2, 4, 1, 1, 1, 1)
struct.pack_into("<ff", header, 108, 352, 1)
header[123] = 2  # spatial units: mm
struct.pack_into("<hh", header, 252, 0, 1)
struct.pack_into("<12f", header, 280, 0, -2, 0, 10, 3, 0, 0, -7, 0, 0, 4, 5)
header[344:348] = b"n+1\0"
values = [float(i + 10*j + 100*k) for k in range(9) for j in range(7) for i in range(5)]
payload = bytes(header) + struct.pack("<315f", *values)
(output / "oblique.nii").write_bytes(payload)
(output / "oblique.nii.gz").write_bytes(gzip.compress(payload, mtime=0))
frame = {
    "views": {}, "crosshair": {"world_mm": [4, -1, 21], "visible": False},
    "requestedView": {"type": "axial", "width": 7, "height": 5,
                      "origin_mm": [11, -8.5, 21, 1], "u_mm": [-14, 0, 0, 0], "v_mm": [0, 15, 0, 0]},
    "layers": [{"id": "base", "volumeId": "browser-1", "visible": True, "opacity": 1,
                "colormap": "gray", "intensity": [0, 864], "threshold": [0, 0], "interpolation": "nearest"}],
}
for view in ["axial", "coronal", "sagittal"]:
    frame["views"][view] = {"origin_mm": [11, -8.5, 21], "u_mm": [-2, 0, 0], "v_mm": [0, 3, 0]}
(output / "frame.json").write_text(json.dumps(frame, indent=2) + "\n")

# Three distinct frames, retaining the same oblique spatial grid.
struct.pack_into("<8h", header, 40, 4, 5, 7, 9, 3, 1, 1, 1)
struct.pack_into("<f", header, 92, 2.0)
header[123] = 10  # mm and seconds
series = [v + 1000*t for t in range(3) for v in values]
payload4d = bytes(header) + struct.pack("<945f", *series)
(output / "oblique4d.nii").write_bytes(payload4d)
(output / "oblique4d.nii.gz").write_bytes(gzip.compress(payload4d, mtime=0))

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

# Sparse categorical IDs deliberately span the shared LUT. Same oblique grid.
label_header = bytearray(header)
struct.pack_into('<8h', label_header, 40, 3, 5, 7, 9, 1, 1, 1, 1)
struct.pack_into('<h', label_header, 68, 1002)  # NIFTI_INTENT_LABEL
label_values = [float([0, 17, 1024, 2047][(i+j) % 4])
                for k in range(9) for j in range(7) for i in range(5)]
label_payload = bytes(label_header) + struct.pack('<315f', *label_values)
(output / 'labels.nii').write_bytes(label_payload)
(output / 'labels.nii.gz').write_bytes(gzip.compress(label_payload, mtime=0))
(output / 'labels.tsv').write_text('index\tname\tcolor\n0\tBackground\t#ffffff\n17\tRegion seventeen\t#ff0000\n1024\tRegion thousand\t#00ff00\n2047\tLast region\t#0000ff\n')

# Closed octahedron with a non-identity GIfTI coordinate transform.
import base64
import zlib
vertices = [(20,0,0),(-20,0,0),(0,20,0),(0,-20,0),(0,0,20),(0,0,-20)]
faces = [(0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5)]
def surface_xml(encoding='ASCII', order='RowMajorOrder', endian='LittleEndian'):
    def array(rows, intent, dtype, fmt, transform=''):
        values = [v for row in rows for v in row] if order == 'RowMajorOrder' else [row[c] for c in range(3) for row in rows]
        data = ' '.join(map(str,values))
        if encoding != 'ASCII':
            binary = struct.pack(('<' if endian == 'LittleEndian' else '>') + str(len(values)) + fmt, *values)
            if encoding == 'GZipBase64Binary': binary = zlib.compress(binary)
            data = base64.b64encode(binary).decode()
        return f'<DataArray Intent="NIFTI_INTENT_{intent}" DataType="NIFTI_TYPE_{dtype}" ArrayIndexingOrder="{order}" Dimensionality="2" Dim0="{len(rows)}" Dim1="3" Encoding="{encoding}" Endian="{endian}">{transform}<Data>{data}</Data></DataArray>'
    transform = '<CoordinateSystemTransformMatrix><DataSpace>NIFTI_XFORM_UNKNOWN</DataSpace><TransformedSpace>NIFTI_XFORM_SCANNER_ANAT</TransformedSpace><MatrixData>0 -2 0 10 3 0 0 20 0 0 4 30 0 0 0 1</MatrixData></CoordinateSystemTransformMatrix>'
    return '<?xml version="1.0"?><GIFTI Version="1.0" NumberOfDataArrays="2"><MetaData><MD><Name>AnatomicalStructurePrimary</Name><Value>CortexLeft</Value></MD></MetaData>' + array(vertices,'POINTSET','FLOAT32','f',transform) + array(faces,'TRIANGLE','INT32','i') + '</GIFTI>'
(output/'octahedron.surf.gii').write_text(surface_xml())
(output/'octahedron-column.surf.gii').write_text(surface_xml('Base64Binary','ColumnMajorOrder','BigEndian'))
(output/'octahedron-zlib.surf.gii').write_text(surface_xml('GZipBase64Binary'))
(output/'octahedron.surf.gii.gz').write_bytes(gzip.compress(surface_xml().encode(),mtime=0))

# Dense per-vertex scalar witness, indexed to the six-vertex octahedron above.
(Path(__file__).resolve().parent.parent / "test-data/browser/octahedron.func.gii").write_text('''<?xml version="1.0"?>
<GIFTI Version="1.0" NumberOfDataArrays="1">
<DataArray Intent="NIFTI_INTENT_TTEST" DataType="NIFTI_TYPE_FLOAT32" ArrayIndexingOrder="RowMajorOrder" Dimensionality="1" Dim0="6" Encoding="ASCII" Endian="LittleEndian"><Data>-3 -1 0 2 4 8</Data></DataArray>
</GIFTI>
''')

#!/usr/bin/env python3
"""Create an explicitly synthetic, importable 80-person NeuroTabs fixture (stdlib only).

Four equal groups: shared +1, opposing +3/-1, minority-driven +10/0,
and spatially displaced focal responses. Outside the ellipsoid is NaN.
The fixture is test anatomy in a declared synthetic space, never MNI anatomy.
"""
import argparse
import csv
import gzip
import hashlib
import json
import math
import struct
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    root = args.destination
    root.mkdir(parents=True, exist_ok=False)
    (root / 'maps').mkdir()
    header = bytearray(352)
    struct.pack_into('<i', header, 0, 348)
    struct.pack_into('<8h', header, 40, 3, 32, 32, 32, 1, 1, 1, 1)
    struct.pack_into('<hh', header, 70, 16, 32)
    struct.pack_into('<8f', header, 76, 1, 2, 2, 2, 1, 1, 1, 1)
    struct.pack_into('<f', header, 108, 352)
    header[123] = 2  # mm
    struct.pack_into('<h', header, 254, 1)
    for axis in range(3):
        row = [0., 0., 0., -31.]
        row[axis] = 2.
        struct.pack_into('<4f', header, 280 + 16 * axis, *row)
    header[344:348] = b'n+1\0'
    rows, resources, digests = [], [], {}
    for i in range(80):
        identity = f'S{i+1:03d}'
        group = ['shared', 'opposing', 'minority', 'displaced'][i // 20]
        values = []
        for z in range(32):
            for y in range(32):
                for x in range(32):
                    inside = ((x-15.5)/13)**2 + ((y-15.5)/15)**2 + ((z-15.5)/12)**2 <= 1
                    value = (1. if i < 20 else (3. if i % 20 < 10 else -1.) if i < 40
                             else (10. if i % 20 < 2 else 0.) if i < 60
                             else 4. * math.exp(-((x-(12 if i % 20 < 10 else 19))**2 + (y-16)**2 + (z-16)**2)/8))
                    values.append(value if inside else float('nan'))
        path = f'maps/{identity}.nii.gz'
        content = gzip.compress(bytes(header) + struct.pack('<32768f', *values), mtime=0)
        (root / path).write_bytes(content)
        digests[identity] = hashlib.sha256(content).hexdigest()
        rows.append([identity, identity, group, identity])
        resources.append([identity, 'nifti', path])
    for name, columns, records in [('observations.csv', ['row_id', 'subject', 'group', 'image'], rows),
                                    ('resources.csv', ['resource_id', 'backend', 'locator'], resources)]:
        with (root / name).open('w', newline='') as handle:
            writer = csv.writer(handle)
            writer.writerow(columns)
            writer.writerows(records)
    manifest = {
        'spec_version': '0.1.0', 'dataset_id': 'synthetic-population-80', 'storage_profile': 'table-package',
        'row_id': 'row_id', 'observation_axes': ['subject'],
        'observation_table': {'path': 'observations.csv', 'format': 'csv'},
        'observation_columns': {name: {'dtype': 'string', 'nullable': False} for name in ['row_id', 'subject', 'group', 'image']},
        'features': {'effect': {'description': 'Synthetic observed effect', 'logical': {
            'kind': 'volume', 'axes': ['x', 'y', 'z'], 'dtype': 'float32', 'shape': [32, 32, 32],
            'support_ref': 'synthetic-grid', 'space': 'synthetic-test-space', 'alignment': 'same_grid'},
            'encodings': [{'type': 'ref', 'binding': {'resource_id': {'column': 'image'}}}]}},
        'resources': {'path': 'resources.csv', 'format': 'csv'},
        'supports': {'synthetic-grid': {'support_type': 'volume', 'support_id': 'synthetic-32-cube',
                                      'space': 'synthetic-test-space', 'grid_id': 'synthetic-2mm'}}}
    (root / 'nftab.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (root / 'expected.json').write_text(json.dumps({'sourceSha256': digests, 'groups': {
        'shared': {'n': 20, 'mean_at_center': 1}, 'opposing': {'n': 20, 'mean_at_center': 1, 'cancellation': 1},
        'minority': {'n': 20, 'mean_at_center': 1}, 'displaced': {'n': 20, 'peaks_voxel_x': [12, 19]}}}, indent=2) + '\n')
    print(root / 'nftab.json')


if __name__ == '__main__':
    main()

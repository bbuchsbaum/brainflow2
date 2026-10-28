import templates from '../../../../core/templates/catalog.json';
import atlases from '../../../../core/atlases/registry.json';
import licenses from '../../../../core/templates/licenses/index.json';
import asegLabels from '../../../../core/atlases/labels/aseg.tsv?raw';
import olsenLabels from '../../../../core/atlases/labels/olsen_mtl.tsv?raw';
import { MAX_SESSION_SOURCE_BYTES } from './sessionSources';

export interface CatalogAsset {
  url: string;
  sourceUrl?: string;
  sha256?: string;
}
export interface BrowserCatalogEntry {
  id: string;
  kind: 'template' | 'atlas';
  name: string;
  description: string;
  space: string;
  citation: string;
  volume: CatalogAsset;
  table?: CatalogAsset & { format?: 'names' };
  tableText?: string;
  tableSource?: string;
  unavailable?: string;
}
export interface CatalogProvenance {
  id: string;
  name: string;
  url: string;
  fetchedFrom: string;
  space: string;
  sha256: string;
  retrievedAt: string;
  citation: string;
  tableUrl?: string;
}
const CBIG =
  'https://raw.githubusercontent.com/ThomasYeoLab/CBIG/634f676630929a71297852d01dd92a287103e861/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal/Parcellations/MNI';
const XCP =
  'https://raw.githubusercontent.com/PennLINC/xcpEngine/d7998c89bf4b77060479f164db8914d30afe5050/atlas/glasser360';
const NEUROATLAS =
  'https://raw.githubusercontent.com/bbuchsbaum/neuroatlas/eb2fc01572f72b600ead6348199f81ada9712880/inst/extdata';
const LABEL_SOURCE =
  'https://github.com/bbuchsbaum/neuroatlas-rs/blob/6f0adb62b858b3799982224fe04394c9e28a38ce/src/atlas';

/** Native and browser hosts consume the same names, IDs, variants and citations. */
export const browserCatalog: BrowserCatalogEntry[] = [
  ...templates.map((entry) => {
    const available = !!entry.checksum && entry.config.space in licenses;
    return {
      id: entry.id,
      kind: 'template' as const,
      name: entry.name,
      description: entry.description,
      space: entry.config.space,
      citation: `TemplateFlow · ${entry.config.space}`,
      volume: {
        url: available ? `catalog-assets/${entry.id}.nii.gz.bin` : entry.download_url,
        sourceUrl: entry.download_url,
        sha256: entry.checksum,
      },
      ...(!available
        ? {
            unavailable:
              entry.id === 'MNI305_T2w_native'
                ? 'The upstream catalog URL is unavailable. Other MNI305 templates remain available.'
                : 'This source is not included in the static catalog. Download the original and open it locally, or use the desktop app.',
          }
        : {}),
    };
  }),
  ...atlases.flatMap((entry): BrowserCatalogEntry[] => {
    const common = {
      kind: 'atlas' as const,
      description: entry.description,
      citation: entry.citation,
    };
    if (entry.id === 'schaefer2018')
      return (entry.parcel_options ?? []).flatMap((parcels) =>
        (entry.network_options ?? []).flatMap((networks) =>
          ['1mm', '2mm'].map((resolution) => ({
            ...common,
            id: `${entry.id}-${parcels}-${networks}-${resolution}`,
            name: `${entry.name} · ${parcels} regions · ${networks} networks · ${resolution}`,
            space: 'FSL MNI152',
            volume: {
              url: `${CBIG}/Schaefer2018_${parcels}Parcels_${networks}Networks_order_FSLMNI152_${resolution}.nii.gz`,
            },
            table: {
              url: `${CBIG}/freeview_lut/Schaefer2018_${parcels}Parcels_${networks}Networks_order.txt`,
            },
          })),
        ),
      );
    if (entry.id === 'glasser2016')
      return [
        {
          ...common,
          id: entry.id,
          name: entry.name,
          space: 'MNI152',
          volume: { url: `${XCP}/glasser360MNI.nii.gz` },
          table: { url: `${XCP}/glasser360NodeNames.txt`, format: 'names' },
        },
      ];
    if (entry.id !== 'freesurfer_aseg' && entry.id !== 'olsen_mtl')
      return [
        {
          ...common,
          id: entry.id,
          name: entry.name,
          space: 'Unspecified',
          volume: { url: '' },
          unavailable: 'No browser asset source is configured for this atlas.',
        },
      ];
    const aseg = entry.id === 'freesurfer_aseg';
    return [
      {
        ...common,
        id: entry.id,
        name: entry.name,
        space: 'MNI152',
        volume: {
          url: `${NEUROATLAS}/${aseg ? 'atlas_aparc_aseg_prob33' : 'Olsen_MNI_MTL_prob33'}.nii.gz`,
        },
        tableText: aseg ? asegLabels : olsenLabels,
        tableSource: aseg
          ? 'https://github.com/bbuchsbaum/neuroatlas/blob/eb2fc01572f72b600ead6348199f81ada9712880/R/aseg_subcort.R'
          : `${LABEL_SOURCE}/olsen_mtl.rs`,
      },
    ];
  }),
];

/** Bounded, cancellable browser acquisition; no native path or persistent data cache. */
export async function fetchCatalogAsset(
  asset: CatalogAsset,
  signal: AbortSignal,
  maxBytes = MAX_SESSION_SOURCE_BYTES,
): Promise<{ file: File; url: string }> {
  const url = new URL(asset.url, document.baseURI);
  if (url.protocol !== 'https:' && url.origin !== location.origin)
    throw new Error('Catalog sources require HTTPS.');
  const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store' });
  if (!response.ok)
    throw new Error(
      `Catalog download failed: HTTP ${response.status} (${url.pathname.split('/').pop()}).`,
    );
  const length = Number(response.headers.get('content-length'));
  if (length > maxBytes) {
    await response.body?.cancel();
    throw new Error('Catalog source exceeds the allowed file size.');
  }
  if (!response.body) throw new Error('Catalog download returned no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Catalog source exceeds the allowed file size.');
      chunks.push(value);
    }
    signal.throwIfAborted();
    if (!size) throw new Error('Catalog download is empty.');
    return {
      file: new File(chunks, new URL(asset.sourceUrl ?? url.href).pathname.split('/').pop()!),
      url: response.url || url.href,
    };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function catalogLabelTable(text: string, format?: 'names'): File {
  const contents =
    format === 'names'
      ? 'index\tname\n' +
        text
          .split(/\r?\n/)
          .flatMap((name, index) => (name.trim() ? [`${index + 1}\t${name.trim()}`] : []))
          .join('\n') +
        '\n'
      : text;
  return new File([contents], 'catalog-labels.tsv', { type: 'text/plain' });
}

export function isCatalogProvenance(value: unknown): value is CatalogProvenance {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CatalogProvenance>;
  const url = (value: unknown) => {
    if (typeof value !== 'string') return false;
    try {
      return ['https:', 'http:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  };
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.name === 'string' &&
    url(item.url) &&
    url(item.fetchedFrom) &&
    (item.tableUrl === undefined || url(item.tableUrl)) &&
    typeof item.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(item.sha256) &&
    typeof item.retrievedAt === 'string' &&
    Number.isFinite(Date.parse(item.retrievedAt)) &&
    typeof item.citation === 'string' &&
    typeof item.space === 'string' &&
    item.space.length > 0
  );
}

import { fileExtension } from '@/utils/formatName';
import type { SpatialFieldSetSummary, StudioMemberSummary } from '@/types/studio';
import type { StudioMetadata } from './studioMetadata';

/**
 * What the Subjects panel shows of a set's design table.
 *
 * A set's members each hold one or more images ("roles" in the store and on
 * the wire; "images" to the user, as in the folder review). A set opened from
 * a folder has a design table synthesized with a `member` id column and a
 * `roles` column listing every member's images, comma separated. Shown raw,
 * that is one long string repeated on every row. This model says instead what
 * the images are once, keeps a per-member cell only when members differ, and
 * offers a quick filter only for a column that partitions the members.
 */

/** The synthesized column that lists each member's images (wire name). */
const IMAGES_COLUMN = 'roles';
/** The synthesized column that repeats each member's id. */
const MEMBER_COLUMN = 'member';

export interface DesignImage {
  /** The image's name as stored: for a folder set, its path under each member. */
  name: string;
  /** The name without the directory and extension every image shares. */
  short: string;
}

export interface DesignMemberImages {
  present: number;
  total: number;
  missing: DesignImage[];
}

export interface DesignTableColumn {
  /** Key into a metadata row; `null` for the images column. */
  key: string | null;
  kind: 'design' | 'member' | 'images';
  /** Header text: the user's own column name, or "Member" / "Images". */
  label: string;
}

export interface DesignPanelModel {
  /** Every image of the set, in name order; empty when the set does not say. */
  images: DesignImage[];
  /** Every member whose images are known has all of them. */
  uniformImages: boolean;
  /** Members that lack at least one image. */
  incompleteMembers: number;
  /** The metadata column that lists images (never shown raw), if any. */
  imagesColumn: string | null;
  /** The metadata column that repeats the member id, if any. */
  memberColumn: string | null;
  /** Table columns in display order (the caller decides how many fit). */
  columns: DesignTableColumn[];
  memberImages: (memberId: string) => DesignMemberImages | null;
  /** What a metadata column is called in the panel. */
  columnLabel: (column: string) => string;
  /** Whether a quick filter on this column would split the members. */
  partitions: (column: string) => boolean;
}

/**
 * Short, distinct names for a set's images: without the file extension they
 * all share, and with only as much of the path as tells them apart
 * (`enc_rep/maps/same_item.nii.gz` -> `same_item`).
 */
export function shortImageNames(names: readonly string[]): Map<string, string> {
  const unique = [...new Set(names)];
  const extensions = unique.map((name) => fileExtension(name.split(/[\\/]/).pop() ?? ''));
  const shared = extensions[0] ?? '';
  // An extension is dropped only when every image has it and it reads as one
  // (".nii.gz", not the ".2" of an image called "v1.2").
  const dropExtension =
    /^\.[a-z]/i.test(shared) &&
    extensions.every((extension) => extension.toLowerCase() === shared.toLowerCase());
  const segments = unique.map((name) => {
    const stem = dropExtension ? name.slice(0, name.length - shared.length) : name;
    const parts = stem.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts : [name];
  });
  const depth = segments.map(() => 1);
  const label = (index: number) => segments[index].slice(-depth[index]).join('/');
  for (;;) {
    const seen = new Map<string, number[]>();
    segments.forEach((_, index) => {
      const key = label(index);
      seen.set(key, [...(seen.get(key) ?? []), index]);
    });
    let grew = false;
    for (const group of seen.values()) {
      if (group.length < 2) continue;
      for (const index of group) {
        if (depth[index] < segments[index].length) {
          depth[index] += 1;
          grew = true;
        }
      }
    }
    if (!grew) break;
  }
  return new Map(unique.map((name, index) => [name, label(index)]));
}

function splitImages(cell: string | undefined): string[] {
  return (cell ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function bindingImages(member: StudioMemberSummary): { all: string[]; present: string[] } | null {
  const bindings = member.bindings ?? [];
  if (bindings.length === 0) return null;
  return {
    all: [...new Set(bindings.map((binding) => binding.role))],
    present: [
      ...new Set(
        bindings
          .filter((binding) => binding.availability === 'available')
          .map((binding) => binding.role),
      ),
    ],
  };
}

export function designPanelModel(
  set: SpatialFieldSetSummary,
  metadata: StudioMetadata,
): DesignPanelModel {
  const rows = metadata.issue ? new Map<string, Readonly<Record<string, string>>>() : metadata.rows;
  const hasImagesCell = metadata.columns.includes(IMAGES_COLUMN);
  const bound = new Map(
    set.memberSummaries.flatMap((member) => {
      const images = bindingImages(member);
      return images ? [[member.id, images] as const] : [];
    }),
  );
  // A column called "roles" is the synthesized one when the set was opened
  // from a folder, or when it says what the members' own images say. Anything
  // else is the user's column and is shown as given.
  const imagesColumn =
    hasImagesCell &&
    (set.discoveryRequest != null ||
      (bound.size > 0 &&
        [...bound].every(([id, images]) => {
          const row = rows.get(id);
          return (
            row === undefined ||
            [...images.all].sort().join(',') === splitImages(row[IMAGES_COLUMN]).sort().join(',')
          );
        })))
      ? IMAGES_COLUMN
      : null;

  const perMember = new Map<string, { all: string[]; present: string[] }>();
  for (const id of set.memberIds) {
    const fromBindings = bound.get(id);
    if (fromBindings) {
      perMember.set(id, fromBindings);
      continue;
    }
    const row = rows.get(id);
    if (imagesColumn && row) {
      const listed = splitImages(row[imagesColumn]);
      perMember.set(id, { all: listed, present: listed });
    }
  }

  const names = [...new Set([...perMember.values()].flatMap((entry) => entry.all))].sort();
  const short = shortImageNames(names);
  const images = names.map((name) => ({ name, short: short.get(name) ?? name }));
  const memberImages = (memberId: string): DesignMemberImages | null => {
    const entry = perMember.get(memberId);
    if (!entry || images.length === 0) return null;
    const present = new Set(entry.present);
    const missing = images.filter((image) => !present.has(image.name));
    return { present: images.length - missing.length, total: images.length, missing };
  };
  const incompleteMembers = [...perMember.keys()].filter(
    (id) => (memberImages(id)?.missing.length ?? 0) > 0,
  ).length;
  const uniformImages = incompleteMembers === 0;

  const memberColumn =
    metadata.columns.includes(MEMBER_COLUMN) &&
    rows.size > 0 &&
    [...rows].every(([id, row]) => row[MEMBER_COLUMN] === id)
      ? MEMBER_COLUMN
      : null;

  const columnLabel = (column: string) =>
    column === imagesColumn ? 'Images' : column === memberColumn ? 'Member' : column;

  const columns: DesignTableColumn[] = metadata.columns
    .filter((column) => column !== imagesColumn)
    .map((column) => ({
      key: column,
      kind: column === memberColumn ? 'member' : 'design',
      label: columnLabel(column),
    }));
  // The per-member cell earns its place only when members differ.
  if (images.length > 0 && !uniformImages)
    columns.push({ key: null, kind: 'images', label: 'Images' });

  const partitionCache = new Map<string, boolean>();
  const partitions = (column: string): boolean => {
    if (column === imagesColumn) return false;
    const cached = partitionCache.get(column);
    if (cached !== undefined) return cached;
    const values = [...rows.values()].map((row) => row[column]).filter(Boolean);
    const distinct = new Set(values).size;
    // One value selects everyone; all-different values each select one
    // member, which the list and the search field already do.
    const result = distinct > 1 && distinct < values.length;
    partitionCache.set(column, result);
    return result;
  };

  return {
    images,
    uniformImages,
    incompleteMembers,
    imagesColumn,
    memberColumn,
    columns,
    memberImages,
    columnLabel,
    partitions,
  };
}

/** "3 of 3", or "2 of 3 · missing temporal_dist". */
export function memberImagesText(images: DesignMemberImages): string {
  const count = `${images.present} of ${images.total}`;
  return images.missing.length === 0
    ? count
    : `${count} · missing ${images.missing.map((image) => image.short).join(', ')}`;
}

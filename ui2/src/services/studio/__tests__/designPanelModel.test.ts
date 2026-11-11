import { describe, expect, it } from 'vitest';
import { designPanelModel, memberImagesText, shortImageNames } from '../designPanelModel';
import { studioMetadata } from '../studioMetadata';
import { folderSet, FOLDER_IMAGES } from './designPanelFixtures';

describe('shortImageNames', () => {
  it('drops the directory and extension the images share', () => {
    expect([...shortImageNames(FOLDER_IMAGES).values()]).toEqual([
      'same_item',
      'same_run',
      'temporal_dist',
    ]);
  });

  it('keeps enough of the path to tell colliding names apart', () => {
    const short = shortImageNames([
      'enc/maps/same_item.nii.gz',
      'ret/maps/same_item.nii.gz',
      'ret/maps/other.nii.gz',
    ]);
    expect(short.get('enc/maps/same_item.nii.gz')).toBe('enc/maps/same_item');
    expect(short.get('ret/maps/same_item.nii.gz')).toBe('ret/maps/same_item');
    expect(short.get('ret/maps/other.nii.gz')).toBe('other');
  });

  it('keeps an extension the images do not share, and names that are not files', () => {
    expect([...shortImageNames(['maps/a.nii.gz', 'maps/a.nii']).values()]).toEqual([
      'a.nii.gz',
      'a.nii',
    ]);
    expect([...shortImageNames(['beta', 'tstat']).values()]).toEqual(['beta', 'tstat']);
    expect([...shortImageNames(['v1.2', 'v1.3']).values()]).toEqual(['v1.2', 'v1.3']);
    expect(shortImageNames(['enc_rep/maps/only.nii.gz']).get('enc_rep/maps/only.nii.gz')).toBe(
      'only',
    );
  });
});

describe('designPanelModel', () => {
  it('drops the images column when every member has the same images', () => {
    const set = folderSet(5);
    const model = designPanelModel(set, studioMetadata(set, []));
    expect(model.imagesColumn).toBe('roles');
    expect(model.memberColumn).toBe('member');
    expect(model.uniformImages).toBe(true);
    expect(model.images.map((image) => image.short)).toEqual([
      'same_item',
      'same_run',
      'temporal_dist',
    ]);
    expect(model.columns).toEqual([{ key: 'member', kind: 'member', label: 'Member' }]);
  });

  it('reports per-member completeness when members differ', () => {
    const set = folderSet(5, { 'sub-1003': FOLDER_IMAGES.slice(0, 2) });
    const model = designPanelModel(set, studioMetadata(set, []));
    expect(model.uniformImages).toBe(false);
    expect(model.incompleteMembers).toBe(1);
    expect(model.columns.map((column) => column.label)).toEqual(['Member', 'Images']);
    expect(memberImagesText(model.memberImages('sub-1002')!)).toBe('3 of 3');
    expect(memberImagesText(model.memberImages('sub-1003')!)).toBe(
      '2 of 3 · missing temporal_dist',
    );
  });

  it('counts a binding that is not available as missing', () => {
    const set = folderSet(3);
    set.memberSummaries[1].bindings![2].availability = 'missing';
    const model = designPanelModel(set, studioMetadata(set, []));
    expect(model.memberImages('sub-1003')).toMatchObject({ present: 2, total: 3 });
  });

  it('offers a filter only for a column that partitions the members', () => {
    const set = folderSet(6, {}, (index) => ({ sex: index % 2 ? 'F' : 'M', scanner: 'prisma' }));
    const model = designPanelModel(set, studioMetadata(set, []));
    expect(model.partitions('member')).toBe(false); // all unique
    expect(model.partitions('roles')).toBe(false); // the images column
    expect(model.partitions('scanner')).toBe(false); // all identical
    expect(model.partitions('sex')).toBe(true);
  });

  it("leaves a user's own column called roles alone", () => {
    const set = folderSet(3);
    const own = {
      ...set,
      discoveryRequest: undefined,
      memberSummaries: set.memberSummaries.map((member, index) => ({
        ...member,
        bindings: null,
        designValues: { member: member.id, roles: index ? 'patient' : 'carer' },
      })),
    };
    const model = designPanelModel(own, studioMetadata(own, []));
    expect(model.imagesColumn).toBeNull();
    expect(model.images).toEqual([]);
    expect(model.columns.map((column) => column.label)).toEqual(['Member', 'roles']);
  });
});

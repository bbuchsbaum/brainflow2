//! Sparse editable label volumes, independent of session policy and rendering.
//! Voxel indices are zero based, x fastest; label zero is background. Provenance
//! is an opaque byte owned by the consumer, and is undone with the label.
use std::collections::{BTreeMap, HashMap, VecDeque};

mod writer;
pub use writer::{write_label_export, write_label_nifti, Companion, Target};

const EDGE: u32 = 16;
const BRICK_LEN: usize = 16 * 16 * 16;
pub const DEFAULT_HISTORY_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Invalid label grid: {0}")]
    Grid(&'static str),
    #[error("Voxel {0:?} is outside the label grid")]
    Outside([u32; 3]),
    #[error("Label revision conflict: expected {expected}, current {actual}")]
    Revision { expected: u64, actual: u64 },
    #[error("Label revision counter exhausted")]
    RevisionExhausted,
    #[error("The edit exceeds the undo memory budget")]
    HistoryBudget,
    #[error("Could not allocate the label volume")]
    Allocation,
    #[error("{0}")]
    Nifti(#[from] nifti::error::NiftiError),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Export(String),
}
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LabelValue {
    pub label: u16,
    pub provenance: u8,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VoxelEdit {
    pub voxel: [u32; 3],
    pub value: LabelValue,
}
/// Inclusive origin and exclusive end. A change with no bounds changed no voxels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Region {
    pub origin: [u32; 3],
    pub end: [u32; 3],
}
impl Region {
    pub fn dimensions(self) -> [u32; 3] {
        std::array::from_fn(|axis| self.end[axis] - self.origin[axis])
    }
    fn include(&mut self, voxel: [u32; 3]) {
        for (axis, index) in voxel.into_iter().enumerate() {
            self.origin[axis] = self.origin[axis].min(index);
            self.end[axis] = self.end[axis].max(index + 1);
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Change {
    pub revision: u64,
    pub bounds: Option<Region>,
    pub changed_voxels: usize,
}

struct Brick {
    values: Box<[LabelValue; BRICK_LEN]>,
    occupied: usize,
}
impl Default for Brick {
    fn default() -> Self {
        Self {
            values: Box::new([LabelValue::default(); BRICK_LEN]),
            occupied: 0,
        }
    }
}
#[derive(Clone, Copy)]
struct Delta {
    voxel: [u32; 3],
    before: LabelValue,
    after: LabelValue,
}
struct Entry {
    description: String,
    deltas: Vec<Delta>,
    bytes: usize,
    bounds: Region,
}

/// A document has unlimited history depth within a byte budget. Oversized single
/// edits are refused before mutation; oldest undo entries are discarded first.
pub struct LabelVolume {
    dimensions: [u32; 3],
    bricks: HashMap<[u32; 3], Brick>,
    revision: u64,
    counts: BTreeMap<u16, u64>,
    nonzero_voxels: u64,
    undo: VecDeque<Entry>,
    redo: Vec<Entry>,
    history_bytes: usize,
    history_budget: usize,
}
impl LabelVolume {
    pub fn new(dimensions: [u32; 3], history_budget: usize) -> Result<Self> {
        if dimensions.iter().any(|&n| n == 0 || n > 32767) {
            return Err(Error::Grid("dimensions must be in 1..=32767 for NIfTI-1"));
        }
        dimensions
            .iter()
            .try_fold(1usize, |n, &v| n.checked_mul(v as usize))
            .ok_or(Error::Grid("voxel count overflow"))?;
        Ok(Self {
            dimensions,
            bricks: HashMap::new(),
            revision: 0,
            counts: BTreeMap::new(),
            nonzero_voxels: 0,
            undo: VecDeque::new(),
            redo: Vec::new(),
            history_bytes: 0,
            history_budget,
        })
    }
    pub fn dimensions(&self) -> [u32; 3] {
        self.dimensions
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    /// Non-background label counts, maintained with edits and history travel.
    pub fn label_counts(&self) -> &BTreeMap<u16, u64> {
        &self.counts
    }
    /// Non-background values in unspecified order, without materializing a
    /// dense grid. Provenance-only background voxels are omitted.
    pub fn label_voxels(&self) -> impl Iterator<Item = ([u32; 3], LabelValue)> + '_ {
        self.bricks.iter().flat_map(|(&brick, data)| {
            data.values
                .iter()
                .copied()
                .enumerate()
                .filter_map(move |(index, value)| {
                    if value.label == 0 {
                        return None;
                    }
                    let local = [
                        (index % 16) as u32,
                        ((index / 16) % 16) as u32,
                        (index / 256) as u32,
                    ];
                    Some((
                        std::array::from_fn(|axis| brick[axis] * EDGE + local[axis]),
                        value,
                    ))
                })
        })
    }
    pub fn data_range(&self) -> (u16, u16) {
        let total: u64 = self.dimensions.iter().map(|&v| u64::from(v)).product();
        let min = if self.nonzero_voxels < total {
            0
        } else {
            self.counts
                .first_key_value()
                .map(|(&id, _)| id)
                .unwrap_or(0)
        };
        let max = self.counts.last_key_value().map(|(&id, _)| id).unwrap_or(0);
        (min, max)
    }
    pub fn allocated_bricks(&self) -> usize {
        self.bricks.len()
    }
    pub fn history_bytes(&self) -> usize {
        self.history_bytes
    }
    pub fn undo_description(&self) -> Option<&str> {
        self.undo.back().map(|e| e.description.as_str())
    }
    pub fn redo_description(&self) -> Option<&str> {
        self.redo.last().map(|e| e.description.as_str())
    }
    fn check(&self, voxel: [u32; 3]) -> Result<()> {
        if (0..3).any(|axis| voxel[axis] >= self.dimensions[axis]) {
            Err(Error::Outside(voxel))
        } else {
            Ok(())
        }
    }
    fn check_revision(&self, expected: u64) -> Result<()> {
        if self.revision != expected {
            Err(Error::Revision {
                expected,
                actual: self.revision,
            })
        } else {
            Ok(())
        }
    }
    fn address(voxel: [u32; 3]) -> ([u32; 3], usize) {
        let key = voxel.map(|v| v / EDGE);
        let [x, y, z] = voxel.map(|v| (v % EDGE) as usize);
        (key, x + 16 * (y + 16 * z))
    }
    pub fn get(&self, voxel: [u32; 3]) -> Result<LabelValue> {
        self.check(voxel)?;
        let (key, offset) = Self::address(voxel);
        Ok(self
            .bricks
            .get(&key)
            .map(|b| b.values[offset])
            .unwrap_or_default())
    }
    fn set(&mut self, voxel: [u32; 3], value: LabelValue) {
        let (key, offset) = Self::address(voxel);
        if value == LabelValue::default() && !self.bricks.contains_key(&key) {
            return;
        }
        let brick = self.bricks.entry(key).or_default();
        let before = brick.values[offset];
        if before.label != value.label {
            if before.label != 0 {
                let count = self.counts.get_mut(&before.label).expect("label count");
                *count -= 1;
                if *count == 0 {
                    self.counts.remove(&before.label);
                }
                self.nonzero_voxels -= 1;
            }
            if value.label != 0 {
                *self.counts.entry(value.label).or_default() += 1;
                self.nonzero_voxels += 1;
            }
        }

        brick.occupied -= usize::from(before != LabelValue::default());
        brick.occupied += usize::from(value != LabelValue::default());
        brick.values[offset] = value;
        if brick.occupied == 0 {
            self.bricks.remove(&key);
        }
    }
    /// Last duplicate voxel wins. Validation and budget checks precede all writes.
    pub fn commit(
        &mut self,
        expected: u64,
        description: String,
        edits: &[VoxelEdit],
    ) -> Result<Change> {
        self.check_revision(expected)?;
        let mut pending = BTreeMap::new();
        for edit in edits {
            self.check(edit.voxel)?;
            pending.insert(edit.voxel, edit.value);
        }
        let mut deltas = Vec::new();
        for (voxel, after) in pending {
            let before = self.get(voxel)?;
            if before != after {
                deltas.push(Delta {
                    voxel,
                    before,
                    after,
                });
            }
        }
        if deltas.is_empty() {
            return Ok(Change {
                revision: self.revision,
                bounds: None,
                changed_voxels: 0,
            });
        }
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(Error::RevisionExhausted)?;
        let bytes = deltas
            .capacity()
            .checked_mul(std::mem::size_of::<Delta>())
            .and_then(|n| n.checked_add(description.capacity()))
            .and_then(|n| n.checked_add(std::mem::size_of::<Entry>()))
            .ok_or(Error::HistoryBudget)?;
        if bytes > self.history_budget {
            return Err(Error::HistoryBudget);
        }
        let first = deltas[0].voxel;
        let mut bounds = Region {
            origin: first,
            end: first.map(|v| v + 1),
        };
        for delta in &deltas {
            self.set(delta.voxel, delta.after);
            bounds.include(delta.voxel);
        }
        self.history_bytes -= self.redo.iter().map(|e| e.bytes).sum::<usize>();
        self.redo.clear();
        while self.history_bytes > self.history_budget - bytes {
            let entry = self.undo.pop_front().expect("history accounting");
            self.history_bytes -= entry.bytes;
        }
        let change = Change {
            revision,
            bounds: Some(bounds),
            changed_voxels: deltas.len(),
        };
        self.undo.push_back(Entry {
            description,
            deltas,
            bytes,
            bounds,
        });
        self.history_bytes += bytes;
        self.revision = revision;
        Ok(change)
    }
    /// Bounds of the next undo/redo entry, for hosts to reserve publication
    /// buffers before changing document revision or history.
    pub fn history_region(&self, redo: bool) -> Option<Region> {
        if redo {
            self.redo.last()
        } else {
            self.undo.back()
        }
        .map(|entry| entry.bounds)
    }
    pub fn undo(&mut self, expected: u64) -> Result<Change> {
        self.travel(expected, false)
    }
    pub fn redo(&mut self, expected: u64) -> Result<Change> {
        self.travel(expected, true)
    }
    fn travel(&mut self, expected: u64, redo: bool) -> Result<Change> {
        self.check_revision(expected)?;
        if if redo {
            self.redo.is_empty()
        } else {
            self.undo.is_empty()
        } {
            return Ok(Change {
                revision: self.revision,
                bounds: None,
                changed_voxels: 0,
            });
        }
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(Error::RevisionExhausted)?;
        let entry = if redo {
            self.redo.pop().unwrap()
        } else {
            self.undo.pop_back().unwrap()
        };
        for delta in &entry.deltas {
            self.set(delta.voxel, if redo { delta.after } else { delta.before });
        }
        let change = Change {
            revision,
            bounds: Some(entry.bounds),
            changed_voxels: entry.deltas.len(),
        };
        if redo {
            self.undo.push_back(entry);
        } else {
            self.redo.push(entry);
        }
        self.revision = revision;
        Ok(change)
    }
    /// Import an x-fastest label array. It is the baseline, not an undo entry.
    pub fn from_dense(dimensions: [u32; 3], labels: &[u16], history_budget: usize) -> Result<Self> {
        let mut volume = Self::new(dimensions, history_budget)?;
        if labels.len() != dimensions.iter().map(|&v| v as usize).product() {
            return Err(Error::Grid("label array length differs from grid"));
        }
        let [nx, ny, _] = dimensions.map(|v| v as usize);
        for (index, &label) in labels.iter().enumerate() {
            if label != 0 {
                volume.set(
                    [
                        (index % nx) as u32,
                        ((index / nx) % ny) as u32,
                        (index / (nx * ny)) as u32,
                    ],
                    LabelValue {
                        label,
                        provenance: 0,
                    },
                );
            }
        }
        Ok(volume)
    }
    /// Tightly packed x-fastest labels for texture sub-region upload or export.
    pub fn read_region(&self, region: Region) -> Result<Vec<u16>> {
        self.check_region(region)?;
        let count = region.dimensions().iter().map(|&v| v as usize).product();
        let mut values = Vec::new();
        values
            .try_reserve_exact(count)
            .map_err(|_| Error::Allocation)?;
        values.resize(count, 0);
        self.read_region_into(region, &mut values)?;
        Ok(values)
    }
    fn check_region(&self, region: Region) -> Result<()> {
        if (0..3).any(|a| region.origin[a] >= region.end[a] || region.end[a] > self.dimensions[a]) {
            return Err(Error::Grid("invalid region"));
        }
        Ok(())
    }
    /// Fill an already-reserved tightly packed buffer, without allocating.
    pub fn read_region_into(&self, region: Region, values: &mut [u16]) -> Result<()> {
        self.check_region(region)?;
        let count: usize = region.dimensions().iter().map(|&v| v as usize).product();
        if values.len() != count {
            return Err(Error::Grid("region buffer length differs from region"));
        }
        let mut at = 0;
        for z in region.origin[2]..region.end[2] {
            for y in region.origin[1]..region.end[1] {
                for x in region.origin[0]..region.end[0] {
                    values[at] = self.get([x, y, z])?.label;
                    at += 1;
                }
            }
        }
        Ok(())
    }
    pub fn dense(&self) -> Result<Vec<u16>> {
        self.read_region(Region {
            origin: [0; 3],
            end: self.dimensions,
        })
    }
}

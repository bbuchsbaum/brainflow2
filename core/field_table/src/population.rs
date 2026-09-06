//! Exact descriptive reductions over observed fields on a common spatial support.
//!
//! A field may be a full volume, a native slice, a parcel vector or a block of
//! vertices. Geometry, identity, participant handling and weights are validated
//! by the caller before entering this numerical kernel. Each push is one equally
//! weighted observation. A validity mask excludes measurements; non-finite
//! values are always unavailable, while a measured zero remains valid.
//!
//! Moments accumulate in f64 using centered online updates and parallel merges.
//! This supports bounded spatial blocks without holding all input fields. It
//! makes no inference about biological variability or uncertainty in a mean.

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum PopulationError {
    EmptySupport,
    InvalidNearZero,
    Shape { expected: usize, actual: usize },
    MaskShape { expected: usize, actual: usize },
    IncompatibleThreshold,
    CountOverflow,
}

impl fmt::Display for PopulationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptySupport => {
                write!(f, "Population support must contain at least one location.")
            }
            Self::InvalidNearZero => {
                write!(f, "Near-zero interval must be finite and nonnegative.")
            }
            Self::Shape { expected, actual } => write!(
                f,
                "Population field has {actual} locations; expected {expected}."
            ),
            Self::MaskShape { expected, actual } => write!(
                f,
                "Population validity mask has {actual} locations; expected {expected}."
            ),
            Self::IncompatibleThreshold => write!(f, "Cannot merge different near-zero intervals."),
            Self::CountOverflow => write!(f, "Population observation count overflow."),
        }
    }
}

impl std::error::Error for PopulationError {}

fn updated_mean(mean: f64, value: f64, count: u64) -> f64 {
    mean + (value - mean) / count as f64
}

/// Mean-only export accumulator. Avoids allocating spread/sign moments for an
/// entire native grid when the exporter streams one source volume at a time.
pub(crate) struct MeanField {
    locations: Vec<(f64, u64)>,
    eligible_count: u64,
}

impl MeanField {
    pub(crate) fn new(location_count: usize) -> Self {
        Self {
            locations: vec![(0.0, 0); location_count],
            eligible_count: 0,
        }
    }

    pub(crate) fn push(&mut self, values: &[f32]) -> Result<(), PopulationError> {
        if values.len() != self.locations.len() {
            return Err(PopulationError::Shape {
                expected: self.locations.len(),
                actual: values.len(),
            });
        }
        let count = self
            .eligible_count
            .checked_add(1)
            .ok_or(PopulationError::CountOverflow)?;
        for (&value, (mean, valid_count)) in values.iter().zip(&mut self.locations) {
            if value.is_finite() {
                *valid_count += 1;
                *mean = updated_mean(*mean, f64::from(value), *valid_count);
            }
        }
        self.eligible_count = count;
        Ok(())
    }

    pub(crate) fn means(&self) -> impl Iterator<Item = Option<f64>> + '_ {
        self.locations
            .iter()
            .map(|&(mean, count)| (count > 0).then_some(mean))
    }
}

/// Sign counts include only valid measurements. Both interval endpoints are
/// near zero: `-threshold <= value <= threshold`.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SignCounts {
    pub positive: u64,
    pub near_zero: u64,
    pub negative: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LocationSummary {
    pub eligible_count: u64,
    pub valid_count: u64,
    pub mean: Option<f64>,
    /// Observed sample SD, denominator valid_count - 1; unavailable below 2.
    pub sample_sd: Option<f64>,
    /// Descriptive RMS deviation, denominator valid_count. Not sample SD or SE.
    pub population_sd: Option<f64>,
    pub mean_absolute: Option<f64>,
    pub cancellation: Option<f64>,
    pub signs: SignCounts,
}

#[derive(Debug, Default, Clone)]
struct Moments {
    count: u64,
    mean: f64,
    m2: f64,
    absolute_sum: f64,
    signs: SignCounts,
}

impl Moments {
    fn push(&mut self, value: f64, near_zero: f64) {
        self.count += 1;
        let delta = value - self.mean;
        self.mean = updated_mean(self.mean, value, self.count);
        self.m2 += delta * (value - self.mean);
        self.absolute_sum += value.abs();
        if value > near_zero {
            self.signs.positive += 1;
        } else if value < -near_zero {
            self.signs.negative += 1;
        } else {
            self.signs.near_zero += 1;
        }
    }

    fn merge(&mut self, other: &Self) {
        if other.count == 0 {
            return;
        }
        if self.count == 0 {
            *self = other.clone();
            return;
        }
        let count = self.count + other.count;
        let delta = other.mean - self.mean;
        let other_fraction = other.count as f64 / count as f64;
        self.m2 += other.m2 + delta * delta * self.count as f64 * other_fraction;
        self.mean += delta * other_fraction;
        self.count = count;
        self.absolute_sum += other.absolute_sum;
        self.signs.positive += other.signs.positive;
        self.signs.near_zero += other.signs.near_zero;
        self.signs.negative += other.signs.negative;
    }

    fn summary(&self, eligible_count: u64) -> LocationSummary {
        let mean = (self.count > 0).then_some(self.mean);
        let mean_absolute = (self.count > 0).then(|| self.absolute_sum / self.count as f64);
        LocationSummary {
            eligible_count,
            valid_count: self.count,
            mean,
            sample_sd: (self.count > 1)
                .then(|| (self.m2.max(0.0) / (self.count - 1) as f64).sqrt()),
            population_sd: (self.count > 0).then(|| (self.m2.max(0.0) / self.count as f64).sqrt()),
            mean_absolute,
            cancellation: mean_absolute.map(|magnitude| (magnitude - self.mean.abs()).max(0.0)),
            signs: self.signs,
        }
    }
}

/// Streaming moments for a spatial block. No source arrays are retained.
///
/// An empty selection on a nonempty support is valid and produces unavailable
/// summaries with zero counts. Rejected pushes/merges leave all state unchanged.
#[derive(Debug, Clone)]
pub struct FieldMoments {
    locations: Vec<Moments>,
    eligible_count: u64,
    near_zero: f64,
}

impl FieldMoments {
    pub fn new(location_count: usize, near_zero: f64) -> Result<Self, PopulationError> {
        if location_count == 0 {
            return Err(PopulationError::EmptySupport);
        }
        if !near_zero.is_finite() || near_zero < 0.0 {
            return Err(PopulationError::InvalidNearZero);
        }
        Ok(Self {
            locations: vec![Moments::default(); location_count],
            eligible_count: 0,
            near_zero,
        })
    }

    pub fn push(
        &mut self,
        values: &[f32],
        validity: Option<&[bool]>,
    ) -> Result<(), PopulationError> {
        if values.len() != self.locations.len() {
            return Err(PopulationError::Shape {
                expected: self.locations.len(),
                actual: values.len(),
            });
        }
        if let Some(mask) = validity {
            if mask.len() != values.len() {
                return Err(PopulationError::MaskShape {
                    expected: values.len(),
                    actual: mask.len(),
                });
            }
        }
        let eligible_count = self
            .eligible_count
            .checked_add(1)
            .ok_or(PopulationError::CountOverflow)?;
        for (index, (&value, moments)) in values.iter().zip(&mut self.locations).enumerate() {
            if value.is_finite() && validity.is_none_or(|mask| mask[index]) {
                moments.push(f64::from(value), self.near_zero);
            }
        }
        self.eligible_count = eligible_count;
        Ok(())
    }

    /// Merge disjoint observation blocks on the same spatial support. The
    /// caller owns membership validation; merging a block twice counts it twice.
    pub fn merge(&mut self, other: &Self) -> Result<(), PopulationError> {
        if self.locations.len() != other.locations.len() {
            return Err(PopulationError::Shape {
                expected: self.locations.len(),
                actual: other.locations.len(),
            });
        }
        if self.near_zero != other.near_zero {
            return Err(PopulationError::IncompatibleThreshold);
        }
        let eligible_count = self
            .eligible_count
            .checked_add(other.eligible_count)
            .ok_or(PopulationError::CountOverflow)?;
        for (target, source) in self.locations.iter_mut().zip(&other.locations) {
            target.merge(source);
        }
        self.eligible_count = eligible_count;
        Ok(())
    }

    pub fn summaries(&self) -> impl ExactSizeIterator<Item = LocationSummary> + '_ {
        self.locations
            .iter()
            .map(|m| m.summary(self.eligible_count))
    }

    /// Heap storage owned by the accumulator, excluding output materialization.
    pub fn allocated_bytes(&self) -> usize {
        self.locations.capacity() * std::mem::size_of::<Moments>()
    }
}

//! Canonical axes and orientation sets (2-D, 3-D, 4-D).
use nalgebra::{Const, SMatrix, Vector3, DefaultAllocator, DimName};
use nalgebra::allocator::Allocator;
use num_traits::FromPrimitive;
use num_traits::Zero;
use serde::{Deserialize, Serialize};
use std::{array, fmt, slice, fmt::Debug};
use ts_rs::TS;

/* ───────────────────────── Elementary axes ───────────────────────── */

#[derive(TS, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../packages/api/src/generated/axis.ts")]
pub enum AxisName {
    // spatial directions (canonical L + / P + / I +)
    LeftRight,   // +X
    RightLeft,   // –X
    PostAnt,     // +Y
    AntPost,     // –Y
    InfSup,      // +Z
    SupInf,      // –Z
    // non-spatial
    Time,
    VectorDim,
    Unknown,
}

#[derive(TS, Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../packages/api/src/generated/axis.ts")]
pub struct NamedAxis {
    pub name: AxisName,
    #[ts(skip)]
    pub direction_arr: [i8; 3],
}

impl NamedAxis {
    /* --- spatial --- */
    pub const LEFT_RIGHT: Self = Self { name: AxisName::LeftRight, direction_arr: [ 1,  0,  0] };
    pub const RIGHT_LEFT: Self = Self { name: AxisName::RightLeft, direction_arr: [-1,  0,  0] };
    pub const POST_ANT:   Self = Self { name: AxisName::PostAnt,   direction_arr: [ 0,  1,  0] };
    pub const ANT_POST:   Self = Self { name: AxisName::AntPost,   direction_arr: [ 0, -1,  0] };
    pub const INF_SUP:    Self = Self { name: AxisName::InfSup,    direction_arr: [ 0,  0,  1] };
    pub const SUP_INF:    Self = Self { name: AxisName::SupInf,    direction_arr: [ 0,  0, -1] };
    /* --- non-spatial --- */
    pub const TIME:    Self = Self { name: AxisName::Time,      direction_arr: [0; 3] };
    pub const VEC_DIM: Self = Self { name: AxisName::VectorDim, direction_arr: [0; 3] };
    pub const UNKNOWN: Self = Self { name: AxisName::Unknown,   direction_arr: [0; 3] };

    #[inline] pub fn direction_vec(self) -> Vector3<i8> { Vector3::from(self.direction_arr) }

    #[inline] pub const fn opposite(self) -> Self {
        use AxisName::*;
        match self.name {
            LeftRight => Self::RIGHT_LEFT,
            RightLeft => Self::LEFT_RIGHT,
            PostAnt   => Self::ANT_POST,
            AntPost   => Self::POST_ANT,
            InfSup    => Self::SUP_INF,
            SupInf    => Self::INF_SUP,
            Time      | VectorDim | Unknown => self,
        }
    }
    #[inline] pub fn is_spatial(self) -> bool { self.direction_arr != [0; 3] }
}

impl fmt::Display for NamedAxis {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "{:?}", self.name) }
}

/* ───────────────────────── Generic AxisSet<N> ────────────────────── */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AxisSet<const N: usize> { pub axes: [NamedAxis; N] }

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../packages/api/src/generated/axis.ts")]
pub struct AxisSet2D { pub axes: [NamedAxis; 2] }

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../packages/api/src/generated/axis.ts")]
pub struct AxisSet3D { pub axes: [NamedAxis; 3] }

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../packages/api/src/generated/axis.ts")]
pub struct AxisSet4D { pub axes: [NamedAxis; 4] }

impl<const N: usize> AxisSet<N>
where
    Const<N>: DimName,
    DefaultAllocator: Allocator<NamedAxis, Const<N>>,
    DefaultAllocator: Allocator<f64, Const<N>, Const<N>>,
{
    #[inline] pub const fn ndim(&self) -> usize { N }
    #[inline] pub fn axis(&self, i: usize) -> NamedAxis { self.axes[i] }
    #[inline] pub fn iter(&self) -> slice::Iter<'_, NamedAxis> { self.axes.iter() }

    pub fn which_axis(&self, target: &NamedAxis, ignore_dir: bool) -> Option<usize> {
        self.axes.iter().position(|ax| {
            if ignore_dir {
                ax.name == target.name || (ax.is_spatial() && ax.opposite().name == target.name)
            } else { ax == target }
        })
    }

    pub fn orientation_matrix<T>(&self) -> SMatrix<T, N, N>
    where
        T: nalgebra::Scalar + FromPrimitive + Copy + Default + Debug + Zero,
    {
        let mut m = SMatrix::<T, N, N>::zeros();
        for col in 0..N {
            let ax = self.axes[col];
            if ax.is_spatial() {
                let v = ax.direction_vec();
                for row in 0..N.min(3) {
                    m[(row, col)] = T::from_i8(v[row]).unwrap();
                }
            }
            if col >= 3 || !ax.is_spatial() {
                m[(col, col)] = T::from_i8(1).unwrap();
            }
        }
        m
    }
}

impl<const N: usize> IntoIterator for AxisSet<N> {
    type Item = NamedAxis;
    type IntoIter = array::IntoIter<NamedAxis, N>;
    fn into_iter(self) -> Self::IntoIter { self.axes.into_iter() }
}

/* ───────────────────────── Orientation catalog ───────────────────── */
/* Each constant is named by its three letters (X-axis, Y-axis, Z-axis)
   using L/R, P/A, I/S conventions. */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Orientation3D {
    /* Axial (Z perpendicular) */
    LPI, RPI, LAI, RAI, LPS, RPS, LAS, RAS,
    /* Coronal (Y perpendicular) */
    LSI, RSI, LSP, RSP, LSS, RSS,
    /* Sagittal (X perpendicular) */
    ASL, PSL, ASR, PSR, ASI, PSI,
    Unknown, // Add Unknown for fallback
}

impl Orientation3D {
    pub const fn to_axis_set(self) -> AxisSet3D {
        match self {
            /* Axial (k = ±Z) ------------------------------------------------ */
            Orientation3D::LPI => AxisSet3D { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::POST_ANT, NamedAxis::INF_SUP] },
            Orientation3D::RPI => AxisSet3D { axes: [NamedAxis::RIGHT_LEFT, NamedAxis::POST_ANT, NamedAxis::INF_SUP] },
            Orientation3D::LAI => AxisSet3D { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::ANT_POST, NamedAxis::INF_SUP] },
            Orientation3D::RAI => AxisSet3D { axes: [NamedAxis::RIGHT_LEFT, NamedAxis::ANT_POST, NamedAxis::INF_SUP] },
            Orientation3D::LPS => AxisSet3D { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::POST_ANT, NamedAxis::SUP_INF] },
            Orientation3D::RPS => AxisSet3D { axes: [NamedAxis::RIGHT_LEFT, NamedAxis::POST_ANT, NamedAxis::SUP_INF] },
            Orientation3D::LAS => AxisSet3D { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::ANT_POST, NamedAxis::SUP_INF] },
            Orientation3D::RAS => AxisSet3D { axes: [NamedAxis::RIGHT_LEFT, NamedAxis::ANT_POST, NamedAxis::SUP_INF] },
            /* Coronal (k = ±Y) --------------------------------------------- */
            Orientation3D::LSI   => AxisSet3D { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::INF_SUP, NamedAxis::POST_ANT] },
            Orientation3D::RSI   => AxisSet3D { axes: [NamedAxis::RIGHT_LEFT, NamedAxis::INF_SUP, NamedAxis::POST_ANT] },
            Orientation3D::LSP   => AxisSet3D { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::SUP_INF, NamedAxis::POST_ANT] },
            Orientation3D::RSP   => AxisSet3D { axes: [NamedAxis::RIGHT_LEFT, NamedAxis::SUP_INF, NamedAxis::POST_ANT] },
            Orientation3D::LSS   => AxisSet3D { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::SUP_INF, NamedAxis::ANT_POST] },
            Orientation3D::RSS   => AxisSet3D { axes: [NamedAxis::RIGHT_LEFT, NamedAxis::SUP_INF, NamedAxis::ANT_POST] },
            /* Sagittal (k = ±X) -------------------------------------------- */
            Orientation3D::ASL => AxisSet3D { axes: [NamedAxis::ANT_POST, NamedAxis::SUP_INF, NamedAxis::LEFT_RIGHT] },
            Orientation3D::PSL => AxisSet3D { axes: [NamedAxis::POST_ANT, NamedAxis::SUP_INF, NamedAxis::LEFT_RIGHT] },
            Orientation3D::ASR => AxisSet3D { axes: [NamedAxis::ANT_POST, NamedAxis::SUP_INF, NamedAxis::RIGHT_LEFT] },
            Orientation3D::PSR => AxisSet3D { axes: [NamedAxis::POST_ANT, NamedAxis::SUP_INF, NamedAxis::RIGHT_LEFT] },
            Orientation3D::ASI => AxisSet3D { axes: [NamedAxis::ANT_POST, NamedAxis::INF_SUP, NamedAxis::LEFT_RIGHT] },
            Orientation3D::PSI => AxisSet3D { axes: [NamedAxis::POST_ANT, NamedAxis::INF_SUP, NamedAxis::LEFT_RIGHT] },
            Orientation3D::Unknown => AxisSet3D { axes: [NamedAxis::UNKNOWN, NamedAxis::UNKNOWN, NamedAxis::UNKNOWN] },
        }
    }
    // Optional: Display, FromStr, is_axial, is_coronal, is_sagittal helpers
    pub fn is_axial(&self) -> bool {
        matches!(self, Orientation3D::LPI | Orientation3D::RPI | Orientation3D::LAI | Orientation3D::RAI | Orientation3D::LPS | Orientation3D::RPS | Orientation3D::LAS | Orientation3D::RAS)
    }
    pub fn is_coronal(&self) -> bool {
        matches!(self, Orientation3D::LSI | Orientation3D::RSI | Orientation3D::LSP | Orientation3D::RSP | Orientation3D::LSS | Orientation3D::RSS)
    }
    pub fn is_sagittal(&self) -> bool {
        matches!(self, Orientation3D::ASL | Orientation3D::PSL | Orientation3D::ASR | Orientation3D::PSR | Orientation3D::ASI | Orientation3D::PSI)
    }
}

impl std::fmt::Display for Orientation3D {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Orientation3D::LPI => "LPI",
            Orientation3D::RPI => "RPI",
            Orientation3D::LAI => "LAI",
            Orientation3D::RAI => "RAI",
            Orientation3D::LPS => "LPS",
            Orientation3D::RPS => "RPS",
            Orientation3D::LAS => "LAS",
            Orientation3D::RAS => "RAS",
            Orientation3D::LSI => "LSI",
            Orientation3D::RSI => "RSI",
            Orientation3D::LSP => "LSP",
            Orientation3D::RSP => "RSP",
            Orientation3D::LSS => "LSS",
            Orientation3D::RSS => "RSS",
            Orientation3D::ASL => "ASL",
            Orientation3D::PSL => "PSL",
            Orientation3D::ASR => "ASR",
            Orientation3D::PSR => "PSR",
            Orientation3D::ASI => "ASI",
            Orientation3D::PSI => "PSI",
            Orientation3D::Unknown => "Unknown",
        };
        write!(f, "{}", s)
    }
}

impl std::str::FromStr for Orientation3D {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_uppercase().as_str() {
            "LPI" => Ok(Orientation3D::LPI),
            "RPI" => Ok(Orientation3D::RPI),
            "LAI" => Ok(Orientation3D::LAI),
            "RAI" => Ok(Orientation3D::RAI),
            "LPS" => Ok(Orientation3D::LPS),
            "RPS" => Ok(Orientation3D::RPS),
            "LAS" => Ok(Orientation3D::LAS),
            "RAS" => Ok(Orientation3D::RAS),
            "LSI" => Ok(Orientation3D::LSI),
            "RSI" => Ok(Orientation3D::RSI),
            "LSP" => Ok(Orientation3D::LSP),
            "RSP" => Ok(Orientation3D::RSP),
            "LSS" => Ok(Orientation3D::LSS),
            "RSS" => Ok(Orientation3D::RSS),
            "ASL" => Ok(Orientation3D::ASL),
            "PSL" => Ok(Orientation3D::PSL),
            "ASR" => Ok(Orientation3D::ASR),
            "PSR" => Ok(Orientation3D::PSR),
            "ASI" => Ok(Orientation3D::ASI),
            "PSI" => Ok(Orientation3D::PSI),
            _ => Err(()),
        }
    }
}

impl std::convert::TryFrom<AxisSet3D> for Orientation3D {
    type Error = ();
    fn try_from(axes: AxisSet3D) -> Result<Self, Self::Error> {
        Ok(match axes.axes {
            [NamedAxis::LEFT_RIGHT, NamedAxis::POST_ANT, NamedAxis::INF_SUP] => Orientation3D::LPI,
            [NamedAxis::RIGHT_LEFT, NamedAxis::POST_ANT, NamedAxis::INF_SUP] => Orientation3D::RPI,
            [NamedAxis::LEFT_RIGHT, NamedAxis::ANT_POST, NamedAxis::INF_SUP] => Orientation3D::LAI,
            [NamedAxis::RIGHT_LEFT, NamedAxis::ANT_POST, NamedAxis::INF_SUP] => Orientation3D::RAI,
            [NamedAxis::LEFT_RIGHT, NamedAxis::POST_ANT, NamedAxis::SUP_INF] => Orientation3D::LPS,
            [NamedAxis::RIGHT_LEFT, NamedAxis::POST_ANT, NamedAxis::SUP_INF] => Orientation3D::RPS,
            [NamedAxis::LEFT_RIGHT, NamedAxis::ANT_POST, NamedAxis::SUP_INF] => Orientation3D::LAS,
            [NamedAxis::RIGHT_LEFT, NamedAxis::ANT_POST, NamedAxis::SUP_INF] => Orientation3D::RAS,
            [NamedAxis::LEFT_RIGHT, NamedAxis::INF_SUP, NamedAxis::POST_ANT] => Orientation3D::LSI,
            [NamedAxis::RIGHT_LEFT, NamedAxis::INF_SUP, NamedAxis::POST_ANT] => Orientation3D::RSI,
            [NamedAxis::LEFT_RIGHT, NamedAxis::SUP_INF, NamedAxis::POST_ANT] => Orientation3D::LSP,
            [NamedAxis::RIGHT_LEFT, NamedAxis::SUP_INF, NamedAxis::POST_ANT] => Orientation3D::RSP,
            [NamedAxis::LEFT_RIGHT, NamedAxis::SUP_INF, NamedAxis::ANT_POST] => Orientation3D::LSS,
            [NamedAxis::RIGHT_LEFT, NamedAxis::SUP_INF, NamedAxis::ANT_POST] => Orientation3D::RSS,
            [NamedAxis::ANT_POST,   NamedAxis::SUP_INF, NamedAxis::LEFT_RIGHT] => Orientation3D::ASL,
            [NamedAxis::POST_ANT,   NamedAxis::SUP_INF, NamedAxis::LEFT_RIGHT] => Orientation3D::PSL,
            [NamedAxis::ANT_POST,   NamedAxis::SUP_INF, NamedAxis::RIGHT_LEFT] => Orientation3D::ASR,
            [NamedAxis::POST_ANT,   NamedAxis::SUP_INF, NamedAxis::RIGHT_LEFT] => Orientation3D::PSR,
            [NamedAxis::ANT_POST,   NamedAxis::INF_SUP, NamedAxis::LEFT_RIGHT] => Orientation3D::ASI,
            [NamedAxis::POST_ANT,   NamedAxis::INF_SUP, NamedAxis::LEFT_RIGHT] => Orientation3D::PSI,
            _ => return Err(()),
        })
    }
}

impl AxisSet3D {
    #[inline] pub const fn orientation(self) -> Orientation3D {
        match self.axes {
            [NamedAxis::LEFT_RIGHT, NamedAxis::POST_ANT, NamedAxis::INF_SUP] => Orientation3D::LPI,
            [NamedAxis::RIGHT_LEFT, NamedAxis::POST_ANT, NamedAxis::INF_SUP] => Orientation3D::RPI,
            [NamedAxis::LEFT_RIGHT, NamedAxis::ANT_POST, NamedAxis::INF_SUP] => Orientation3D::LAI,
            [NamedAxis::RIGHT_LEFT, NamedAxis::ANT_POST, NamedAxis::INF_SUP] => Orientation3D::RAI,
            [NamedAxis::LEFT_RIGHT, NamedAxis::POST_ANT, NamedAxis::SUP_INF] => Orientation3D::LPS,
            [NamedAxis::RIGHT_LEFT, NamedAxis::POST_ANT, NamedAxis::SUP_INF] => Orientation3D::RPS,
            [NamedAxis::LEFT_RIGHT, NamedAxis::ANT_POST, NamedAxis::SUP_INF] => Orientation3D::LAS,
            [NamedAxis::RIGHT_LEFT, NamedAxis::ANT_POST, NamedAxis::SUP_INF] => Orientation3D::RAS,
            [NamedAxis::LEFT_RIGHT, NamedAxis::INF_SUP, NamedAxis::POST_ANT] => Orientation3D::LSI,
            [NamedAxis::RIGHT_LEFT, NamedAxis::INF_SUP, NamedAxis::POST_ANT] => Orientation3D::RSI,
            [NamedAxis::LEFT_RIGHT, NamedAxis::SUP_INF, NamedAxis::POST_ANT] => Orientation3D::LSP,
            [NamedAxis::RIGHT_LEFT, NamedAxis::SUP_INF, NamedAxis::POST_ANT] => Orientation3D::RSP,
            [NamedAxis::LEFT_RIGHT, NamedAxis::SUP_INF, NamedAxis::ANT_POST] => Orientation3D::LSS,
            [NamedAxis::RIGHT_LEFT, NamedAxis::SUP_INF, NamedAxis::ANT_POST] => Orientation3D::RSS,
            [NamedAxis::ANT_POST,   NamedAxis::SUP_INF, NamedAxis::LEFT_RIGHT] => Orientation3D::ASL,
            [NamedAxis::POST_ANT,   NamedAxis::SUP_INF, NamedAxis::LEFT_RIGHT] => Orientation3D::PSL,
            [NamedAxis::ANT_POST,   NamedAxis::SUP_INF, NamedAxis::RIGHT_LEFT] => Orientation3D::ASR,
            [NamedAxis::POST_ANT,   NamedAxis::SUP_INF, NamedAxis::RIGHT_LEFT] => Orientation3D::PSR,
            [NamedAxis::ANT_POST,   NamedAxis::INF_SUP, NamedAxis::LEFT_RIGHT] => Orientation3D::ASI,
            [NamedAxis::POST_ANT,   NamedAxis::INF_SUP, NamedAxis::LEFT_RIGHT] => Orientation3D::PSI,
            _ => Orientation3D::Unknown,
        }
    }
}

/* ─────────────────────────────────────────────────────────────────── */

#[cfg(test)]
mod tests {
    use super::*; // Import items from parent module

    #[test]
    fn test_named_axis_opposite() {
        assert_eq!(NamedAxis::LEFT_RIGHT.opposite(), NamedAxis::RIGHT_LEFT);
        assert_eq!(NamedAxis::POST_ANT.opposite(), NamedAxis::ANT_POST);
        assert_eq!(NamedAxis::INF_SUP.opposite(), NamedAxis::SUP_INF);
        assert_eq!(NamedAxis::RIGHT_LEFT.opposite(), NamedAxis::LEFT_RIGHT);
        assert_eq!(NamedAxis::TIME.opposite(), NamedAxis::TIME); // Non-spatial remains the same
        assert_eq!(NamedAxis::UNKNOWN.opposite(), NamedAxis::UNKNOWN);
    }

    #[test]
    fn test_axis_set_orientation() {
        let lpi_set = AxisSet3D { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::POST_ANT, NamedAxis::INF_SUP] };
        assert_eq!(lpi_set.orientation(), Orientation3D::LPI);

        let rai_set = AxisSet3D { axes: [NamedAxis::RIGHT_LEFT, NamedAxis::ANT_POST, NamedAxis::INF_SUP] };
        assert_eq!(rai_set.orientation(), Orientation3D::RAI);

        let asl_set = AxisSet3D { axes: [NamedAxis::ANT_POST, NamedAxis::SUP_INF, NamedAxis::LEFT_RIGHT] };
        assert_eq!(asl_set.orientation(), Orientation3D::ASL);

        // Test an unknown/non-standard orientation
        let unknown_set = AxisSet3D { axes: [NamedAxis::LEFT_RIGHT, NamedAxis::TIME, NamedAxis::POST_ANT] };
        assert_eq!(unknown_set.orientation(), Orientation3D::Unknown);
    }
}

//! Colormap metadata definitions

use crate::data::BuiltinColormap;
use serde::{Serialize, Deserialize};

/// Colormap category
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum ColormapCategory {
    Sequential = 0,
    Diverging = 1,
    Qualitative = 2,
    Clinical = 3,
}

/// Bit flags for colormap properties
#[derive(Debug, Clone, Copy)]
pub struct ColormapFlags(u8);

impl ColormapFlags {
    pub const PERCEPTUALLY_UNIFORM: u8 = 0b00000001;
    pub const COLORBLIND_SAFE: u8 = 0b00000010;
    pub const CLINICAL_APPROVED: u8 = 0b00000100;
    pub const PRINT_FRIENDLY: u8 = 0b00001000;
    
    pub const fn new(flags: u8) -> Self {
        Self(flags)
    }
    
    pub const fn is_perceptually_uniform(&self) -> bool {
        self.0 & Self::PERCEPTUALLY_UNIFORM != 0
    }
    
    pub const fn is_colorblind_safe(&self) -> bool {
        self.0 & Self::COLORBLIND_SAFE != 0
    }
    
    pub const fn is_clinical_approved(&self) -> bool {
        self.0 & Self::CLINICAL_APPROVED != 0
    }
    
    pub const fn is_print_friendly(&self) -> bool {
        self.0 & Self::PRINT_FRIENDLY != 0
    }
}

/// Minimal metadata for runtime
#[derive(Debug, Clone, Copy)]
pub struct ColormapInfo {
    pub id: BuiltinColormap,
    pub category: ColormapCategory,
    pub flags: ColormapFlags,
    /// Short name for display
    pub name: &'static str,
}

/// Static metadata table - compile time constant
pub const COLORMAP_INFO: [ColormapInfo; 14] = [
    ColormapInfo {
        id: BuiltinColormap::Grayscale,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(
            ColormapFlags::PERCEPTUALLY_UNIFORM | 
            ColormapFlags::COLORBLIND_SAFE |
            ColormapFlags::PRINT_FRIENDLY
        ),
        name: "Grayscale",
    },
    ColormapInfo {
        id: BuiltinColormap::Viridis,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(
            ColormapFlags::PERCEPTUALLY_UNIFORM | 
            ColormapFlags::COLORBLIND_SAFE
        ),
        name: "Viridis",
    },
    ColormapInfo {
        id: BuiltinColormap::Hot,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(0),
        name: "Hot",
    },
    ColormapInfo {
        id: BuiltinColormap::Cool,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(0),
        name: "Cool",
    },
    ColormapInfo {
        id: BuiltinColormap::Plasma,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(
            ColormapFlags::PERCEPTUALLY_UNIFORM | 
            ColormapFlags::COLORBLIND_SAFE
        ),
        name: "Plasma",
    },
    ColormapInfo {
        id: BuiltinColormap::Inferno,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(ColormapFlags::PERCEPTUALLY_UNIFORM),
        name: "Inferno",
    },
    ColormapInfo {
        id: BuiltinColormap::Magma,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(ColormapFlags::PERCEPTUALLY_UNIFORM),
        name: "Magma",
    },
    ColormapInfo {
        id: BuiltinColormap::Turbo,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(0),
        name: "Turbo",
    },
    ColormapInfo {
        id: BuiltinColormap::PetHotMetal,
        category: ColormapCategory::Clinical,
        flags: ColormapFlags::new(ColormapFlags::CLINICAL_APPROVED),
        name: "PET Hot Metal",
    },
    ColormapInfo {
        id: BuiltinColormap::FmriRedBlue,
        category: ColormapCategory::Diverging,
        flags: ColormapFlags::new(ColormapFlags::CLINICAL_APPROVED),
        name: "fMRI Red-Blue",
    },
    ColormapInfo {
        id: BuiltinColormap::Jet,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(0), // Not recommended but widely used
        name: "Jet",
    },
    ColormapInfo {
        id: BuiltinColormap::Parula,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(ColormapFlags::COLORBLIND_SAFE),
        name: "Parula",
    },
    ColormapInfo {
        id: BuiltinColormap::Hsv,
        category: ColormapCategory::Qualitative,
        flags: ColormapFlags::new(0),
        name: "HSV",
    },
    ColormapInfo {
        id: BuiltinColormap::Phase,
        category: ColormapCategory::Qualitative,
        flags: ColormapFlags::new(0),
        name: "Phase",
    },
];

/// Get metadata for a colormap
pub fn get_colormap_info(id: BuiltinColormap) -> Option<&'static ColormapInfo> {
    COLORMAP_INFO.iter().find(|info| info.id == id)
}

/// Get all colormaps in a category
pub fn get_by_category(category: ColormapCategory) -> Vec<&'static ColormapInfo> {
    COLORMAP_INFO.iter()
        .filter(|info| info.category == category)
        .collect()
}

/// Get all perceptually uniform colormaps
pub fn get_perceptually_uniform() -> Vec<&'static ColormapInfo> {
    COLORMAP_INFO.iter()
        .filter(|info| info.flags.is_perceptually_uniform())
        .collect()
}

/// Get all colorblind-safe colormaps
pub fn get_colorblind_safe() -> Vec<&'static ColormapInfo> {
    COLORMAP_INFO.iter()
        .filter(|info| info.flags.is_colorblind_safe())
        .collect()
}
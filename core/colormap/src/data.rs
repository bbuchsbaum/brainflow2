//! Compile-time colormap data definitions

/// Builtin colormap identifiers
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BuiltinColormap {
    Grayscale = 0,
    Viridis = 1,
    Hot = 2,
    Cool = 3,
    Plasma = 4,
    Inferno = 5,
    Magma = 6,
    Turbo = 7,
    PetHotMetal = 8,
    FmriRedBlue = 9,
    Jet = 10,
    Parula = 11,
    Hsv = 12,
    Phase = 13,
    Reserved14 = 14,
    Reserved15 = 15,
}

impl BuiltinColormap {
    /// Get colormap data - zero cost, returns reference to const data
    #[inline(always)]
    pub const fn data(&self) -> &'static [[u8; 4]; 256] {
        match self {
            Self::Grayscale => &GRAYSCALE,
            Self::Viridis => &VIRIDIS,
            Self::Hot => &HOT,
            Self::Cool => &COOL,
            Self::Plasma => &PLASMA,
            Self::Inferno => &INFERNO,
            Self::Magma => &MAGMA,
            Self::Turbo => &TURBO,
            Self::PetHotMetal => &PET_HOT_METAL,
            Self::FmriRedBlue => &FMRI_RED_BLUE,
            Self::Jet => &JET,
            Self::Parula => &PARULA,
            Self::Hsv => &HSV,
            Self::Phase => &PHASE,
            Self::Reserved14 => &GRAYSCALE, // fallback
            Self::Reserved15 => &GRAYSCALE, // fallback
        }
    }

    /// Get the numeric ID for this colormap
    pub const fn id(&self) -> u8 {
        *self as u8
    }

    /// Total count of builtin colormaps
    pub const COUNT: usize = 16;
}

/// Grayscale colormap - generated at compile time
pub const GRAYSCALE: [[u8; 4]; 256] = {
    let mut lut = [[0u8; 4]; 256];
    let mut i = 0;
    while i < 256 {
        lut[i] = [i as u8, i as u8, i as u8, 255];
        i += 1;
    }
    lut
};

/// Hot colormap - black to red to yellow to white
pub const HOT: [[u8; 4]; 256] = {
    let mut lut = [[0u8; 4]; 256];
    let mut i = 0;
    while i < 256 {
        let t = i as f32 / 255.0;
        let (r, g, b) = if t < 0.375 {
            // Black to red
            let s = t / 0.375;
            ((s * 255.0) as u8, 0, 0)
        } else if t < 0.75 {
            // Red to yellow
            let s = (t - 0.375) / 0.375;
            (255, (s * 255.0) as u8, 0)
        } else {
            // Yellow to white
            let s = (t - 0.75) / 0.25;
            (255, 255, (s * 255.0) as u8)
        };
        lut[i] = [r, g, b, 255];
        i += 1;
    }
    lut
};

/// Cool colormap - cyan to magenta
pub const COOL: [[u8; 4]; 256] = {
    let mut lut = [[0u8; 4]; 256];
    let mut i = 0;
    while i < 256 {
        let t = i as f32 / 255.0;
        lut[i] = [(t * 255.0) as u8, ((1.0 - t) * 255.0) as u8, 255, 255];
        i += 1;
    }
    lut
};

/// PET Hot Metal colormap for nuclear medicine
pub const PET_HOT_METAL: [[u8; 4]; 256] = {
    let mut lut = [[0u8; 4]; 256];
    let mut i = 0;
    while i < 256 {
        let t = i as f32 / 255.0;
        let (r, g, b) = if t < 0.33 {
            // Black to dark red
            let s = t * 3.0;
            ((s * 128.0) as u8, 0, 0)
        } else if t < 0.66 {
            // Dark red to bright red/orange
            let s = (t - 0.33) * 3.0;
            (128 + (s * 127.0) as u8, (s * 128.0) as u8, 0)
        } else {
            // Orange to yellow to white
            let s = (t - 0.66) * 3.0;
            (255, (128.0 + s * 127.0).min(255.0) as u8, (s * 255.0) as u8)
        };
        lut[i] = [r, g, b, 255];
        i += 1;
    }
    lut
};

/// fMRI activation map - blue (negative) to red (positive) with white at zero
pub const FMRI_RED_BLUE: [[u8; 4]; 256] = include!("colormaps/fmri_redblue.rs");

/// Phase colormap for complex-valued data (circular HSV)
pub const PHASE: [[u8; 4]; 256] = include!("colormaps/phase.rs");

/// HSV colormap
pub const HSV: [[u8; 4]; 256] = PHASE; // Same as phase for now

/// Placeholder for scientific colormaps - will be loaded from include files
pub const VIRIDIS: [[u8; 4]; 256] = include!("colormaps/viridis.rs");
pub const PLASMA: [[u8; 4]; 256] = include!("colormaps/plasma.rs");
pub const INFERNO: [[u8; 4]; 256] = include!("colormaps/inferno.rs");
pub const MAGMA: [[u8; 4]; 256] = include!("colormaps/magma.rs");
pub const TURBO: [[u8; 4]; 256] = include!("colormaps/turbo.rs");
pub const PARULA: [[u8; 4]; 256] = include!("colormaps/parula.rs");
pub const JET: [[u8; 4]; 256] = include!("colormaps/jet.rs");

/// All builtin colormaps packed for GPU upload
pub const BUILTIN_COLORMAPS: [[[u8; 4]; 256]; 16] = [
    GRAYSCALE,     // 0
    VIRIDIS,       // 1
    HOT,           // 2
    COOL,          // 3
    PLASMA,        // 4
    INFERNO,       // 5
    MAGMA,         // 6
    TURBO,         // 7
    PET_HOT_METAL, // 8
    FMRI_RED_BLUE, // 9
    JET,           // 10
    PARULA,        // 11
    HSV,           // 12
    PHASE,         // 13
    GRAYSCALE,     // 14 (reserved)
    GRAYSCALE,     // 15 (reserved)
];

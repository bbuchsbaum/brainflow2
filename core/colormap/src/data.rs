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
    ColdHot = 14,
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
            Self::ColdHot => &COLD_HOT,
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

/// Stops of the dark-centred diverging map, from the hidden band outward:
/// luminance rises with |v| (dark blue to light cyan below zero, dark red to
/// yellow above). The Set studio's population overlay
/// (`PopulationSliceService.ts`, `POPULATION_NEGATIVE`/`POPULATION_POSITIVE`)
/// uses the same stops.
pub const COLD_HOT_NEGATIVE: [[u8; 3]; 3] = [[25, 45, 120], [40, 110, 235], [150, 225, 255]];
pub const COLD_HOT_POSITIVE: [[u8; 3]; 3] = [[120, 20, 25], [230, 70, 30], [255, 235, 110]];
/// Share of the window around zero the map leaves at its darkest stop: the
/// Studio's hidden band (a tenth of the symmetric window), so the first shown
/// value is the first stop.
const COLD_HOT_BAND: f32 = 0.1;

const fn cold_hot_ramp(stops: &[[u8; 3]; 3], t: f32) -> [u8; 3] {
    let at = if t < 0.0 {
        0.0
    } else if t > 1.0 {
        2.0
    } else {
        t * 2.0
    };
    let i = if at >= 1.0 { 1 } else { 0 };
    let f = at - i as f32;
    let mut out = [0u8; 3];
    let mut c = 0;
    while c < 3 {
        let a = stops[i][c] as f32;
        let b = stops[i + 1][c] as f32;
        out[c] = (a + f * (b - a) + 0.5) as u8;
        c += 1;
    }
    out
}

/// Dark-centred diverging map ("cold-hot"): −max light cyan, near zero dark,
/// +max yellow; the darkest colours sit at the hidden band's edges.
pub const COLD_HOT: [[u8; 4]; 256] = {
    let mut lut = [[0u8; 4]; 256];
    let mut i = 0;
    while i < 256 {
        let v = i as f32 / 255.0 * 2.0 - 1.0;
        let a = if v < 0.0 { -v } else { v };
        let t = if a < COLD_HOT_BAND {
            0.0
        } else {
            (a - COLD_HOT_BAND) / (1.0 - COLD_HOT_BAND)
        };
        let rgb = if v < 0.0 {
            cold_hot_ramp(&COLD_HOT_NEGATIVE, t)
        } else {
            cold_hot_ramp(&COLD_HOT_POSITIVE, t)
        };
        lut[i] = [rgb[0], rgb[1], rgb[2], 255];
        i += 1;
    }
    lut
};

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
    COLD_HOT,      // 14
    GRAYSCALE,     // 15 (reserved)
];

//! GIfTI geometry decoding shared by desktop and browser hosts.
#[cfg(feature = "desktop")]
mod desktop;
pub mod geometry;
#[cfg(feature = "desktop")]
pub use desktop::*;

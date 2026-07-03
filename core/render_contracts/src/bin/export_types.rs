use render_contracts::*;
use ts_rs::TS;

fn export<T: TS + 'static>(name: &str) {
    if let Err(error) = T::export_all() {
        eprintln!("Warning: failed to export {name}: {error}");
    }
}

fn main() {
    println!("Exporting TypeScript render contract types...");

    export::<AlphaModConfig>("AlphaModConfig");
    export::<AlphaModMode>("AlphaModMode");
    export::<BlendMode>("BlendMode");
    export::<CameraState>("CameraState");
    export::<FrameDiagnostics>("FrameDiagnostics");
    export::<FrameReadbackMode>("FrameReadbackMode");
    export::<FrameRequestOptions>("FrameRequestOptions");
    export::<FrameResult>("FrameResult");
    export::<InterpolationMode>("InterpolationMode");
    export::<LayerConfig>("LayerConfig");
    export::<LayerMode>("LayerMode");
    export::<SliceOrientation>("SliceOrientation");
    export::<ThresholdConfig>("ThresholdConfig");
    export::<ThresholdMode>("ThresholdMode");
    export::<ViewId>("ViewId");
    export::<ViewState>("ViewState");

    // Shared view-geometry contract (single source of truth for the frontend
    // slice-frame math). Defined in `neuro-types`, exported here.
    export::<neuro_types::SliceGeometry>("SliceGeometry");
    export::<neuro_types::ViewRectMm>("ViewRectMm");

    println!("TypeScript render contract export completed");
}

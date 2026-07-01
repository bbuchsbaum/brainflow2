// This binary triggers ts-rs type generation
use bridge_types::*;
use ts_rs::TS;

fn main() {
    println!("Exporting TypeScript types from bridge_types...");

    // Export all types that implement TS trait
    // Using export_all() to include dependencies

    if let Err(e) = BridgeError::export_all() {
        eprintln!("Failed to export BridgeError: {}", e);
    }

    if let Err(e) = Loaded::export_all() {
        eprintln!("Failed to export Loaded: {}", e);
    }

    if let Err(e) = GpuUploadError::export_all() {
        eprintln!("Failed to export GpuUploadError: {}", e);
    }

    if let Err(e) = GpuTextureFormat::export_all() {
        eprintln!("Failed to export GpuTextureFormat: {}", e);
    }

    if let Err(e) = VolumeLayerGpuInfo::export_all() {
        eprintln!("Failed to export VolumeLayerGpuInfo: {}", e);
    }

    if let Err(e) = FlatNode::export_all() {
        eprintln!("Failed to export FlatNode: {}", e);
    }

    if let Err(e) = TreePayload::export_all() {
        eprintln!("Failed to export TreePayload: {}", e);
    }

    if let Err(e) = SliceInfo::export_all() {
        eprintln!("Failed to export SliceInfo: {}", e);
    }

    if let Err(e) = TextureCoordinates::export_all() {
        eprintln!("Failed to export TextureCoordinates: {}", e);
    }

    if let Err(e) = DataRange::export_all() {
        eprintln!("Failed to export DataRange: {}", e);
    }

    if let Err(e) = LayerPatch::export_all() {
        eprintln!("Failed to export LayerPatch: {}", e);
    }

    if let Err(e) = PeekVolumeMetadata::export_all() {
        eprintln!("Failed to export PeekVolumeMetadata: {}", e);
    }

    if let Err(e) = NiftiHeaderInfo::export_all() {
        eprintln!("Failed to export NiftiHeaderInfo: {}", e);
    }

    if let Err(e) = RemoteMountInfo::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = RemoteMountConnectRequest::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = RemoteMountConnectResult::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = RemoteMountProfile::export_all() {
        eprintln!("Warning: {e}");
    }

    if let Err(e) = BidsDatasetSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = BidsCoverageMatrix::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = BidsCoverageColumn::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = BidsCoverageCell::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = BidsParticipantRow::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = BidsTaskDesign::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = BidsEventRow::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = BidsValidationResult::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = BidsValidationIssue::export_all() {
        eprintln!("Warning: {e}");
    }

    if let Err(e) = StudioImportMode::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioSupportKind::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioAlignmentClass::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioExpressionKind::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioComparePaneStatus::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioCompareBindingKind::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioCompareCacheStatus::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioAuditSeverity::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioFeatureSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioCohortOriginKind::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioCohortSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioFieldExpressionSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioJoinIssueDetail::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioJoinAuditSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioSupportAuditSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioIngestAuditSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioImportReadiness::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioImportProvenanceKind::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioImportCapability::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioImportContract::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioDiscoveryRolePattern::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioDiscoveryDesignValue::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioDiscoveryRoleBinding::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioDiscoveryMemberGroup::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioDiscoveryPreviewSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioFieldBindingAvailability::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioFieldBindingSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioMemberSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioDesignRowPreview::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioDesignTablePreview::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = SpatialFieldSetSummary::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioMaterializationStatus::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioImportCandidate::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioImportPreviewRequest::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioGeneratedNeuroTabsFile::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioDiscoveryPromotionRequest::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioDiscoveryPromotionResult::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioComparePaneSpec::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioComparePaneBinding::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioReducerKind::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioReducerSpec::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioRoleBindingInput::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioCompareMaterializeRequest::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioMaterializationJobState::export_all() {
        eprintln!("Warning: {e}");
    }
    if let Err(e) = StudioMaterializationJobStatus::export_all() {
        eprintln!("Warning: {e}");
    }

    println!("TypeScript type export completed for bridge_types");
}

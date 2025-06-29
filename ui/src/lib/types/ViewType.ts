/**
 * Enum representing the different orthogonal view types for neuroimaging data
 */
export enum ViewType {
    Axial = 0,      // XY plane, Z-axis normal (horizontal slices)
    Coronal = 1,    // XZ plane, Y-axis normal (front-to-back slices)
    Sagittal = 2    // YZ plane, X-axis normal (left-to-right slices)
}

/**
 * Type guard to check if a value is a valid ViewType
 */
export function isViewType(value: unknown): value is ViewType {
    return typeof value === 'number' && value >= 0 && value <= 2;
}

/**
 * Get the display name for a ViewType
 */
export function getViewTypeName(viewType: ViewType): string {
    switch (viewType) {
        case ViewType.Axial:
            return 'Axial';
        case ViewType.Coronal:
            return 'Coronal';
        case ViewType.Sagittal:
            return 'Sagittal';
        default:
            return 'Unknown';
    }
}

/**
 * Get the axis that is perpendicular to the view plane
 */
export function getViewAxis(viewType: ViewType): 'x' | 'y' | 'z' {
    switch (viewType) {
        case ViewType.Axial:
            return 'z';
        case ViewType.Coronal:
            return 'y';
        case ViewType.Sagittal:
            return 'x';
        default:
            return 'z';
    }
}
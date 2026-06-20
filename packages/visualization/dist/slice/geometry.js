function crossProduct(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}
function magnitude(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}
function solveBasis2d(delta, u, v) {
    const detXY = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(detXY) > 1e-10) {
        return [
            (delta[0] * v[1] - delta[1] * v[0]) / detXY,
            (delta[1] * u[0] - delta[0] * u[1]) / detXY,
        ];
    }
    const detYZ = u[1] * v[2] - u[2] * v[1];
    if (Math.abs(detYZ) > 1e-10) {
        return [
            (delta[1] * v[2] - delta[2] * v[1]) / detYZ,
            (delta[2] * u[1] - delta[1] * u[2]) / detYZ,
        ];
    }
    const detXZ = u[0] * v[2] - u[2] * v[0];
    if (Math.abs(detXZ) > 1e-10) {
        return [
            (delta[0] * v[2] - delta[2] * v[0]) / detXZ,
            (delta[2] * u[0] - delta[0] * u[2]) / detXZ,
        ];
    }
    return null;
}
export function sliceImagePointToWorld(imageX, imageY, plane) {
    const [originX, originY, originZ] = plane.origin_mm;
    const [uX, uY, uZ] = plane.u_mm;
    const [vX, vY, vZ] = plane.v_mm;
    return [
        originX + imageX * uX + imageY * vX,
        originY + imageX * uY + imageY * vY,
        originZ + imageX * uZ + imageY * vZ,
    ];
}
export function worldToSliceImagePoint(worldMm, plane, toleranceMm = 0.5) {
    const delta = [
        worldMm[0] - plane.origin_mm[0],
        worldMm[1] - plane.origin_mm[1],
        worldMm[2] - plane.origin_mm[2],
    ];
    const normal = crossProduct(plane.u_mm, plane.v_mm);
    const normalMagnitude = magnitude(normal);
    if (normalMagnitude <= 1e-10)
        return null;
    const distanceMm = Math.abs(delta[0] * normal[0] + delta[1] * normal[1] + delta[2] * normal[2]) / normalMagnitude;
    if (distanceMm > toleranceMm)
        return null;
    return solveBasis2d(delta, plane.u_mm, plane.v_mm);
}
export function imagePointToCanvasPoint(imagePoint, placement) {
    const scaleX = placement.width / placement.imageWidth;
    const scaleY = placement.height / placement.imageHeight;
    return {
        canvasX: placement.x + imagePoint[0] * scaleX,
        canvasY: placement.y + imagePoint[1] * scaleY,
    };
}
export function projectWorldToCanvas(worldMm, plane, placement, toleranceMm = 0.5) {
    const imagePoint = worldToSliceImagePoint(worldMm, plane, toleranceMm);
    return imagePoint ? imagePointToCanvasPoint(imagePoint, placement) : null;
}
export function isCanvasPointInPlacement(canvasPoint, placement) {
    return (canvasPoint.canvasX >= placement.x &&
        canvasPoint.canvasX <= placement.x + placement.width &&
        canvasPoint.canvasY >= placement.y &&
        canvasPoint.canvasY <= placement.y + placement.height);
}
export function canvasPointToImagePoint(canvasPoint, placement) {
    if (!isCanvasPointInPlacement(canvasPoint, placement))
        return null;
    return [
        ((canvasPoint.canvasX - placement.x) / placement.width) * placement.imageWidth,
        ((canvasPoint.canvasY - placement.y) / placement.height) * placement.imageHeight,
    ];
}
export function clientPointToCanvasPoint(clientX, clientY, canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0)
        return null;
    return {
        canvasX: (clientX - rect.left) * (canvas.width / rect.width),
        canvasY: (clientY - rect.top) * (canvas.height / rect.height),
    };
}
export function clientPointToWorld(clientX, clientY, canvas, placement, plane) {
    const canvasPoint = clientPointToCanvasPoint(clientX, clientY, canvas);
    if (!canvasPoint)
        return null;
    const imagePoint = canvasPointToImagePoint(canvasPoint, placement);
    if (!imagePoint)
        return null;
    return sliceImagePointToWorld(imagePoint[0], imagePoint[1], plane);
}
//# sourceMappingURL=geometry.js.map
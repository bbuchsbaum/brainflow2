export function calculateImagePlacement(imageWidth, imageHeight, canvasWidth, canvasHeight) {
    const imageAspectRatio = imageWidth / imageHeight;
    const canvasAspectRatio = canvasWidth / canvasHeight;
    let drawWidth;
    let drawHeight;
    let drawX;
    let drawY;
    if (imageAspectRatio > canvasAspectRatio) {
        drawWidth = canvasWidth;
        drawHeight = drawWidth / imageAspectRatio;
        drawX = 0;
        drawY = (canvasHeight - drawHeight) / 2;
    }
    else {
        drawHeight = canvasHeight;
        drawWidth = drawHeight * imageAspectRatio;
        drawX = (canvasWidth - drawWidth) / 2;
        drawY = 0;
    }
    return {
        x: Math.round(drawX),
        y: Math.round(drawY),
        width: Math.round(drawWidth),
        height: Math.round(drawHeight),
        imageWidth,
        imageHeight,
    };
}
export function drawScaledImage(ctx, image, canvasWidth, canvasHeight) {
    const placement = calculateImagePlacement(image.width, image.height, canvasWidth, canvasHeight);
    ctx.drawImage(image, placement.x, placement.y, placement.width, placement.height);
    return placement;
}
//# sourceMappingURL=canvasUtils.js.map
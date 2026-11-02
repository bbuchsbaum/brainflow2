/** One pointer and one tool own a stroke until up/cancel; secondary contacts never steal it. */
export class ViewportPointerController {
    tool = null;
    owner = null;
    select(tool) {
        if (tool === this.tool)
            return;
        this.cancel('tool-changed');
        this.tool = tool;
    }
    down(samples) {
        const first = samples[0];
        if (!first || first.button !== 0)
            return false;
        // Swallow another primary contact while a stroke is in progress. It must
        // neither start a second stroke nor move the default crosshair.
        if (this.owner)
            return true;
        const tool = this.tool;
        if (!tool || !tool.pointerDown(samples))
            return false;
        this.owner = { pointerId: first.pointerId, tool };
        return true;
    }
    move(samples) {
        if (!this.owner || samples[0]?.pointerId !== this.owner.pointerId)
            return false;
        this.owner.tool.pointerMove(samples);
        return true;
    }
    up(samples) {
        const owner = this.owner;
        if (!owner || samples[0]?.pointerId !== owner.pointerId)
            return false;
        this.owner = null;
        owner.tool.pointerUp(samples);
        return true;
    }
    owns(pointerId) { return this.owner?.pointerId === pointerId; }
    cancel(reason) {
        const owner = this.owner;
        this.owner = null;
        owner?.tool.cancel(reason);
    }
}
//# sourceMappingURL=pointerTools.js.map
type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<any>;
export declare function configureInvoker(invokeFn: InvokeFn): void;
export declare function setLayerBorder(layerId: string, enabled: boolean, thicknessPx?: number): Promise<void>;
export declare function sampleLayerValueAtWorld(layerId: string, worldCoords: [number, number, number]): Promise<number>;
export declare function pixelToWorld(x: number, y: number, width: number, height: number, origin_mm: [number, number, number, number], u_mm: [number, number, number, number], v_mm: [number, number, number, number]): [number, number, number];
export {};

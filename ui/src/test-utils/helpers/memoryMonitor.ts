/**
 * Memory monitoring utilities for tests
 */

export interface MemorySnapshot {
	heapUsed: number;
	heapTotal: number;
	external: number;
	rss: number;
	timestamp: number;
}

export class MemoryMonitor {
	private snapshots: MemorySnapshot[] = [];
	private threshold: number;

	constructor(thresholdMB: number = 500) {
		this.threshold = thresholdMB * 1024 * 1024;
	}

	snapshot(label?: string): MemorySnapshot {
		if (global.gc) {
			global.gc();
		}

		const memUsage = process.memoryUsage();
		const snapshot: MemorySnapshot = {
			heapUsed: memUsage.heapUsed,
			heapTotal: memUsage.heapTotal,
			external: memUsage.external,
			rss: memUsage.rss,
			timestamp: Date.now()
		};

		this.snapshots.push(snapshot);

		if (label) {
			console.log(
				`Memory snapshot [${label}]: ${this.formatBytes(snapshot.heapUsed)} / ${this.formatBytes(snapshot.heapTotal)}`
			);
		}

		if (snapshot.heapUsed > this.threshold) {
			console.warn(`⚠️ High memory usage detected: ${this.formatBytes(snapshot.heapUsed)}`);
		}

		return snapshot;
	}

	getGrowth(): number {
		if (this.snapshots.length < 2) return 0;
		const first = this.snapshots[0];
		const last = this.snapshots[this.snapshots.length - 1];
		return last.heapUsed - first.heapUsed;
	}

	reset(): void {
		this.snapshots = [];
	}

	private formatBytes(bytes: number): string {
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	}

	report(): void {
		const growth = this.getGrowth();
		console.log(`Memory growth: ${this.formatBytes(growth)}`);
		console.log(
			`Peak usage: ${this.formatBytes(Math.max(...this.snapshots.map((s) => s.heapUsed)))}`
		);
	}
}

// Global instance for test monitoring
export const testMemoryMonitor = new MemoryMonitor();

// Helper to wrap test functions with memory monitoring
export function withMemoryMonitoring<T extends (...args: any[]) => any>(
	testFn: T,
	label?: string
): T {
	return (async (...args: any[]) => {
		testMemoryMonitor.snapshot(`${label || 'test'} - start`);
		try {
			const result = await testFn(...args);
			return result;
		} finally {
			testMemoryMonitor.snapshot(`${label || 'test'} - end`);
			const growth = testMemoryMonitor.getGrowth();
			if (growth > 50 * 1024 * 1024) {
				// 50MB growth
				console.warn(
					`⚠️ Test "${label}" increased memory by ${(growth / 1024 / 1024).toFixed(2)} MB`
				);
			}
		}
	}) as T;
}

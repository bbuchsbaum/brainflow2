/**
 * Diagnostic logger for debugging NIfTI loading and GPU rendering
 */
export class DiagnosticLogger {
	private logs: Array<{ timestamp: number; level: string; message: string; data?: any }> = [];
	private startTime = Date.now();

	log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any) {
		const entry = {
			timestamp: Date.now() - this.startTime,
			level,
			message,
			data
		};

		this.logs.push(entry);

		// Also log to console with styling
		const style = {
			info: 'color: #2196F3',
			warn: 'color: #FF9800',
			error: 'color: #F44336',
			debug: 'color: #9E9E9E'
		}[level];

		console.log(`%c[${level.toUpperCase()}] ${entry.timestamp}ms: ${message}`, style, data || '');
	}

	info(message: string, data?: any) {
		this.log('info', message, data);
	}

	warn(message: string, data?: any) {
		this.log('warn', message, data);
	}

	error(message: string, data?: any) {
		this.log('error', message, data);
	}

	debug(message: string, data?: any) {
		this.log('debug', message, data);
	}

	async checkpoint(name: string, fn: () => Promise<any>) {
		const start = Date.now();
		this.info(`Starting: ${name}`);

		try {
			const result = await fn();
			const duration = Date.now() - start;
			this.info(`Completed: ${name} (${duration}ms)`, result);
			return result;
		} catch (error) {
			const duration = Date.now() - start;
			this.error(`Failed: ${name} (${duration}ms)`, error);
			throw error;
		}
	}

	getDiagnosticReport() {
		const report = {
			totalDuration: Date.now() - this.startTime,
			logCount: this.logs.length,
			errorCount: this.logs.filter((l) => l.level === 'error').length,
			warnCount: this.logs.filter((l) => l.level === 'warn').length,
			logs: this.logs
		};

		console.group('%cDiagnostic Report', 'font-weight: bold; color: #673AB7');
		console.log(`Total Duration: ${report.totalDuration}ms`);
		console.log(
			`Logs: ${report.logCount} (Errors: ${report.errorCount}, Warnings: ${report.warnCount})`
		);
		console.table(
			this.logs.map((l) => ({
				time: `${l.timestamp}ms`,
				level: l.level,
				message: l.message
			}))
		);
		console.groupEnd();

		return report;
	}

	reset() {
		this.logs = [];
		this.startTime = Date.now();
	}
}

// Global instance for easy access
export const diagnosticLogger = new DiagnosticLogger();

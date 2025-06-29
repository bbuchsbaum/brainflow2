import { Logger } from 'tslog';

// Determine log level based on environment (Vite)
const minLevel = import.meta.env.DEV ? 2 : 3; // 0: silly, 1: trace, 2: debug, 3: info, 4: warn, 5: error, 6: fatal

export const uiLogger = new Logger({
    name: 'UI',       // Name prefix for log messages
    minLevel: minLevel,
    // Optional: Customize display settings
    // displayInstanceName: false,
    // displayLoggerName: true,
    // displayFilePath: 'hidden', 
    // displayFunctionName: false,
});

// Example Usage:
// uiLogger.silly("I am a silly log.");
// uiLogger.trace("I am a trace log with details:", { data: 'some data' });
// uiLogger.debug("I am a debug log.");
// uiLogger.info("I am an info log.");
// uiLogger.warn("I am a warning log.");
// uiLogger.error("I am an error log.", new Error("Something went wrong"));
// uiLogger.fatal("I am a fatal log.");

console.log(`UI Logger initialized with minLevel: ${minLevel}`);
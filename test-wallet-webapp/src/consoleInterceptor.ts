// Global console interceptor for capturing all logs
type LogCallback = (prefix: string, message: string) => void;

let logCallback: LogCallback | null = null;

// Store original console methods
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;
const originalDebug = console.debug;
const originalTrace = console.trace;
const originalDir = console.dir;
const originalTable = console.table;

// Helper to format console arguments
const formatArgs = (...args: any[]) => {
  const parts: string[] = [];
  let pinoLog: any = null;

  for (const arg of args) {
    if (typeof arg === 'object' && arg !== null) {
      try {
        // Check if this is a pino module identifier object (first object with just "module" field)
        if (arg.module && Object.keys(arg).length === 1 && !pinoLog) {
          pinoLog = { module: arg.module };
          continue;
        }

        // Check if this is a pino metadata object (second empty/small object)
        if (pinoLog && Object.keys(arg).length === 0) {
          continue;
        }

        // If we have accumulated pino data and this is an object with useful info
        if (pinoLog && Object.keys(arg).length > 0) {
          // Merge the metadata if it's meaningful
          const meaningfulKeys = Object.keys(arg).filter(k =>
            !['level', 'time', 'hostname', 'pid'].includes(k)
          );

          if (meaningfulKeys.length > 0) {
            const metadata = meaningfulKeys.map(k => `${k}=${JSON.stringify(arg[k])}`).join(', ');
            parts.push(`(${metadata})`);
          }
          continue;
        }

        // Otherwise, stringify the object
        parts.push(JSON.stringify(arg, null, 2));
      } catch {
        parts.push(String(arg));
      }
    } else {
      parts.push(String(arg));
    }
  }

  // Format the final message
  if (pinoLog) {
    const module = pinoLog.module ? `[${pinoLog.module}]` : '';
    const message = parts.join(' ').trim();
    return `${module} ${message}`.trim();
  }

  return parts.join(' ').trim();
};

// Intercept function
const createInterceptor = (method: any, prefix: string) => {
  return (...args: any[]) => {
    const message = formatArgs(...args);
    if (message.trim() && logCallback) {
      logCallback(prefix, message);
    }
    method.apply(console, args);
  };
};

// Override console methods globally
console.log = createInterceptor(originalLog, '[LOG]');
console.error = createInterceptor(originalError, '[ERROR]');
console.warn = createInterceptor(originalWarn, '[WARN]');
console.info = createInterceptor(originalInfo, '[INFO]');
console.debug = createInterceptor(originalDebug, '[DEBUG]');
console.trace = createInterceptor(originalTrace, '[TRACE]');
console.dir = createInterceptor(originalDir, '[DIR]');
console.table = createInterceptor(originalTable, '[TABLE]');

export const setLogCallback = (callback: LogCallback | null) => {
  logCallback = callback;
};

export const restoreConsole = () => {
  console.log = originalLog;
  console.error = originalError;
  console.warn = originalWarn;
  console.info = originalInfo;
  console.debug = originalDebug;
  console.trace = originalTrace;
  console.dir = originalDir;
  console.table = originalTable;
};

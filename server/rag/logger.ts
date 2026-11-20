type LogLevel = 'INFO' | 'WARN' | 'ERROR';

function writeLog(
  level: LogLevel,
  moduleName: string,
  message: string,
  meta?: Record<string, unknown>
) {
  const timestamp = new Date().toISOString();
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  const line = `[${timestamp}] [${level}] [RAG:${moduleName}] ${message}${payload}`;

  if (level === 'ERROR') {
    console.error(line);
  } else if (level === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createLogger(moduleName: string) {
  return {
    info: (message: string, meta?: Record<string, unknown>) =>
      writeLog('INFO', moduleName, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) =>
      writeLog('WARN', moduleName, message, meta),
    error: (message: string, meta?: Record<string, unknown>) =>
      writeLog('ERROR', moduleName, message, meta),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type LogCallback = (prefix: string, message: string) => void

let logCallback: LogCallback | null = null

const originalLog = console.log
const originalError = console.error
const originalWarn = console.warn
const originalInfo = console.info
const originalDebug = console.debug

const formatArgs = (...args: any[]) => {
  const parts: string[] = []
  let pinoLog: any = null

  for (const arg of args) {
    if (typeof arg === 'object' && arg !== null) {
      try {
        if (arg.module && Object.keys(arg).length === 1 && !pinoLog) {
          pinoLog = { module: arg.module }
          continue
        }
        if (pinoLog && Object.keys(arg).length === 0) continue
        if (pinoLog && Object.keys(arg).length > 0) {
          const meaningfulKeys = Object.keys(arg).filter(
            (k) => !['level', 'time', 'hostname', 'pid'].includes(k),
          )
          if (meaningfulKeys.length > 0) {
            const metadata = meaningfulKeys.map((k) => `${k}=${JSON.stringify(arg[k])}`).join(', ')
            parts.push(`(${metadata})`)
          }
          continue
        }
        parts.push(JSON.stringify(arg, null, 2))
      } catch {
        parts.push(String(arg))
      }
    } else {
      parts.push(String(arg))
    }
  }

  if (pinoLog) {
    const module = pinoLog.module ? `[${pinoLog.module}]` : ''
    return `${module} ${parts.join(' ').trim()}`.trim()
  }
  return parts.join(' ').trim()
}

const createInterceptor = (method: any, prefix: string) => {
  return (...args: any[]) => {
    const message = formatArgs(...args)
    if (message.trim() && logCallback) logCallback(prefix, message)
    method.apply(console, args)
  }
}

console.log = createInterceptor(originalLog, '[LOG]')
console.error = createInterceptor(originalError, '[ERROR]')
console.warn = createInterceptor(originalWarn, '[WARN]')
console.info = createInterceptor(originalInfo, '[INFO]')
console.debug = createInterceptor(originalDebug, '[DEBUG]')

export const setLogCallback = (callback: LogCallback | null) => {
  logCallback = callback
}

/**
 * Debounce utility - Native replacement for lodash debounce
 * Delays function execution until after wait milliseconds have elapsed
 */

export interface DebouncedFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): Promise<ReturnType<T>>;
  cancel: () => void;
  flush: () => Promise<ReturnType<T> | undefined>;
  pending: () => boolean;
}

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * @param func The function to debounce
 * @param wait The number of milliseconds to delay
 * @param options Options object
 * @returns The debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  options?: {
    leading?: boolean;
    trailing?: boolean;
    maxWait?: number;
  }
): DebouncedFunction<T> {
  let timeoutId: number | null = null;
  let maxTimeoutId: number | null = null;
  let lastCallTime: number | null = null;
  let lastInvokeTime = 0;
  let leading = options?.leading ?? false;
  let trailing = options?.trailing ?? true;
  let maxWait = options?.maxWait;
  let lastArgs: Parameters<T> | null = null;
  let lastThis: any = null;
  let result: ReturnType<T> | undefined;
  
  function invokeFunc(time: number): ReturnType<T> {
    const args = lastArgs!;
    const thisArg = lastThis;
    
    lastArgs = null;
    lastThis = null;
    lastInvokeTime = time;
    
    result = func.apply(thisArg, args);
    return result;
  }
  
  function startTimer(pendingFunc: () => void, wait: number): number {
    return window.setTimeout(pendingFunc, wait);
  }
  
  function cancelTimer(id: number | null): void {
    if (id !== null) {
      clearTimeout(id);
    }
  }
  
  function leadingEdge(time: number): ReturnType<T> | undefined {
    lastInvokeTime = time;
    timeoutId = startTimer(timerExpired, wait);
    return leading ? invokeFunc(time) : result;
  }
  
  function remainingWait(time: number): number {
    const timeSinceLastCall = time - (lastCallTime ?? 0);
    const timeSinceLastInvoke = time - lastInvokeTime;
    const timeWaiting = wait - timeSinceLastCall;
    
    return maxWait !== undefined
      ? Math.min(timeWaiting, maxWait - timeSinceLastInvoke)
      : timeWaiting;
  }
  
  function shouldInvoke(time: number): boolean {
    const timeSinceLastCall = time - (lastCallTime ?? 0);
    const timeSinceLastInvoke = time - lastInvokeTime;
    
    return (
      lastCallTime === null ||
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      (maxWait !== undefined && timeSinceLastInvoke >= maxWait)
    );
  }
  
  function timerExpired(): void {
    const time = Date.now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    timeoutId = startTimer(timerExpired, remainingWait(time));
  }
  
  function trailingEdge(time: number): void {
    timeoutId = null;
    
    if (trailing && lastArgs) {
      invokeFunc(time);
    } else {
      lastArgs = null;
      lastThis = null;
    }
  }
  
  function cancel(): void {
    if (timeoutId !== null) {
      cancelTimer(timeoutId);
    }
    if (maxTimeoutId !== null) {
      cancelTimer(maxTimeoutId);
    }
    lastInvokeTime = 0;
    lastArgs = null;
    lastCallTime = null;
    lastThis = null;
    timeoutId = null;
    maxTimeoutId = null;
  }
  
  function flush(): Promise<ReturnType<T> | undefined> {
    return new Promise((resolve) => {
      if (timeoutId === null) {
        resolve(result);
      } else {
        cancelTimer(timeoutId);
        resolve(invokeFunc(Date.now()));
      }
    });
  }
  
  function pending(): boolean {
    return timeoutId !== null;
  }
  
  function debounced(
    this: any,
    ...args: Parameters<T>
  ): Promise<ReturnType<T>> {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);
    
    lastArgs = args;
    lastThis = this;
    lastCallTime = time;
    
    if (isInvoking) {
      if (timeoutId === null) {
        return Promise.resolve(leadingEdge(time)!);
      }
      if (maxWait !== undefined) {
        timeoutId = startTimer(timerExpired, wait);
        return Promise.resolve(invokeFunc(time));
      }
    }
    
    if (timeoutId === null) {
      timeoutId = startTimer(timerExpired, wait);
    }
    
    return new Promise((resolve) => {
      const originalTimeout = timeoutId;
      const checkResult = () => {
        if (timeoutId !== originalTimeout || result !== undefined) {
          resolve(result!);
        } else {
          setTimeout(checkResult, 10);
        }
      };
      checkResult();
    });
  }
  
  debounced.cancel = cancel;
  debounced.flush = flush;
  debounced.pending = pending;
  
  return debounced;
}
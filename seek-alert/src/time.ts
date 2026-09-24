export function perthNowParts(): { date: string; time: string } {
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: "Australia/Perth" });
  const time = now.toLocaleTimeString("en-AU", {
    timeZone: "Australia/Perth",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // hour12:false 在某些 Node/ICU 环境下午夜返回 "24:xx" 而非 "00:xx"，需显式指定 h23
  });
  return { date, time };
}

// 给可能永远挂起的 Promise 加上限时：超时后 reject，避免调用方一直等下去
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

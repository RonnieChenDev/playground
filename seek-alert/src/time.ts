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

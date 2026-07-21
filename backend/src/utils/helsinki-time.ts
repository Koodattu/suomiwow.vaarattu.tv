import { CCG_TIME_ZONE } from "../config/ccg";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CCG_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getHelsinkiDateKey(date: Date = new Date()): string {
  const parts = dateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Unable to resolve Helsinki date");
  return `${year}-${month}-${day}`;
}

export function getNextHelsinkiReset(date: Date = new Date()): Date {
  const currentKey = getHelsinkiDateKey(date);
  let lower = date.getTime();
  let upper = lower + 60 * 60 * 1000;

  while (getHelsinkiDateKey(new Date(upper)) === currentKey) {
    upper += 60 * 60 * 1000;
    if (upper - lower > 27 * 60 * 60 * 1000) throw new Error("Unable to resolve next Helsinki reset");
  }

  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (getHelsinkiDateKey(new Date(middle)) === currentKey) lower = middle;
    else upper = middle;
  }

  return new Date(upper);
}

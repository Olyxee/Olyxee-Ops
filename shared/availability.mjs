// Availability rules shared by the app and its tests.
// "Out of office" is a status a person sets themselves, optionally with the day they are back. While it is in force it
// wins over everything else (even if they sign in), and it lapses by itself once the return date has passed.

export { localDay, shortDate } from "./agenda.mjs";

/** status: { availability, outUntil? } as saved by the person. today: 'YYYY-MM-DD'. */
export function isOutOfOffice(status, today) {
  if (!status || status.availability !== "Out of office") return false;
  return !status.outUntil || status.outUntil >= today;     // no return date: out until they change it; the return day itself is still out
}

/** 'Out of office' -> 'out-of-office' (a safe CSS class name). */
export const availabilitySlug = (value) => String(value || "offline").toLowerCase().replace(/\s+/g, "-");

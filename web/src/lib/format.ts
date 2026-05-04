export function minutesToHours(min: number): string {
  return (min / 60).toFixed(1);
}

export function secondsToHours(sec: number | null | undefined): string {
  if (sec == null) return "—";
  return (sec / 3600).toFixed(1);
}

export function diffHours(estSec: number | null | undefined, workedMin: number): string {
  if (estSec == null) return "—";
  const d = estSec / 3600 - workedMin / 60;
  const s = d >= 0 ? "+" : "";
  return `${s}${d.toFixed(1)}`;
}

export function minutesToCzk(
  minutes: number,
  ratePerHourCzk: number | null | undefined,
): number | null {
  if (ratePerHourCzk == null) return null;
  return Math.ceil((minutes / 60) * ratePerHourCzk);
}

export function formatCzk(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `${amount.toLocaleString("cs-CZ")} Kč`;
}

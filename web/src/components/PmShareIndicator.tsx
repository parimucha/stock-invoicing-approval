import { minutesToHours } from "@/lib/format";

type Props = {
  pmMinutes: number;
  invoiceableMinutes: number;
  capPercent?: number;
  className?: string;
};

export function PmShareIndicator({
  pmMinutes,
  invoiceableMinutes,
  capPercent = 20,
  className = "",
}: Props) {
  if (invoiceableMinutes <= 0) return null;
  const pct = (pmMinutes / invoiceableMinutes) * 100;
  const over = pct > capPercent;
  const barPct = Math.min(100, pct);
  const markerPct = Math.min(100, capPercent);

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-neutral-700">PM share of invoiceable</span>
        <span
          className={`font-medium ${over ? "text-red-700" : "text-green-700"}`}
        >
          {pct.toFixed(1)}% · {over ? `over ${capPercent}% cap` : `within ${capPercent}% cap`}
        </span>
      </div>
      <div
        className="relative h-2 bg-neutral-100 rounded overflow-hidden"
        title={`${minutesToHours(pmMinutes)} h PM of ${minutesToHours(invoiceableMinutes)} h invoiceable`}
      >
        <div
          className={`absolute inset-y-0 left-0 ${over ? "bg-red-500" : "bg-green-500"}`}
          style={{ width: `${barPct}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-neutral-700"
          style={{ left: `${markerPct}%` }}
        />
      </div>
      <div className="text-xs text-neutral-500">
        {minutesToHours(pmMinutes)} h PM · {minutesToHours(invoiceableMinutes)} h invoiceable
      </div>
    </div>
  );
}

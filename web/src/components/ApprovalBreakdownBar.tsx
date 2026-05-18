import { formatCzk, minutesToCzk, minutesToHours } from "@/lib/format";

type Tone = "green" | "amber" | "red" | "neutral";

export type BreakdownSegment = {
  key: string;
  label: string;
  minutes: number;
  tone: Tone;
};

const BAR_STYLES: Record<Tone, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  neutral: "bg-neutral-400",
};

const DOT_STYLES: Record<Tone, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  neutral: "bg-neutral-400",
};

type Props = {
  segments: BreakdownSegment[];
  hourlyRateCzk: number | null;
  className?: string;
};

// At-a-glance stacked bar of all work logged on the report broken down by
// approval state. Segments render in the order supplied; zero-minute
// segments stay in the legend (the absence of pending or rejected is
// itself useful info) but are skipped in the bar so they don't render as
// invisible 0-width divs.
export function ApprovalBreakdownBar({
  segments,
  hourlyRateCzk,
  className = "",
}: Props) {
  const totalMinutes = segments.reduce((s, x) => s + x.minutes, 0);
  if (totalMinutes <= 0) return null;
  const totalCost = minutesToCzk(totalMinutes, hourlyRateCzk);

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-neutral-700">Approval breakdown</span>
        <span className="font-medium text-neutral-800">
          {minutesToHours(totalMinutes)} h logged
          {totalCost != null && (
            <span className="text-neutral-500 font-normal">
              {" "}· {formatCzk(totalCost)}
            </span>
          )}
        </span>
      </div>

      <div
        className="flex h-2 w-full overflow-hidden rounded bg-neutral-100"
        title={`${minutesToHours(totalMinutes)} h total`}
      >
        {segments.map((s) => {
          if (s.minutes <= 0) return null;
          const pct = (s.minutes / totalMinutes) * 100;
          return (
            <div
              key={s.key}
              className={BAR_STYLES[s.tone]}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${minutesToHours(s.minutes)} h (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
        {segments.map((s) => {
          const pct = totalMinutes > 0 ? (s.minutes / totalMinutes) * 100 : 0;
          const cost = minutesToCzk(s.minutes, hourlyRateCzk);
          return (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 rounded-full ${DOT_STYLES[s.tone]}`}
              />
              <span className="text-neutral-700">{s.label}</span>
              <span className="font-medium text-neutral-800">
                {minutesToHours(s.minutes)} h
              </span>
              <span className="text-neutral-500">· {pct.toFixed(0)}%</span>
              {cost != null && (
                <span className="text-neutral-500">· {formatCzk(cost)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

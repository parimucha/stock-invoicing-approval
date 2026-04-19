type Props = {
  workedMinutes: number;
  estimatedSeconds: number | null;
  className?: string;
};

export function BudgetBar({ workedMinutes, estimatedSeconds, className = "" }: Props) {
  const estMinutes = estimatedSeconds ? estimatedSeconds / 60 : null;
  const base = `relative h-2.5 rounded overflow-hidden ${className}`;

  if (workedMinutes <= 0 && !estMinutes) {
    return <div className={`${base} bg-neutral-100`} />;
  }

  if (estMinutes == null) {
    return (
      <div className={`${base} bg-neutral-100`} title="No estimate">
        <div className="absolute inset-y-0 left-0 right-0 bg-neutral-300" />
      </div>
    );
  }

  const max = Math.max(workedMinutes, estMinutes, 1);
  const workedInBudget = Math.min(workedMinutes, estMinutes);
  const over = Math.max(0, workedMinutes - estMinutes);
  const inPct = (workedInBudget / max) * 100;
  const overPct = (over / max) * 100;

  const title =
    over > 0
      ? `Worked ${round(workedMinutes / 60)} h — ${round(over / 60)} h over estimate`
      : `Worked ${round(workedMinutes / 60)} h of ${round(estMinutes / 60)} h estimate`;

  return (
    <div className={`${base} bg-neutral-100`} title={title}>
      <div
        className="absolute inset-y-0 left-0 bg-emerald-500"
        style={{ width: `${inPct}%` }}
      />
      {overPct > 0 && (
        <div
          className="absolute inset-y-0 bg-red-500"
          style={{ left: `${inPct}%`, width: `${overPct}%` }}
        />
      )}
    </div>
  );
}

function round(n: number): string {
  return n.toFixed(n < 10 ? 1 : 0);
}

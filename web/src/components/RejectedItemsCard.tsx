import { formatCzk, minutesToCzk, minutesToHours } from "@/lib/format";
import { JiraLink } from "@/components/JiraLink";

export type RejectedItem = {
  id: number;
  jiraKey: string | null;
  summary: string;
  workedMinutes: number;
  reviewerComment: string | null;
};

type Props = {
  items: RejectedItem[];
  hourlyRateCzk: number | null;
  jiraBaseUrl: string | null;
};

// Rejected items are excluded from invoice totals (consistent with how
// `internal` items are excluded) and surfaced here so the reviewer and
// admin can both see exactly what's being dropped from the invoice and
// why. Renders nothing when there's nothing rejected.
export function RejectedItemsCard({ items, hourlyRateCzk, jiraBaseUrl }: Props) {
  if (items.length === 0) return null;

  const totalMinutes = items.reduce((s, i) => s + i.workedMinutes, 0);
  const totalCost = minutesToCzk(totalMinutes, hourlyRateCzk);

  return (
    <section className="bg-white border border-red-200 rounded-lg p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-red-900">Rejected by client</h2>
        <span className="text-sm text-neutral-600">
          {items.length} {items.length === 1 ? "item" : "items"} ·{" "}
          <span className="font-medium text-neutral-800">
            {minutesToHours(totalMinutes)} h
          </span>
          {totalCost != null && (
            <>
              {" "}·{" "}
              <span className="font-medium text-neutral-800">
                {formatCzk(totalCost)}
              </span>
            </>
          )}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Excluded from the invoice totals above. Listed here for visibility.
      </p>

      <table className="mt-4 w-full text-sm">
        <tbody>
          {items.map((it) => {
            const cost = minutesToCzk(it.workedMinutes, hourlyRateCzk);
            return (
              <tr key={it.id} className="border-t border-neutral-100 first:border-t-0 align-top">
                <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
                  {it.jiraKey ? (
                    <JiraLink
                      jiraKey={it.jiraKey}
                      jiraBaseUrl={jiraBaseUrl}
                      className="hover:underline text-neutral-700"
                    />
                  ) : (
                    <span className="text-neutral-400">PM</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="text-neutral-800">{it.summary}</div>
                  {it.reviewerComment && (
                    <div className="mt-0.5 text-xs italic text-neutral-600">
                      “{it.reviewerComment}”
                    </div>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap font-medium">
                  {minutesToHours(it.workedMinutes)} h
                </td>
                {hourlyRateCzk != null && (
                  <td className="py-2 pl-3 text-right whitespace-nowrap text-neutral-600 w-24">
                    {cost != null ? formatCzk(cost) : "—"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

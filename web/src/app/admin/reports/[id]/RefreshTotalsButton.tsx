"use client";

import { useActionState } from "react";
import { refreshLifetimeTotals, type RefreshTotalsResult } from "./actions";

type Props = {
  reportId: number;
};

export function RefreshTotalsButton({ reportId }: Props) {
  const [state, action, pending] = useActionState<RefreshTotalsResult | null, FormData>(
    refreshLifetimeTotals,
    null,
  );

  return (
    <form action={action} className="flex items-center gap-3 flex-wrap">
      <input type="hidden" name="reportId" value={reportId} />
      <button
        type="submit"
        disabled={pending}
        className="border border-neutral-300 rounded px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-60"
      >
        {pending ? "Refreshing from Productive…" : "Refresh lifetime totals"}
      </button>
      {state && <ResultText state={state} />}
    </form>
  );
}

function ResultText({ state }: { state: RefreshTotalsResult }) {
  if (!state.ok) {
    return (
      <span className="text-xs text-red-700" role="alert">
        {state.error}
      </span>
    );
  }
  if (state.keysQueried === 0) {
    return <span className="text-xs text-neutral-500">No JIRA items in this report.</span>;
  }
  const parts = [`${state.updated} updated`, `${state.unchanged} already current`];
  if (state.missingFromProductive > 0) {
    parts.push(`${state.missingFromProductive} not in Productive`);
  }
  return (
    <span className="text-xs text-green-700">✓ {parts.join(" · ")}</span>
  );
}

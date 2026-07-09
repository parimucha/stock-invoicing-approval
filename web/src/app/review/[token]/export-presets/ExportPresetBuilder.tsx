"use client";

import { useMemo, useState } from "react";
import {
  computeExportModel,
  type ExportInput,
  type ExportPresetConfig,
  type TicketColumnKey,
} from "@/lib/invoice-export";
import { createPreset, updatePreset, deletePreset } from "./actions";

const ALL_COLUMNS: TicketColumnKey[] = [
  "month",
  "country",
  "ticket",
  "description",
  "hours",
  "note",
  "status",
  "parent",
  "estimate",
];
const COLUMN_LABEL: Record<TicketColumnKey, string> = {
  month: "Month",
  country: "Country",
  ticket: "Ticket",
  description: "Description",
  hours: "Hours",
  note: "Note",
  status: "Status",
  parent: "Parent",
  estimate: "Estimate (h)",
};
const DEFAULT_COLUMNS: TicketColumnKey[] = [
  "month",
  "country",
  "ticket",
  "description",
  "hours",
  "note",
];

type ProjectLite = { id: string; name: string };
type PresetLite = { id: string; name: string; config: ExportPresetConfig };
type UiGroup = { label: string; projectIds: string[] };

function move<T>(arr: T[], i: number, dir: number): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

export function ExportPresetBuilder({
  token,
  input,
  projects,
  presets,
}: {
  token: string;
  input: ExportInput;
  projects: ProjectLite[];
  presets: PresetLite[];
}) {
  const [selectedId, setSelectedId] = useState("new");
  const [name, setName] = useState("");
  const [groups, setGroups] = useState<UiGroup[]>([]);
  const [columns, setColumns] = useState<TicketColumnKey[]>(DEFAULT_COLUMNS);
  const [headers, setHeaders] = useState<Partial<Record<TicketColumnKey, string>>>({});
  const [tickets, setTickets] = useState(true);
  const [overview, setOverview] = useState(true);
  const [eurRate, setEurRate] = useState("24.2");

  function loadPreset(id: string) {
    setSelectedId(id);
    if (id === "new") {
      setName("");
      setGroups([]);
      setColumns(DEFAULT_COLUMNS);
      setHeaders({});
      setTickets(true);
      setOverview(true);
      setEurRate("24.2");
      return;
    }
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setName(p.name);
    setGroups(p.config.columnGroups.map((g) => ({ label: g.label, projectIds: g.projectIds })));
    setColumns(p.config.ticketColumns);
    setHeaders(p.config.columnHeaders ?? {});
    setTickets(p.config.sheets.tickets);
    setOverview(p.config.sheets.overview);
    setEurRate(p.config.eurRate == null ? "" : String(p.config.eurRate));
  }

  // project id -> index of the group already using it (disable it elsewhere)
  const projectOwner = new Map<string, number>();
  groups.forEach((g, i) => g.projectIds.forEach((pid) => projectOwner.set(pid, i)));

  function toggleProject(groupIdx: number, pid: string) {
    setGroups((prev) =>
      prev.map((g, i) => {
        if (i !== groupIdx) return g;
        const has = g.projectIds.includes(pid);
        return {
          ...g,
          projectIds: has ? g.projectIds.filter((p) => p !== pid) : [...g.projectIds, pid],
        };
      }),
    );
  }

  const config: ExportPresetConfig = useMemo(() => {
    const cleanHeaders: Partial<Record<TicketColumnKey, string>> = {};
    for (const k of columns) {
      const h = headers[k]?.trim();
      if (h) cleanHeaders[k] = h;
    }
    return {
      columnGroups: groups
        .filter((g) => g.label.trim() !== "")
        .map((g) => ({ key: g.label.trim(), label: g.label.trim(), projectIds: g.projectIds })),
      ticketColumns: columns,
      ...(Object.keys(cleanHeaders).length ? { columnHeaders: cleanHeaders } : {}),
      sheets: { tickets, overview },
      eurRate: eurRate.trim() === "" ? null : Number(eurRate),
    };
  }, [groups, columns, headers, tickets, overview, eurRate]);

  // Live preview against THIS report — computeExportModel is pure, runs here.
  const preview = useMemo(() => {
    try {
      return computeExportModel(input, config);
    } catch {
      return null;
    }
  }, [input, config]);

  const trimmedLabels = groups.map((g) => g.label.trim()).filter((l) => l !== "");
  const hasDuplicateLabels = new Set(trimmedLabels).size !== trimmedLabels.length;

  const canSave =
    name.trim() !== "" &&
    config.columnGroups.length > 0 &&
    columns.length > 0 &&
    (tickets || overview) &&
    (eurRate.trim() === "" || (Number.isFinite(Number(eurRate)) && Number(eurRate) > 0)) &&
    !hasDuplicateLabels;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <label className="text-sm text-neutral-600">Preset</label>
        <select
          value={selectedId}
          onChange={(e) => loadPreset(e.target.value)}
          className="border border-neutral-300 rounded px-2 py-1 text-sm"
        >
          <option value="new">➕ New preset…</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {selectedId !== "new" && (
          <form action={deletePreset} className="ml-auto">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="id" value={selectedId} />
            <button
              className="text-sm text-red-600 hover:underline"
              onClick={(e) => {
                if (!window.confirm("Delete this shared preset? This can't be undone.")) e.preventDefault();
              }}
            >
              Delete
            </button>
          </form>
        )}
      </div>

      <form
        action={selectedId === "new" ? createPreset : updatePreset}
        className="space-y-6"
      >
        <input type="hidden" name="token" value={token} />
        {selectedId !== "new" && <input type="hidden" name="id" value={selectedId} />}
        <input type="hidden" name="config" value={JSON.stringify(config)} />

        <div>
          <label className="block text-sm font-medium mb-1">Preset name</label>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-neutral-300 rounded px-2 py-1 text-sm"
            placeholder="SAP re-invoicing FR+GER"
          />
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Output columns (project groups)</h3>
            <button
              type="button"
              onClick={() => setGroups((g) => [...g, { label: "", projectIds: [] }])}
              className="text-sm text-neutral-700 border border-neutral-300 rounded px-2 py-0.5 hover:bg-neutral-50"
            >
              + Add group
            </button>
          </div>
          {groups.length === 0 && (
            <p className="text-sm text-neutral-500 italic">Add at least one group (e.g. “FR”).</p>
          )}
          {groups.map((g, i) => (
            <div key={i} className="border border-neutral-200 rounded p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={g.label}
                  onChange={(e) =>
                    setGroups((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  placeholder="Column label (e.g. FR)"
                  className="border border-neutral-300 rounded px-2 py-1 text-sm flex-1"
                />
                <button
                  type="button"
                  onClick={() => setGroups((prev) => prev.filter((_, j) => j !== i))}
                  className="text-sm text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {projects.map((p) => {
                  const owner = projectOwner.get(p.id);
                  const inThis = owner === i;
                  const usedElsewhere = owner != null && owner !== i;
                  return (
                    <label
                      key={p.id}
                      className={`text-xs border rounded px-2 py-1 cursor-pointer ${
                        inThis
                          ? "bg-neutral-900 text-white border-neutral-900"
                          : usedElsewhere
                            ? "opacity-40 cursor-not-allowed border-neutral-200"
                            : "border-neutral-300 hover:bg-neutral-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={inThis}
                        disabled={usedElsewhere}
                        onChange={() => toggleProject(i, p.id)}
                      />
                      {p.name}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-sm">Ticket columns (order matters)</h3>
          <div className="space-y-1">
            {columns.map((c, i) => (
              <div key={c} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0">{COLUMN_LABEL[c]}</span>
                <input
                  value={headers[c] ?? ""}
                  onChange={(e) => setHeaders((h) => ({ ...h, [c]: e.target.value }))}
                  placeholder={`Header (default “${COLUMN_LABEL[c]}”)`}
                  className="border border-neutral-300 rounded px-2 py-0.5 text-xs flex-1"
                />
                <button
                  type="button"
                  onClick={() => setColumns((cols) => move(cols, i, -1))}
                  disabled={i === 0}
                  className="disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => setColumns((cols) => move(cols, i, 1))}
                  disabled={i === columns.length - 1}
                  className="disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => setColumns((cols) => cols.filter((x) => x !== c))}
                  className="text-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {ALL_COLUMNS.filter((c) => !columns.includes(c)).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColumns((cols) => [...cols, c])}
                className="text-xs border border-dashed border-neutral-300 rounded px-2 py-0.5 hover:bg-neutral-50"
              >
                + {COLUMN_LABEL[c]}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-wrap gap-4 items-center text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={tickets} onChange={(e) => setTickets(e.target.checked)} />{" "}
            Tickets sheet
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={overview}
              onChange={(e) => setOverview(e.target.checked)}
            />{" "}
            Overview sheet
          </label>
          <label className="flex items-center gap-1 ml-auto">
            EUR rate
            <input
              value={eurRate}
              onChange={(e) => setEurRate(e.target.value)}
              placeholder="blank = no EUR"
              className="border border-neutral-300 rounded px-2 py-0.5 w-28 text-sm"
            />
          </label>
        </section>

        {hasDuplicateLabels ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Group names must be unique — rename the duplicated column label(s) to see the preview
            and save.
          </p>
        ) : (
          preview && (
            <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-sm">
              <p className="font-medium mb-1">Preview for {input.report.label}</p>
              <ul className="space-y-0.5">
                {preview.overview.groups.map((g) => (
                  <li key={g.key} className="flex justify-between">
                    <span>{g.label}</span>
                    <span>
                      {g.hours.toFixed(2)} h
                      {g.czk != null ? ` · ${g.czk.toLocaleString("cs-CZ")} Kč` : ""}
                    </span>
                  </li>
                ))}
                <li className="flex justify-between font-semibold border-t border-neutral-200 pt-0.5">
                  <span>Total</span>
                  <span>{preview.overview.totalHours.toFixed(2)} h</span>
                </li>
              </ul>
              {preview.excludedHours > 0 && (
                <p className="mt-2 text-amber-700">
                  ⚠ {preview.excludedHours.toFixed(2)} h of approved work fall outside these
                  groups and won&apos;t be exported.
                </p>
              )}
            </div>
          )
        )}

        <button
          type="submit"
          disabled={!canSave}
          className="bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800 disabled:bg-neutral-300"
        >
          {selectedId === "new" ? "Create preset" : "Save changes"}
        </button>
      </form>
    </div>
  );
}

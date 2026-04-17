"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Approval, Project, ReportItem } from "@prisma/client";

import { minutesToHours, secondsToHours, diffHours } from "@/lib/format";
import { saveItem } from "./actions";

type ItemWithAssignments = ReportItem & {
  assignments: { projectId: string }[];
};

type Props = {
  item: ItemWithAssignments;
  token: string;
  projects: Project[];
  locked: boolean;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 600;
const SAVED_INDICATOR_MS = 1500;

export function ItemCard({ item, token, projects, locked }: Props) {
  const [assigned, setAssigned] = useState<string[]>(() =>
    [...item.assignments.map((a) => a.projectId)].sort(),
  );
  const [comment, setComment] = useState(item.reviewerComment ?? "");
  const [approval, setApproval] = useState<Approval>(item.approval);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [, startTransition] = useTransition();

  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latest = useRef({ assigned, comment, approval });
  latest.current = { assigned, comment, approval };

  function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current || locked) return;
    dirty.current = false;

    const snap = latest.current;
    const fd = new FormData();
    fd.set("token", token);
    fd.set("itemId", String(item.id));
    for (const pid of snap.assigned) fd.append("projects", pid);
    fd.set("comment", snap.comment);
    fd.set("approval", snap.approval);

    setSaveState("saving");
    startTransition(async () => {
      try {
        await saveItem(fd);
        setSaveState("saved");
        if (savedResetTimer.current) clearTimeout(savedResetTimer.current);
        savedResetTimer.current = setTimeout(() => {
          setSaveState((s) => (s === "saved" ? "idle" : s));
        }, SAVED_INDICATOR_MS);
      } catch {
        setSaveState("error");
      }
    });
  }

  function schedule() {
    if (locked) return;
    dirty.current = true;
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (savedResetTimer.current) clearTimeout(savedResetTimer.current);
    };
  }, []);

  function toggleProject(id: string, on: boolean) {
    setAssigned((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return [...next].sort();
    });
    schedule();
  }

  const radioName = `approval-${item.id}`;

  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {item.jiraKey ? (
              <code className="text-xs bg-neutral-100 rounded px-1.5 py-0.5">
                {item.jiraKey}
              </code>
            ) : (
              <span className="text-xs uppercase text-neutral-500">PM</span>
            )}
            {item.jiraIssuetype && <IssueTypeBadge type={item.jiraIssuetype} />}
            {item.jiraStatus && (
              <span className="text-xs text-neutral-500">{item.jiraStatus}</span>
            )}
          </div>
          <div className="mt-1 font-medium">{item.summary}</div>
          {item.parentSummary && (
            <div className="text-xs text-neutral-500">
              parent: {item.parentKey} {item.parentSummary}
            </div>
          )}
          {(item.jiraLabels as string[]).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {(item.jiraLabels as string[]).map((l) => (
                <span
                  key={l}
                  className="text-[10px] bg-neutral-100 text-neutral-600 rounded px-1.5 py-0.5"
                >
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="text-right text-sm shrink-0">
          <div className="font-semibold">{minutesToHours(item.workedMinutes)} h worked</div>
          <div className="text-xs text-neutral-500">
            est {secondsToHours(item.estimatedSeconds)} · Δ{" "}
            {diffHours(item.estimatedSeconds, item.workedMinutes)}
          </div>
        </div>
      </div>

      {item.pmNotes && (
        <details className="text-xs text-neutral-600">
          <summary className="cursor-pointer">PM notes</summary>
          <pre className="whitespace-pre-wrap mt-1 bg-neutral-50 border border-neutral-200 rounded p-2">
            {item.pmNotes}
          </pre>
        </details>
      )}

      <div className="grid md:grid-cols-2 gap-4 pt-2 border-t border-neutral-100">
        <div>
          <div className="text-xs font-medium text-neutral-600 mb-1">Projects</div>
          <div className="space-y-1">
            {projects.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={assigned.includes(p.id)}
                  onChange={(e) => toggleProject(p.id, e.target.checked)}
                  disabled={locked}
                />
                {p.name}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-neutral-600 mb-1">Comment</div>
          <textarea
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              schedule();
            }}
            onBlur={flush}
            rows={4}
            disabled={locked}
            className="w-full text-sm border border-neutral-300 rounded px-2 py-1 disabled:bg-neutral-50"
            placeholder="Optional feedback for PORTA…"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
        <div className="flex gap-4 text-sm">
          {(["approved", "rejected", "pending"] as const).map((v) => (
            <label key={v} className="flex items-center gap-1">
              <input
                type="radio"
                name={radioName}
                checked={approval === v}
                onChange={() => {
                  setApproval(v);
                  schedule();
                }}
                disabled={locked}
              />
              <span className="capitalize">{v}</span>
            </label>
          ))}
        </div>
        <SaveIndicator state={saveState} locked={locked} />
      </div>
    </div>
  );
}

function SaveIndicator({ state, locked }: { state: SaveState; locked: boolean }) {
  if (locked) return <span className="text-xs text-neutral-400">Locked</span>;
  if (state === "saving") return <span className="text-xs text-neutral-500">Saving…</span>;
  if (state === "saved") return <span className="text-xs text-green-700">Saved</span>;
  if (state === "error")
    return <span className="text-xs text-red-600">Error saving — try again</span>;
  return <span className="text-xs text-neutral-400">Auto-saved</span>;
}

function IssueTypeBadge({ type }: { type: string }) {
  const lower = type.toLowerCase();
  const styles = lower.includes("bug")
    ? "bg-red-50 text-red-700"
    : lower.includes("sub")
      ? "bg-neutral-100 text-neutral-600"
      : lower.includes("scope")
        ? "bg-purple-50 text-purple-700"
        : "bg-blue-50 text-blue-700";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${styles}`}>
      {type}
    </span>
  );
}

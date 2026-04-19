"use client";

import { useRef } from "react";
import type { ReactNode } from "react";

type Props = {
  label?: string;
  title: string;
  children: ReactNode;
};

export function HelpButton({ label = "Help", title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
      >
        {label}
      </button>
      <dialog
        ref={ref}
        className="w-[min(40rem,95vw)] rounded-lg border border-neutral-200 bg-white p-0 shadow-xl backdrop:bg-neutral-900/50"
        onClick={(e) => {
          if (e.target === ref.current) ref.current.close();
        }}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => ref.current?.close()}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 text-sm text-neutral-800 space-y-4">
          {children}
        </div>
      </dialog>
    </>
  );
}

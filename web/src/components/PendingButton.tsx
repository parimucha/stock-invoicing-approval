"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";

type Props = Omit<ComponentProps<"button">, "children"> & {
  children: ReactNode;
  pendingLabel?: ReactNode;
};

export function PendingButton({
  children,
  pendingLabel,
  disabled,
  className = "",
  ...rest
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`${className} disabled:opacity-60 disabled:cursor-wait`}
      {...rest}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

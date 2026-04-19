"use client";

import type { ComponentProps, ReactNode } from "react";

type Props = Omit<ComponentProps<"form">, "onSubmit"> & {
  confirmMessage: string;
  children: ReactNode;
};

export function ConfirmForm({ confirmMessage, children, ...rest }: Props) {
  return (
    <form
      {...rest}
      onSubmit={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </form>
  );
}

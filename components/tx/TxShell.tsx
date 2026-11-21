"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { explorerToastAction } from "@/lib/explorer";
import { describeTxError, type TxErrorContext } from "@/lib/txErrors";
import { isValidDecimalInput } from "@/lib/format";
import { ExplorerLink } from "@/components/common/ExplorerLink";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * The shared modal shell of the 13 transaction modals (ui-usability-v1 §3.2): the error and
 * success toasts, the Dialog with its form or success view, and the amount input with MAX.
 */

/** Toast each new error once, in words that fit the action (describeTxError, never raw codes). */
export function useTxErrorToast(error: unknown, title: string, ctx: TxErrorContext) {
  const prev = useRef<unknown>(null);
  const { venue, action, guardStatus } = ctx;
  useEffect(() => {
    if (!error || error === prev.current) return;
    prev.current = error;
    toast.error(title, { description: describeTxError(error, { venue, action, guardStatus }) });
  }, [error, title, venue, action, guardStatus]);
}

/** Toast once when the transaction's receipt confirms. */
export function useTxSuccessToast(isSuccess: boolean, hash: string | undefined, title: string, description = "Transaction confirmed") {
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!isSuccess || !hash || shown.current === hash) return;
    shown.current = hash;
    toast.success(title, { description, action: explorerToastAction(hash) });
  }, [isSuccess, hash, title, description]);
}

/** The Dialog every transaction modal opens in. */
export function TxDialog({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">{children}</DialogContent>
    </Dialog>
  );
}

/** The form view: title, then the modal's content. */
export function TxForm({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">{children}</div>
    </>
  );
}

/**
 * The success view: what happened, the after-state (read at or after the receipt block), the
 * modal's allowance note, and the explorer link.
 */
export function TxSuccess({
  title,
  message,
  hash,
  onClose,
  children,
}: {
  title: ReactNode;
  message?: ReactNode;
  hash: string | undefined;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="py-2 space-y-3" data-testid="tx-success">
      <div className="text-center space-y-2">
        <div className="text-4xl text-accent" aria-hidden>
          &#10003;
        </div>
        <DialogHeader className="items-center">
          <DialogTitle className="text-xl">{title}</DialogTitle>
        </DialogHeader>
        {message && <p className="text-muted-foreground">{message}</p>}
      </div>
      {children}
      <div className="flex flex-col items-center gap-1">
        {hash && <ExplorerLink hash={hash} />}
        <Button variant="link" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

/**
 * Amount input with an optional MAX button. Accepts only a decimal with at most `decimals`
 * fraction digits; `onChange` receives the raw text.
 */
export function AmountField({
  label,
  aside,
  value,
  decimals,
  onChange,
  onMax,
  maxDisabled,
  placeholder = "0.00",
  ariaLabel = "Amount",
  children,
}: {
  label: ReactNode;
  aside?: ReactNode;
  value: string;
  decimals: number;
  onChange: (value: string) => void;
  onMax?: () => void;
  maxDisabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-2 gap-2">
        <label className="text-sm text-muted-foreground">{label}</label>
        {aside !== undefined && <span className="text-sm text-muted-foreground text-right">{aside}</span>}
      </div>
      <div className="relative">
        <Input
          aria-label={ariaLabel}
          type="number"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || (isValidDecimalInput(v, decimals) && Number(v) >= 0)) onChange(v);
          }}
          placeholder={placeholder}
          min="0"
          step="any"
          className={`h-12 text-lg bg-transparent border-border font-mono ${onMax ? "pr-16" : ""}`}
        />
        {onMax && (
          <button
            type="button"
            disabled={maxDisabled}
            onClick={onMax}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors disabled:opacity-40"
          >
            MAX
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** A small amber note (re-check aborts, blocked actions). */
export function TxNotice({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="text-xs text-amber-400 mt-1" data-testid={testId}>
      {children}
    </p>
  );
}

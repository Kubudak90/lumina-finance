"use client";

import { Button } from "@/components/ui/button";

interface TxButtonProps {
  onClick: () => void;
  isPending: boolean;
  isConfirming?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

export function TxButton({ onClick, isPending, isConfirming, disabled, children }: TxButtonProps) {
  const isLoading = isPending || isConfirming;

  return (
    <Button
      variant="default"
      size="lg"
      className="w-full py-4 text-base bg-accent text-background font-bold uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(176,196,255,0.2)] hover:bg-white"
      onClick={onClick}
      disabled={disabled || isLoading}
    >
      {isPending ? "Confirm in wallet..." : isConfirming ? "Confirming..." : children}
    </Button>
  );
}

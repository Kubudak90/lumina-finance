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
      className="w-full h-12 text-base font-semibold"
      onClick={onClick}
      disabled={disabled || isLoading}
    >
      {isPending ? "Confirm in wallet..." : isConfirming ? "Confirming..." : children}
    </Button>
  );
}

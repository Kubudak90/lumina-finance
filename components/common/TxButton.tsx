"use client";

import { Button } from "@/components/ui/button";
import { useActionGate } from "@/hooks/chain";

interface TxButtonProps {
  onClick: () => void;
  isPending: boolean;
  isConfirming?: boolean;
  isSimulating?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Every transaction button. Disabled (with the reason as its label) unless the wallet is connected
 * to the Lumina chain, the RPC is configured and the manifest is deployed (FE-03).
 */
export function TxButton({
  onClick,
  isPending,
  isConfirming,
  isSimulating,
  disabled,
  children,
}: TxButtonProps) {
  const gate = useActionGate();
  const isLoading = isPending || isConfirming || !!isSimulating;

  return (
    <Button
      variant="default"
      size="lg"
      className="w-full py-4 text-base bg-accent text-background font-bold uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(176,196,255,0.2)] hover:bg-white"
      onClick={onClick}
      disabled={!gate.ready || disabled || isLoading}
    >
      {!gate.ready
        ? gate.reason
        : isSimulating
          ? "Simulating..."
          : isPending
            ? "Confirm in wallet..."
            : isConfirming
              ? "Confirming..."
              : children}
    </Button>
  );
}

"use client";

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
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="w-full py-3 px-4 rounded-lg font-semibold text-white bg-brand-accent hover:bg-brand-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {isPending ? "Confirm in wallet..." : isConfirming ? "Confirming..." : children}
    </button>
  );
}

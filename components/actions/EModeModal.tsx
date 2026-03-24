"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useEMode } from "@/hooks/useEMode";
import { TxButton } from "@/components/common/TxButton";
import { parseErrorMessage } from "@/lib/errorMessages";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface EModeModalProps {
  onClose: () => void;
}

interface EModeCategory {
  id: number;
  name: string;
  description: string;
  ltv: string;
  liquidationThreshold: string;
}

const E_MODE_CATEGORIES: EModeCategory[] = [
  {
    id: 0,
    name: "None",
    description: "Default mode with standard LTV and liquidation parameters",
    ltv: "—",
    liquidationThreshold: "—",
  },
  {
    id: 1,
    name: "Stablecoins",
    description: "Higher LTV for stablecoin pairs (e.g. USDC/USDT)",
    ltv: "97%",
    liquidationThreshold: "97.5%",
  },
];

export function EModeModal({ onClose }: EModeModalProps) {
  const {
    currentCategoryId,
    setEMode,
    isPending,
    isConfirming,
    isSuccess,
    error,
  } = useEMode();

  const [selectedCategory, setSelectedCategory] = useState<number>(currentCategoryId);

  useEffect(() => {
    if (error) {
      toast.error("E-Mode change failed", {
        description: parseErrorMessage(error),
      });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess) {
      toast.success("E-Mode updated", {
        description: `Switched to ${E_MODE_CATEGORIES.find((c) => c.id === selectedCategory)?.name ?? "None"}`,
      });
    }
  }, [isSuccess, selectedCategory]);

  const handleSetEMode = () => {
    setEMode(selectedCategory);
  };

  const hasChanged = selectedCategory !== currentCategoryId;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">E-Mode Updated</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">
              Switched to{" "}
              <span className="text-foreground font-medium">
                {E_MODE_CATEGORIES.find((c) => c.id === selectedCategory)?.name ?? "None"}
              </span>
            </p>
            <button
              onClick={onClose}
              className="text-sm text-accent hover:text-accent/80 underline underline-offset-2 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Efficiency Mode (E-Mode)</DialogTitle>
              <DialogDescription>
                E-Mode allows you to get higher borrowing power when supplying and
                borrowing assets of the same category.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              {E_MODE_CATEGORIES.map((category) => {
                const isActive = category.id === currentCategoryId;
                const isSelected = category.id === selectedCategory;

                return (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategory(category.id)}
                    className={`
                      w-full text-left rounded-lg border p-3.5 transition-all
                      ${isSelected
                        ? "border-accent/50 bg-accent/10 ring-1 ring-accent/30"
                        : "border-border hover:border-border/80 hover:bg-white/5"
                      }
                    `}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground text-sm">
                          {category.name}
                        </span>
                        {isActive && (
                          <span className="text-[10px] font-mono font-medium uppercase tracking-wider text-accent bg-accent/10 px-1.5 py-0.5">
                            Active
                          </span>
                        )}
                      </div>
                      <div
                        className={`
                          w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors
                          ${isSelected ? "border-accent bg-accent" : "border-muted-foreground/40"}
                        `}
                      >
                        {isSelected && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      {category.description}
                    </p>
                    {category.id > 0 && (
                      <div className="flex gap-4">
                        <div className="text-xs">
                          <span className="text-muted-foreground">LTV: </span>
                          <span className="font-mono text-foreground font-medium">
                            {category.ltv}
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="text-muted-foreground">Liq. Threshold: </span>
                          <span className="font-mono text-foreground font-medium">
                            {category.liquidationThreshold}
                          </span>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <TxButton
              onClick={handleSetEMode}
              isPending={isPending}
              isConfirming={isConfirming}
              disabled={!hasChanged}
            >
              {!hasChanged
                ? "Select a different mode"
                : selectedCategory === 0
                  ? "Disable E-Mode"
                  : `Enable ${E_MODE_CATEGORIES.find((c) => c.id === selectedCategory)?.name} E-Mode`}
            </TxButton>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-xl font-bold text-red-400">Something went wrong</h2>
      <pre className="text-xs text-muted-foreground max-w-lg overflow-auto p-4 bg-card border border-border">
        {error.message}
        {"\n"}
        {error.stack}
      </pre>
      <button
        onClick={reset}
        className="px-4 py-2 bg-accent text-background text-xs uppercase tracking-wider"
      >
        Try again
      </button>
    </div>
  );
}

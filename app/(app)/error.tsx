"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isForbidden = error.message.includes("Forbidden");

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-xl font-semibold">
        {isForbidden ? "You don't have permission to view this page" : "Something went wrong"}
      </h1>
      <p className="text-muted-foreground max-w-sm">
        {isForbidden
          ? "This page requires administrator access."
          : "An unexpected error occurred. Please try again."}
      </p>
      {!isForbidden && <Button onClick={reset}>Try again</Button>}
    </div>
  );
}

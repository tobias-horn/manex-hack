"use client";

import Link from "next/link";
import { useEffect } from "react";

import { ScreenState } from "@/components/screen-state";
import { Button } from "@/components/ui/button";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("App route failed:", error);
  }, [error]);

  return (
    <ScreenState
      eyebrow="Load error"
      title="The product hit a temporary read problem"
      description="The dataset connection or one of the composed read models failed unexpectedly. The app is still intact, and you can retry the route without losing any persisted workflow data."
      tone="error"
      actions={
        <>
          <Button size="lg" onClick={reset}>
            Retry
          </Button>
          <Button
            size="lg"
            variant="outline"
            render={<Link href="/">Back to inbox</Link>}
          />
        </>
      }
    />
  );
}

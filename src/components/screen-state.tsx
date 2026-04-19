import { AlertTriangle, LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ScreenStateProps = {
  eyebrow: string;
  title: string;
  description: string;
  tone?: "default" | "error";
  actions?: ReactNode;
};

export function ScreenState({
  eyebrow,
  title,
  description,
  tone = "default",
  actions,
}: ScreenStateProps) {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-[920px] items-center px-4 py-8 sm:px-6 lg:px-10">
        <section className="glass-panel ghost-border w-full rounded-[30px] px-6 py-8 sm:px-8">
          <div
            className={
              tone === "error"
                ? "flex size-12 items-center justify-center rounded-full bg-[color:rgba(178,69,63,0.12)] text-[var(--destructive)]"
                : "flex size-12 items-center justify-center rounded-full bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]"
            }
          >
            {tone === "error" ? (
              <AlertTriangle className="size-5" />
            ) : (
              <LoaderCircle className="size-5 animate-spin" />
            )}
          </div>
          <Badge variant={tone === "error" ? "destructive" : "outline"} className="mt-5">
            {eyebrow}
          </Badge>
          <h1 className="mt-4 font-heading text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
            {description}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {actions ?? (
              <Button variant="outline" size="lg" render={<Link href="/">Back to home</Link>} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

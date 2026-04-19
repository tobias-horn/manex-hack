"use client";

import { ChevronDown, Cpu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ClusteringMode } from "@/lib/manex-clustering-mode";
import { cn } from "@/lib/utils";

type ToggleItem = {
  mode: ClusteringMode;
  label: string;
  description: string;
  href: string;
};

export function ClusteringPipelineToggle({
  currentMode,
  items,
}: {
  currentMode: ClusteringMode;
  items: ToggleItem[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const activeItem = items.find((item) => item.mode === currentMode) ?? items[0];

  return (
    <section className="surface-sheet ghost-border rounded-[28px] px-4 py-4 sm:px-5">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full flex-col gap-4 text-left sm:flex-row sm:items-center sm:justify-between"
        aria-expanded={isOpen}
      >
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <Cpu className="size-3.5" />
              Investigation engine
            </Badge>
            <Badge>{activeItem.label}</Badge>
          </div>
          <div>
            <div className="text-base font-semibold">Switch engine without leaving the workspace</div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
              {activeItem.description}
            </p>
          </div>
        </div>

        <span
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
            "shrink-0",
          )}
        >
          Change engine
          <ChevronDown
            className={cn("size-4 transition-transform", isOpen ? "rotate-180" : "rotate-0")}
          />
        </span>
      </button>

      {isOpen ? (
        <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {items.map((item) => {
            const isActive = item.mode === currentMode;

            return (
              <Link
                key={item.mode}
                href={item.href}
                className={
                  isActive
                    ? "rounded-[24px] border border-[color:rgba(0,92,151,0.28)] bg-[linear-gradient(180deg,rgba(0,92,151,0.08),rgba(255,255,255,0.72))] p-4 dark:bg-[linear-gradient(180deg,rgba(91,147,188,0.16),rgba(23,34,43,0.9))]"
                    : "rounded-[24px] border border-white/10 bg-[color:var(--surface-low)] p-4 transition hover:border-white/20 hover:bg-[color:var(--surface-high)]"
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-base font-semibold">{item.label}</div>
                  <Badge variant={isActive ? "default" : "outline"}>
                    {isActive ? "Active" : "Switch"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                  {item.description}
                </p>
              </Link>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

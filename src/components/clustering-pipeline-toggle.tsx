import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ClusteringMode } from "@/lib/manex-clustering-mode";

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
  return (
    <div className="rounded-[28px] border border-white/10 bg-[color:var(--surface-low)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Investigation engine</Badge>
        <div className="text-sm leading-6 text-[var(--muted-foreground)]">
          Switch the app surface between the three investigation engines without
          leaving the current workspace.
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {items.map((item) => {
          const isActive = item.mode === currentMode;

          return (
            <Link
              key={item.mode}
              href={item.href}
              className={
                isActive
                  ? "rounded-[24px] border border-[color:rgba(0,92,151,0.28)] bg-[color:rgba(0,92,151,0.08)] p-4"
                  : "rounded-[24px] border border-white/10 bg-black/8 p-4 transition hover:border-white/20"
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
    </div>
  );
}

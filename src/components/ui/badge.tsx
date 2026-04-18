import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-[0.72rem] font-medium uppercase tracking-[0.14em] whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-[color:rgba(0,92,151,0.1)] text-[var(--primary)] [a]:hover:bg-[color:rgba(0,92,151,0.14)]",
        secondary:
          "bg-[color:var(--surface-low)] text-[var(--muted-foreground)]",
        destructive:
          "bg-[color:rgba(178,69,63,0.1)] text-[var(--destructive)] focus-visible:ring-[color:rgba(178,69,63,0.22)]",
        outline:
          "ghost-border text-foreground [a]:hover:bg-[color:var(--surface-low)]",
        ghost:
          "text-[var(--muted-foreground)] hover:bg-[color:var(--surface-low)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[1rem] border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "primary-gradient text-primary-foreground shadow-[var(--ambient-shadow)] hover:brightness-[1.04]",
        outline:
          "bg-transparent text-primary ghost-border hover:bg-[color:rgba(0,92,151,0.06)]",
        secondary:
          "bg-[color:var(--surface-lowest)] text-foreground hover:bg-[color:var(--surface-low)]",
        ghost:
          "text-[0.72rem] uppercase tracking-[0.18em] text-[var(--muted-foreground)] hover:text-foreground",
        destructive:
          "bg-[color:rgba(178,69,63,0.12)] text-[var(--destructive)] hover:bg-[color:rgba(178,69,63,0.18)] focus-visible:ring-[color:rgba(178,69,63,0.22)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 rounded-[0.9rem] px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-[0.95rem] px-3 text-[0.82rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5 text-sm has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-8",
        "icon-xs":
          "size-7 rounded-[0.9rem] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-[0.95rem]",
        "icon-lg": "size-10 rounded-[1rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

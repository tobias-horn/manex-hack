import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-28 w-full rounded-[1rem] border border-transparent bg-[color:var(--surface-high)] px-3.5 py-3 text-base text-foreground transition-[background-color,box-shadow] outline-none placeholder:text-[var(--muted-foreground)] focus-visible:bg-[color:var(--surface-lowest)] focus-visible:shadow-[inset_0_-1px_0_var(--primary)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

import { Loader as Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      // @ts-expect-error React type mismatch between lucide-react and @types/react
      {...props}
    />
  )
}

export { Spinner }

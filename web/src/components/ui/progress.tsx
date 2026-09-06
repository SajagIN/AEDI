import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

/* A filling bar in a recessed channel. Brass by default; callers pass
   barClassName when the bar is standing in for a verdict colour. */
export interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  barClassName?: string;
}

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, barClassName, value, ...props }, ref) => (
    <ProgressPrimitive.Root ref={ref}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-md bg-secondary shadow-inset", className)} {...props}>
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full w-full flex-1 bg-gradient-to-r from-cobalt-deep to-cobalt transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)]",
          barClassName)}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }} />
    </ProgressPrimitive.Root>
  )
);
Progress.displayName = ProgressPrimitive.Root.displayName;
export { Progress };

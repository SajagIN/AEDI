import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} ref={ref}
      className={cn(
        "flex h-10 w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,.03)] transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-ios-blue disabled:opacity-50",
        className
      )} {...props} />
  )
);
Input.displayName = "Input";
export { Input };

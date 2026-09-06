import * as React from "react";
import { cn } from "@/lib/utils";

/* Form fields are recessed, like boxes ruled into a paper form. */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} ref={ref}
      className={cn(
        "flex h-9 w-full rounded-[3px] border border-input bg-background/70 px-3 font-mono text-[13px] shadow-inset transition-colors",
        "placeholder:text-muted-foreground/60 focus-visible:border-brass/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className)}
      {...props} />
  )
);
Input.displayName = "Input";
export { Input };

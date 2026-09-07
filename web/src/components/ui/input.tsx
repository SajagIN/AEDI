import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} ref={ref}
      className={cn(
        "nm-inset flex h-9 w-full rounded-lg px-3 font-mono text-[13px] transition-colors",
        "placeholder:text-muted-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className)}
      {...props} />
  )
);
Input.displayName = "Input";
export { Input };

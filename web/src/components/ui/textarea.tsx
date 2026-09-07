import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref}
      className={cn(
        "nm-inset flex min-h-[80px] w-full rounded-lg p-3 font-mono text-[12.5px] leading-relaxed transition-colors",
        "placeholder:text-muted-foreground/60",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className)}
      {...props} />
  )
);
Textarea.displayName = "Textarea";
export { Textarea };

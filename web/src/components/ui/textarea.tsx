import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-[3px] border border-input bg-background/70 p-3 font-mono text-[12.5px] leading-relaxed shadow-inset transition-colors",
        "placeholder:text-muted-foreground/60 focus-visible:border-brass/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className)}
      {...props} />
  )
);
Textarea.displayName = "Textarea";
export { Textarea };

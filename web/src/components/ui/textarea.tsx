import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-xl border border-input bg-card px-3.5 py-3 font-mono text-[13px] leading-relaxed shadow-[inset_0_1px_2px_rgba(0,0,0,.03)] transition-colors placeholder:text-muted-foreground/70 placeholder:font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-ios-blue disabled:opacity-50",
        className
      )} {...props} />
  )
);
Textarea.displayName = "Textarea";
export { Textarea };

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* Badges are ledger stamps: square, monospace, letterspaced, tinted rather
   than filled. They label provenance and verdicts, so they must never look
   like buttons. */
const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-[2px] border px-1.5 py-[3px] font-mono text-[10px] uppercase leading-none tracking-[.1em]",
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-secondary-foreground",
        outline: "border-border/80 text-muted-foreground",
        brass: "border-brass/35 bg-brass/[.12] text-brass",
        info: "border-signal-info/30 bg-signal-info/[.10] text-signal-info",
        good: "border-signal-good/30 bg-signal-good/[.10] text-signal-good",
        warn: "border-signal-warn/35 bg-signal-warn/[.10] text-signal-warn",
        bad: "border-signal-bad/30 bg-signal-bad/[.10] text-signal-bad",
        alt: "border-signal-alt/30 bg-signal-alt/[.10] text-signal-alt",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { badgeVariants };

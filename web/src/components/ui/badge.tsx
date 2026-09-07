import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[10px] uppercase leading-none tracking-[.1em]",
  {
    variants: {
      variant: {
        default: "nm-raised-sm text-secondary-foreground",
        outline: "border border-border/90 text-muted-foreground",
        cobalt: "nm-raised-sm text-cobalt",
        info: "nm-raised-sm text-signal-info",
        good: "nm-raised-sm text-signal-good",
        warn: "nm-raised-sm text-signal-warn",
        bad: "nm-raised-sm text-signal-bad",
        alt: "nm-raised-sm text-signal-alt",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }:
  React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { badgeVariants };

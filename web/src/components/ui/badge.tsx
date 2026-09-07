import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*  Pills, extruded.
 *
 *  These used to be flat tinted rectangles — a wash of the signal colour at
 *  10% behind matching text. That reads fine on white and badly on a grey
 *  sheet, where a 10% tint is close enough to the substrate to look like a
 *  printing error rather than a deliberate field.
 *
 *  So the surface is now the sheet itself, pushed up 3px, and the semantics
 *  live entirely in the text colour. Every one of those colours was measured
 *  against this exact substrate and clears 5.4:1, which a 10% tint behind
 *  them never did.
 *
 *  Two things keep them from reading as buttons, which they must never do:
 *  they are round where buttons are 8px-cornered, and they are set in
 *  uppercase mono where buttons are set in Sora. They also have no hover and
 *  no press state, because nothing here is clickable.
 *
 *  `outline` is the one variant that stays flat. It marks a baseline row or a
 *  secondary fact, and something that recedes should not be extruded.
 */
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

/* A span, not a div: these sit inside paragraphs and table cells, and a
   block-level element there is invalid markup that browsers silently repair
   by closing the paragraph early. */
export function Badge({ className, variant, ...props }:
  React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { badgeVariants };

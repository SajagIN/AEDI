import * as React from "react";
import { cn } from "@/lib/utils";

/* A panel is a piece of card stock: hairline edge, faint top highlight where
   the lamp catches it, and a deep soft shadow. No rounded-pill softness —
   this is a document, so the corners are nearly square. */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref}
      className={cn(
        "relative rounded-[3px] border border-border/80 bg-card/85 text-card-foreground shadow-panel backdrop-blur-[2px]",
        className)}
      {...props} />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 px-5 pb-3.5 pt-4", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

/* Section heads are set in the serif at a size that reads as a heading in a
   printed report rather than a web card title. */
const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("font-display text-[19px] leading-[1.2] text-foreground", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-[12.5px] leading-relaxed text-muted-foreground", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("px-5 pb-5", className)} {...props} />
);
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardTitle, CardDescription, CardContent };

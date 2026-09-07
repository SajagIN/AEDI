import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* Cobalt is the only bright in the palette, so a filled cobalt button is
   unmistakably THE action on a screen. Everything else is a hairline. */
const buttonVariants = cva(
  "group relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-mono text-[11.5px] uppercase tracking-[.11em] nm-press transition-[background-color,border-color,color,box-shadow,transform] duration-200 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "bg-cobalt text-cobalt-ink shadow-[inset_0_1px_0_hsl(0_0%_100%/.25),-3px_-3px_8px_hsl(var(--nm-light)/.6),4px_5px_12px_hsl(210_70%_35%/.4)] hover:bg-cobalt-bright",
        secondary: "nm-raised-sm text-secondary-foreground hover:text-cobalt",
        outline: "border border-border bg-transparent text-muted-foreground hover:border-cobalt/50 hover:text-cobalt",
        ghost: "text-muted-foreground hover:text-foreground hover:nm-raised-sm",
        destructive: "bg-signal-bad text-white shadow-[inset_0_1px_0_hsl(0_0%_100%/.2),4px_5px_12px_hsl(4_60%_30%/.35)] hover:brightness-110",
      },
      size: { default: "h-9 px-4", sm: "h-7 px-3 text-[10.5px]", lg: "h-11 px-6 text-[12.5px]", icon: "h-8 w-8" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";
export { Button, buttonVariants };

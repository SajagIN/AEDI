import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* Cobalt is the only bright in the palette, so a filled cobalt button is
   unmistakably THE action on a screen. Everything else is a hairline. */
const buttonVariants = cva(
  "group relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-mono text-[11.5px] uppercase tracking-[.11em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-35 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "bg-cobalt text-cobalt-ink shadow-[0_1px_0_rgba(255,255,255,.22)_inset,0_1px_2px_rgba(16,24,40,.12),0_8px_20px_-10px_rgba(0,102,204,.7)] hover:bg-cobalt-bright",
        secondary: "border border-border bg-secondary text-secondary-foreground hover:border-cobalt/30 hover:text-foreground",
        outline: "border border-border bg-transparent text-muted-foreground hover:border-cobalt/40 hover:text-cobalt",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        destructive: "bg-signal-bad text-white hover:brightness-110",
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

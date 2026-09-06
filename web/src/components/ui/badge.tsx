import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        blue: "border-ios-blue/20 bg-ios-blue/10 text-ios-blue",
        green: "border-ios-green/25 bg-ios-green/10 text-[#248A3D]",
        orange: "border-ios-orange/25 bg-ios-orange/10 text-[#B25000]",
        red: "border-ios-red/20 bg-ios-red/10 text-ios-red",
        purple: "border-ios-purple/20 bg-ios-purple/10 text-ios-purple",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { badgeVariants };

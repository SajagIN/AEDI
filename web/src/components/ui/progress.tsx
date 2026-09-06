import * as React from "react";
import { cn } from "@/lib/utils";

export function Progress({ value = 0, className, barClassName }: { value?: number; className?: string; barClassName?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-black/[.07]", className)}>
      <div
        className={cn("h-full rounded-full bg-ios-blue transition-[width] duration-700 [transition-timing-function:cubic-bezier(.22,1,.36,1)]", barClassName)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

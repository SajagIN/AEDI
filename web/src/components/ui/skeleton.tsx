import { cn } from "@/lib/utils";

/* Numbers arrive from the API a beat after the page does. A pulsing bar in
   their place keeps the layout still, which is most of what "fast" feels
   like. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-[2px] bg-foreground/[.07]", className)} {...props} />;
}

import { cn } from "@/lib/utils";

interface GridVignetteBackgroundProps {
  size?: number;
  x?: number;
  y?: number;
  horizontalVignetteSize?: number;
  verticalVignetteSize?: number;
  intensity?: number;
  lineOpacity?: number;
}

export function GridVignetteBackground({
  className,
  size = 56,
  x = 50,
  y = 0,
  horizontalVignetteSize = 130,
  verticalVignetteSize = 95,
  intensity = 35,
  lineOpacity = 0.05,
  style,
  ...props
}: React.ComponentProps<"div"> & GridVignetteBackgroundProps) {
  const line = `hsl(var(--foreground) / ${lineOpacity})`;
  const mask =
    `radial-gradient(ellipse ${horizontalVignetteSize}% ${verticalVignetteSize}% ` +
    `at ${x}% ${y}%, black ${100 - intensity}%, transparent 100%)`;

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none fixed inset-0 -z-10", className)}
      style={{
        backgroundImage:
          `linear-gradient(to right, ${line}, transparent 1px),` +
          `linear-gradient(to bottom, ${line}, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
        maskImage: mask,
        WebkitMaskImage: mask,
        ...style,
      }}
      {...props}
    />
  );
}

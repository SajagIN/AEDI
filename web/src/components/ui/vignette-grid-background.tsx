import { cn } from "@/lib/utils";

/*  Grid vignette background
 *
 *  A ruled plane that fades out toward the edges, so the page has structure
 *  where you are reading and nothing where you are not.
 *
 *  Two changes from the reference implementation, both necessary here:
 *
 *  1. Colour. shadcn stores its palette as bare HSL triplets — `--foreground`
 *     is the string `220 9% 12%`, not a colour. Dropping `var(--foreground)`
 *     straight into a gradient yields `linear-gradient(to right, 220 9% 12%,
 *     …)`, which is not a valid colour stop, so the browser discards the whole
 *     declaration and the grid renders as nothing at all. It has to be wrapped
 *     in `hsl()`, which also lets the alpha be set per-instance.
 *
 *  2. Weight. The reference draws in `--muted-foreground` at 50% opacity. On a
 *     near-black page that is a hint; on this white one it is a sheet of graph
 *     paper loud enough to compete with the numbers. The default here is the
 *     foreground at 5%, which you read as texture rather than as lines.
 *
 *  `-z-10` keeps it behind the app: #root establishes a stacking context, so a
 *  negative index cannot escape past the page content. `pointer-events-none`
 *  stops the fixed layer from swallowing clicks in empty regions, and the
 *  -webkit- mask prefix is what makes the vignette work in Safari.
 */
interface GridVignetteBackgroundProps {
  /** Cell size in px. */
  size?: number;
  /** Vignette centre, as a percentage of the viewport. */
  x?: number;
  y?: number;
  /** Ellipse radii, as a percentage of the viewport. */
  horizontalVignetteSize?: number;
  verticalVignetteSize?: number;
  /** 0 = hard edge, 100 = fully feathered. */
  intensity?: number;
  /** Alpha of the rules, 0–1. */
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

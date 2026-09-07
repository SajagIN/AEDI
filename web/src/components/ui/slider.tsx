import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

/*  The one component worth taking from neumorphism-react.
 *
 *  A recessed track with a raised thumb is the idiom soft UI exists for — the
 *  control looks like a physical fader milled into the sheet. That library's
 *  version renders it out of plain divs with no role, no tabIndex and no key
 *  handler, so it is operable by mouse and by nothing else. This one is the
 *  same picture on Radix, which brings arrow keys, Home/End, Page Up/Down,
 *  the slider role and aria-valuenow for free.
 *
 *  The thumb keeps a hairline and a hard focus ring, same as every other
 *  control here: a raised circle on a same-coloured sheet is exactly the
 *  thing that vanishes in forced-colours mode.
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center py-2", className)}
    {...props}
  >
    <SliderPrimitive.Track className="nm-inset relative h-2.5 w-full grow rounded-full">
      <SliderPrimitive.Range className="absolute h-full rounded-full bg-cobalt/70" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className={cn(
        "nm-raised-sm block h-5 w-5 rounded-full",
        "transition-[box-shadow,transform] duration-150",
        "hover:scale-[1.06] active:scale-95",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;
export { Slider };

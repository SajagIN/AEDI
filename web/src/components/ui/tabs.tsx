import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/*  A segmented control, not a row of index tabs.
 *
 *  The underline these used to carry was a second, quieter way of saying the
 *  thing the filter group on Case Explorer already said by pressing a pill
 *  into the sheet. One interface, one idiom: the strip is a recess, the
 *  active tab is the one chip raised out of it.
 *
 *  The chip is a single element that moves. Rendering one raised box per tab
 *  and toggling which is visible would cross-fade, and a cross-fade reads as
 *  two chips rather than one travelling — the whole point of the affordance
 *  is that there is exactly one, and it goes where you sent it.
 *
 *  Radix Tabs is uncontrolled by default, so nothing downstream can know
 *  which trigger is active. Rather than push that problem into every caller,
 *  the root mirrors the value internally and publishes it on a context. The
 *  public API is unchanged: pass defaultValue, or pass value and
 *  onValueChange, and both still behave exactly as before.
 */
const ActiveTab = React.createContext<string | undefined>(undefined);

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ value, defaultValue, onValueChange, ...props }, ref) => {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const current = value ?? uncontrolled;
  const handleChange = React.useCallback(
    (next: string) => { setUncontrolled(next); onValueChange?.(next); },
    [onValueChange],
  );
  return (
    <ActiveTab.Provider value={current}>
      <TabsPrimitive.Root ref={ref} value={current} onValueChange={handleChange} {...props} />
    </ActiveTab.Provider>
  );
});
Tabs.displayName = TabsPrimitive.Root.displayName;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("nm-inset inline-flex items-center gap-1 rounded-full p-1.5", className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, value, ...props }, ref) => {
  const isActive = React.useContext(ActiveTab) === value;
  const reduced = useReducedMotion();
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(
        "relative shrink-0 whitespace-nowrap rounded-full px-4 py-2",
        "font-mono text-[11px] uppercase tracking-[.13em] transition-colors duration-200",
        isActive ? "text-cobalt" : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      {isActive && (
        <motion.span
          layoutId="tab-chip"
          aria-hidden
          className="nm-raised-sm absolute inset-0 rounded-full"
          /* Spring rather than a duration so a fast run along the row
             overtakes itself instead of queueing. Reduced motion gets the
             same chip in the same place, arriving instantly. */
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 38, mass: 0.8 }}
        />
      )}
      <span className="relative z-10 inline-flex items-center">{children}</span>
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn("animate-reveal", className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };

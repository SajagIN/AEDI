import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

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

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/*  A styled native <select>.
 *
 *  Five views had each written out the same forty-character class string by
 *  hand, which meant five places to edit for one theme change and five
 *  chances to miss one. It is one component now.
 *
 *  Native rather than a Radix listbox on purpose: this is a plain choice from
 *  a short list, and the platform control already brings keyboard navigation,
 *  type-ahead, screen-reader announcement and — on a phone — the system
 *  picker. A custom listbox would be more code to get less.
 *
 *  appearance-none removes the OS arrow so the recess reads cleanly, so the
 *  arrow is drawn back in and marked aria-hidden; the select underneath keeps
 *  every semantic it started with.
 */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    /* The caller's classes go on the wrapper, not the control. Every one of
       them is a width — w-full, max-w-xl — and on the inner element they
       would size a select inside a shrink-wrapped box that stayed narrow. */
    <div className={cn("relative inline-flex", className)}>
      <select
        ref={ref}
        className={cn(
          "nm-inset h-9 w-full appearance-none rounded-lg py-0 pl-3 pr-9",
          "font-mono text-[12.5px] text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  ),
);
Select.displayName = "Select";
export { Select };

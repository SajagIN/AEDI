import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GridVignetteBackground } from "@/components/ui/vignette-grid-background";
import CursorGrid from "@/components/reactbits/cursor-grid";
import { getHealth, type Health } from "@/lib/api";
import Overview from "@/views/Overview";
import CaseExplorer from "@/views/CaseExplorer";
import Evaluation from "@/views/Evaluation";
import Adversarial from "@/views/Adversarial";
import Live from "@/views/Live";

const TABS = [
  { v: "overview", n: "Overview", i: "01" },
  { v: "cases", n: "Case Explorer", i: "02" },
  { v: "evaluation", n: "Evaluation", i: "03" },
  { v: "adversarial", n: "Adversarial", i: "04" },
  { v: "live", n: "Live · Razorpay", i: "05" },
];

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [split, setSplit] = useState("held_out");

  useEffect(() => {
    getHealth().then((h) => {
      setHealth(h);
      /* Pick the split with the most cases actually scored — not merely the
         first one that has an output.csv. An interrupted run leaves a one-row
         file on dev, and `dev` sorts first, so the old check silently selected
         a split with a single scored case and every number read as zero. */
      const best = Object.entries(h.splits)
        .filter(([, v]) => v.scored > 0)
        .sort((a, b) => (b[1].complete ? 1 : 0) - (a[1].complete ? 1 : 0) || b[1].scored - a[1].scored);
      if (best.length) setSplit(best[0][0]);
    });
  }, []);

  const live = health?.mode === "live";

  /* The Tabs root has to enclose both the trigger row (which lives in the
     sticky masthead) and the panels (which scroll), so it wraps the page. */
  return (
    <TooltipProvider delayDuration={150}>
    {/* Ruled ground. Anchored to the top of the viewport and feathered out
        downward, so the grid is densest behind the masthead and the hero and
        has vanished by the time the reader reaches the numbers. */}
    <GridVignetteBackground />
    {/* The ruled ground above is static and stops below the hero. This layer
        is the opposite: it draws nothing at all until a pointer moves, then
        lights the cells it passes and halts its own frame loop the moment the
        last one has faded. Composited over the static grid it reads as the
        same lattice waking up under the cursor, and it costs nothing while
        the reader is still. Pointer-events off, so it never eats a click. */}
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
      <CursorGrid />
    </div>
    <Tabs defaultValue="overview" className="min-h-screen">
      {/* ── masthead ──────────────────────────────────────────────────────
          Set like the head of a printed report: the wordmark in the serif,
          everything else in small monospace caps, all of it sitting on a
          hairline rule. */}
      <header className="nm-raised-lg sticky top-0 z-50 rounded-none border-0 frost">
        <div className="mx-auto max-w-[1400px] px-6">
          <div className="flex h-[68px] items-center gap-5">
            {/* The logo is gone: a 32px mark next to a four-letter wordmark was
                two logos arguing. Bodoni Moda stands in for Bodoni MT
                Condensed, which is a Monotype commercial licence — the
                condensed feel comes from tracking, not from scaleX, because
                squeezing a Didone thickens its hairlines and takes away the
                only reason to set one. */}
            <div className="flex items-baseline gap-3.5">
              <span className="font-wordmark text-[31px] font-semibold leading-none tracking-[-.045em]">
                AEDI
              </span>
              <span className="hidden font-mono text-[10px] uppercase leading-none tracking-[.14em] text-muted-foreground sm:inline">
                Automated Evidence &middot; Defense against Injections
              </span>
            </div>

            <div className="ml-auto flex items-center gap-5">
              <span className="dateline hidden text-muted-foreground/70 lg:inline">
                Chargeback&nbsp;Evidence&nbsp;Responder
              </span>

              {health && (
                <span role="status" className="nm-raised-sm flex items-center gap-2 rounded-md px-2.5 py-1.5">
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${live ? "animate-ember bg-signal-good" : "bg-signal-info"}`} />
                  <span className="dateline text-foreground/80">{live ? health.model : "Replay"}</span>
                  <span className="dateline text-muted-foreground/60">{live ? "live" : "no key needed"}</span>
                </span>
              )}
            </div>
          </div>

          <TabsList className="no-scrollbar w-full justify-start overflow-x-auto border-b-0">
            {TABS.map((t, i) => (
              <TabsTrigger key={t.v} value={t.v} className="reveal group" style={{ "--i": i } as React.CSSProperties}>
                <span className="mr-2 text-[9px] text-muted-foreground/40 transition-colors group-data-[state=active]:text-cobalt/60">
                  {t.i}
                </span>
                {t.n}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 pb-28 pt-8">
        <TabsContent value="overview"><Overview split={split} /></TabsContent>
        <TabsContent value="cases">
          {health && <CaseExplorer health={health} split={split} setSplit={setSplit} />}
        </TabsContent>
        <TabsContent value="evaluation">
          {health && <Evaluation health={health} split={split} setSplit={setSplit} />}
        </TabsContent>
        <TabsContent value="adversarial">
          {health && <Adversarial health={health} />}
        </TabsContent>
        <TabsContent value="live"><Live /></TabsContent>
      </main>
    </Tabs>
    </TooltipProvider>
  );
}

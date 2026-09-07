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
      const best = Object.entries(h.splits)
        .filter(([, v]) => v.scored > 0)
        .sort((a, b) => (b[1].complete ? 1 : 0) - (a[1].complete ? 1 : 0) || b[1].scored - a[1].scored);
      if (best.length) setSplit(best[0][0]);
    });
  }, []);

  const live = health?.mode === "live";

  return (
    <TooltipProvider delayDuration={150}>
    <GridVignetteBackground />
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
      <CursorGrid />
    </div>
    <Tabs defaultValue="overview" className="min-h-screen">
      <header className="nm-bar sticky top-0 z-50 rounded-b-[20px]">
        <div className="mx-auto max-w-[1400px] px-6">
          <div className="flex h-[68px] items-center gap-5">
            <div className="flex items-baseline gap-3.5">
              <span className="font-display text-[26px] font-extrabold leading-none tracking-[-.035em]">
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

          <TabsList className="no-scrollbar mb-3 max-w-full overflow-x-auto">
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

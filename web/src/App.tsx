import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { getHealth, type Health } from "@/lib/api";
import Overview from "@/views/Overview";
import CaseExplorer from "@/views/CaseExplorer";
import Evaluation from "@/views/Evaluation";
import Adversarial from "@/views/Adversarial";
import Live from "@/views/Live";

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

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-black/[.06] bg-white/70 glass">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-6">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="AEDI" className="h-9 w-9 rounded-[10px] shadow-ios" />
            <div className="leading-none">
              <div className="text-[17px] font-semibold tracking-[.18em]">AEDI</div>
              <div className="mt-1 text-[10px] uppercase tracking-[.1em] text-muted-foreground">
                Because a hunch isn't evidence
              </div>
            </div>
          </div>

          <Tabs value="" className="ml-auto hidden md:block" />

          <div className="ml-auto flex items-center gap-3">
            {health && (
              <Badge variant={health.mode === "live" ? "green" : "blue"} className="h-7 px-3">
                <span className={`mr-1 h-1.5 w-1.5 rounded-full ${health.mode === "live" ? "bg-ios-green" : "bg-ios-blue"}`} />
                {health.mode === "live" ? `Live · ${health.model}` : "Replay · no key needed"}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 pb-24 pt-7">
        <Tabs defaultValue="overview">
          <TabsList className="mb-7">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="cases">Case Explorer</TabsTrigger>
            <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
            <TabsTrigger value="adversarial">Adversarial</TabsTrigger>
            <TabsTrigger value="live">Live · Razorpay</TabsTrigger>
          </TabsList>

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
        </Tabs>
      </main>
    </div>
  );
}

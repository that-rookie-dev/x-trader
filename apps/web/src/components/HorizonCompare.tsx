"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

export type ComparePoint = { at: string; spot: number; algo: number | null; ai: number | null };

export function HorizonCompare({ points, height = 280 }: { points: ComparePoint[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length < 2) return;
    let disposed = false;
    let chart: IChartApi | null = null;
    let ro: ResizeObserver | null = null;
    void import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (disposed || !ref.current) return;
      const dark = document.documentElement.dataset.theme !== "light";
      chart = createChart(ref.current, {
        height,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: dark ? "#8b97a8" : "#5c6b7b",
        },
        grid: {
          vertLines: { color: dark ? "#1e2430" : "#e6ebf1" },
          horzLines: { color: dark ? "#1e2430" : "#e6ebf1" },
        },
        rightPriceScale: { borderColor: dark ? "#232a35" : "#d7dee8" },
        timeScale: { borderColor: dark ? "#232a35" : "#d7dee8", timeVisible: true, secondsVisible: false },
        width: Math.max(ref.current.clientWidth, 320),
      });
      const market = chart.addLineSeries({ color: "#e8eef6", lineWidth: 2, title: "Market" });
      const algo = chart.addLineSeries({ color: "#3dd68c", lineWidth: 2, title: "Algo" });
      const ai = chart.addLineSeries({ color: "#7aa2ff", lineWidth: 2, title: "AI" });
      const seen = new Set<number>();
      const rows = points.flatMap((point) => {
        const time = Math.floor(new Date(point.at).getTime() / 1000);
        if (!Number.isFinite(time) || seen.has(time)) return [];
        seen.add(time);
        return [{ time: time as UTCTimestamp, spot: point.spot, algo: point.algo, ai: point.ai }];
      });
      market.setData(rows.map((row) => ({ time: row.time, value: row.spot })));
      algo.setData(rows.filter((row) => row.algo != null).map((row) => ({ time: row.time, value: row.algo as number })));
      ai.setData(rows.filter((row) => row.ai != null).map((row) => ({ time: row.time, value: row.ai as number })));
      chart.timeScale().fitContent();
      ro = new ResizeObserver(() => {
        if (ref.current && chart) chart.applyOptions({ width: ref.current.clientWidth });
      });
      ro.observe(ref.current);
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      chart?.remove();
    };
  }, [points, height]);

  if (points.length < 2) {
    return <p className="muted">The first two prints land about a minute apart. After that, Market, Algo, and AI draw for the horizon you pick.</p>;
  }
  return <div ref={ref} style={{ width: "100%", height }} />;
}

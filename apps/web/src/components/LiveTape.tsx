"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

type Point = { time: number; value: number };

export function LiveTape({ points, height = 220 }: { points: Point[]; height?: number }) {
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
      const last = points[points.length - 1]!.value;
      const first = points[0]!.value;
      const up = last >= first;
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
        timeScale: { borderColor: dark ? "#232a35" : "#d7dee8", timeVisible: true, secondsVisible: true },
        width: Math.max(ref.current.clientWidth, 320),
      });
      const series = chart.addLineSeries({
        color: up ? "#3dd68c" : "#ff6b7a",
        lineWidth: 2,
      });
      series.setData(
        points.map((p) => ({
          time: (p.time > 1_000_000_000_000 ? Math.floor(p.time / 1000) : p.time) as UTCTimestamp,
          value: p.value,
        })),
      );
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

  if (points.length < 2) return <p className="muted">Live tape will draw as prices tick.</p>;
  return <div ref={ref} style={{ width: "100%", height }} />;
}

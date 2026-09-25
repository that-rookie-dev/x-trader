"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

export type ComparePoint = { at: string; spot: number; algo: number | null; ai: number | null };

const SHIFT_MIN: Record<string, number> = {
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "6h": 360,
};

type Bar = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
type Line = { time: UTCTimestamp; value: number };

/** Forecasts are stored on the quote that made them. Draw them on the minute they named. */
function rowsOf(points: ComparePoint[], horizon: string) {
  const shift = (SHIFT_MIN[horizon] ?? 0) * 60;
  const seen = new Set<number>();
  const market: Line[] = [];
  const algo: Line[] = [];
  const ai: Line[] = [];
  for (const point of points) {
    const time = Math.floor(new Date(point.at).getTime() / 1000);
    if (!Number.isFinite(time) || seen.has(time)) continue;
    seen.add(time);
    market.push({ time: time as UTCTimestamp, value: point.spot });
    const aimed = (time + shift) as UTCTimestamp;
    if (point.algo != null) algo.push({ time: aimed, value: point.algo });
    if (point.ai != null) ai.push({ time: aimed, value: point.ai });
  }
  return { market, algo, ai };
}

function toCandles(line: Line[]): Bar[] {
  const buckets = new Map<number, Bar>();
  for (const row of line) {
    const minute = Math.floor(row.time / 60) * 60;
    const bar = buckets.get(minute);
    if (!bar) buckets.set(minute, { time: minute as UTCTimestamp, open: row.value, high: row.value, low: row.value, close: row.value });
    else {
      bar.high = Math.max(bar.high, row.value);
      bar.low = Math.min(bar.low, row.value);
      bar.close = row.value;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export function HorizonCompare({
  points,
  horizon,
  showAlgo,
  showAi,
  candles,
  height = 280,
}: {
  points: ComparePoint[];
  horizon: string;
  showAlgo: boolean;
  showAi: boolean;
  candles: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length < 2) return;
    let disposed = false;
    const charts: IChartApi[] = [];
    let ro: ResizeObserver | null = null;
    void import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (disposed || !ref.current) return;
      const dark = document.documentElement.dataset.theme !== "light";
      const { market, algo, ai } = rowsOf(points, horizon);
      const panes = [{ name: "Market", color: "#e8eef6", line: market }];
      if (showAlgo) panes.push({ name: "Algo", color: "#3dd68c", line: algo });
      if (showAi) panes.push({ name: "AI", color: "#7aa2ff", line: ai });
      const host = ref.current;
      host.replaceChildren();

      const mount = (box: HTMLDivElement, paneHeight: number) => {
        const chart = createChart(box, {
          height: paneHeight,
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
          width: Math.max(box.clientWidth, 320),
        });
        charts.push(chart);
        return chart;
      };

      if (!candles) {
        const box = document.createElement("div");
        host.appendChild(box);
        const chart = mount(box, height);
        for (const pane of panes) {
          const series = chart.addLineSeries({ color: pane.color, lineWidth: 2, title: pane.name });
          if (pane.line.length) series.setData(pane.line);
        }
        chart.timeScale().fitContent();
      } else {
        const paneHeight = Math.max(160, Math.round(height * 0.78));
        for (const pane of panes) {
          const label = document.createElement("div");
          label.className = "compare-pane-label";
          label.textContent = pane.name;
          const box = document.createElement("div");
          host.appendChild(label);
          host.appendChild(box);
          const chart = mount(box, paneHeight);
          const series = chart.addCandlestickSeries({
            upColor: "#3dd68c",
            downColor: "#f07178",
            borderVisible: false,
            wickUpColor: "#3dd68c",
            wickDownColor: "#f07178",
          });
          const bars = toCandles(pane.line);
          if (bars.length) series.setData(bars);
          chart.timeScale().fitContent();
        }
        for (const source of charts) {
          source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (!range) return;
            for (const other of charts) {
              if (other !== source) other.timeScale().setVisibleLogicalRange(range);
            }
          });
        }
      }

      ro = new ResizeObserver(() => {
        const width = ref.current?.clientWidth ?? 320;
        for (const chart of charts) chart.applyOptions({ width });
      });
      ro.observe(ref.current);
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      for (const chart of charts) chart.remove();
      if (ref.current) ref.current.replaceChildren();
    };
  }, [points, horizon, showAlgo, showAi, candles, height]);

  if (points.length < 2) {
    return <p className="muted">The first two prints land about a minute apart. After that, Market, Algo, and AI draw for the horizon you pick.</p>;
  }
  return <div ref={ref} style={{ width: "100%" }} />;
}

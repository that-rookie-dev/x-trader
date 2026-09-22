"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, UTCTimestamp } from "lightweight-charts";

type Candle = { time: number; open: number; high: number; low: number; close: number };

export type ChartLine = {
  price: number;
  title: string;
  color: string;
  dashed?: boolean;
};

function toBar(c: Candle) {
  return {
    time: (c.time > 1_000_000_000_000 ? Math.floor(c.time / 1000) : c.time) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

export function CandleChart({
  candles,
  height = 280,
  fill = false,
  lines = [],
}: {
  candles: Candle[];
  height?: number;
  fill?: boolean;
  lines?: ChartLine[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const lineStyle = useRef<number>(2);
  const timesRef = useRef<number[]>([]);
  const fittedRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    void import("lightweight-charts").then(({ createChart, ColorType, LineStyle }) => {
      if (disposed || !ref.current) return;
      lineStyle.current = LineStyle.Dashed;
      const dark = document.documentElement.dataset.theme !== "light";
      const size = () => ({
        width: Math.max(ref.current?.clientWidth ?? 320, 200),
        height: fill ? Math.max(ref.current?.clientHeight ?? 200, 180) : height,
      });
      const chart = createChart(ref.current, {
        ...size(),
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: dark ? "#8b97a8" : "#5c6b7b",
        },
        grid: {
          vertLines: { color: dark ? "#1e2430" : "#e6ebf1" },
          horzLines: { color: dark ? "#1e2430" : "#e6ebf1" },
        },
        rightPriceScale: { borderColor: dark ? "#232a35" : "#d7dee8" },
        timeScale: { borderColor: dark ? "#232a35" : "#d7dee8", timeVisible: true },
      });
      const series = chart.addCandlestickSeries({
        upColor: "#3dd68c",
        downColor: "#f07178",
        borderVisible: false,
        wickUpColor: "#3dd68c",
        wickDownColor: "#f07178",
      });
      chartRef.current = chart;
      seriesRef.current = series;
      setReady(true);
      ro = new ResizeObserver(() => {
        if (ref.current && chartRef.current) chartRef.current.applyOptions(size());
      });
      ro.observe(ref.current);
    });
    return () => {
      disposed = true;
      setReady(false);
      ro?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLines.current = [];
      timesRef.current = [];
      fittedRef.current = false;
    };
  }, [fill, height]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!ready || !series || !chart || candles.length === 0) return;
    const bars = candles.map(toBar);
    const times = bars.map((b) => Number(b.time));
    const prev = timesRef.current;
    const sameShape = prev.length === times.length && prev.every((t, i) => t === times[i]);
    if (sameShape && bars.length) {
      series.update(bars[bars.length - 1]!);
    } else {
      series.setData(bars);
      timesRef.current = times;
      if (!fittedRef.current || prev.length !== times.length) {
        chart.timeScale().fitContent();
        fittedRef.current = true;
      }
    }
  }, [candles, ready]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!ready || !series) return;
    for (const line of priceLines.current) series.removePriceLine(line);
    priceLines.current = [];
    for (const line of lines) {
      if (!Number.isFinite(line.price) || line.price <= 0) continue;
      priceLines.current.push(
        series.createPriceLine({
          price: line.price,
          color: line.color,
          lineWidth: 1,
          lineStyle: line.dashed ? lineStyle.current : 0,
          axisLabelVisible: true,
          title: line.title,
        }),
      );
    }
  }, [lines, ready]);

  return (
    <div ref={ref} className={fill ? "chart-fill" : undefined} style={fill ? undefined : { width: "100%", height }}>
      {candles.length === 0 ? <p className="muted pad">No closed candles yet — live ticks are aggregating.</p> : null}
    </div>
  );
}

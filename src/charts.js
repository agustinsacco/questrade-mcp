import asciichart from 'asciichart';

export const MAX_WIDTH = 80;

/** Evenly sample a series down to `width` points, always keeping the last one. */
export function sample(data, width = MAX_WIDTH) {
  if (data.length <= width) return data;
  const step = (data.length - 1) / (width - 1);
  return Array.from({ length: width }, (_, i) => data[Math.round(i * step)]);
}

export function priceChart(candles, height = 10) {
  if (!candles.length) return 'No data.';
  return asciichart.plot(sample(candles.map((c) => c.close)), { height, offset: 2 });
}

/** % change from each series' first close, on one chart. */
export function comparisonChart(series, height = 10) {
  const lines = series
    .filter((s) => s.candles.length > 0)
    .map(({ candles }) => {
      const start = candles[0].close;
      return sample(candles.map((c) => ((c.close - start) / start) * 100));
    });
  if (!lines.length) return 'No data.';
  return `${asciichart.plot(lines, { height, offset: 2 })}\n(% change from the first close; series in the order given)`;
}

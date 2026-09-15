import asciichart from 'asciichart';

export class AsciiChartUtil {
    static MAX_WIDTH = 80;
    static DEFAULT_HEIGHT = 10;

    static generateSingleSeriesPlot(candles, height = this.DEFAULT_HEIGHT) {
        if (!candles || candles.length === 0) return 'No data available.';
        const closePrices = candles.map((c) => c.close);
        const sampled = this.sampleData(closePrices);
        return asciichart.plot(sampled, { height, offset: 2 });
    }

    static generateMultiSeriesPlot(seriesData, height = this.DEFAULT_HEIGHT) {
        if (!seriesData || seriesData.length === 0) return 'No data.';
        const normalized = seriesData.map(({ candles }) => {
            if (!candles || candles.length === 0) return [];
            const start = candles[0].close;
            return this.sampleData(candles.map((c) => ((c.close - start) / start) * 100));
        });

        const valid = normalized.filter(s => s.length > 0);
        if (valid.length === 0) return 'No valid data.';

        const plot = asciichart.plot(valid, { height, offset: 2 });
        return plot + '\n\n(Y-axis shows % change from start)';
    }

    static sampleData(data) {
        if (data.length <= this.MAX_WIDTH) return data;
        const step = Math.ceil(data.length / this.MAX_WIDTH);
        return data.filter((_, i) => i % step === 0);
    }

    static formatCompactData(candles) {
        return candles.map((c) => [c.end, c.open, c.high, c.low, c.close, c.volume]);
    }
}

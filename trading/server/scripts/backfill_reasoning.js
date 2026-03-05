#!/usr/bin/env node
/**
 * Backfill reasoning JSON for strategy_trades that have reasoning IS NULL.
 *
 * Usage: node server/scripts/backfill_reasoning.js
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../data/trading.db');
const ALPACA_DATA_URL = process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets';
const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY;

async function fetchBars(symbol, startDate, endDate) {
    if (!ALPACA_API_KEY || !ALPACA_SECRET_KEY) {
        throw new Error('Alpaca credentials not configured');
    }

    const url = new URL(`${ALPACA_DATA_URL}/v2/stocks/${symbol}/bars`);
    url.searchParams.set('timeframe', '1Day');
    url.searchParams.set('start', startDate);
    url.searchParams.set('end', endDate);
    url.searchParams.set('limit', '1000');

    const resp = await fetch(url.toString(), {
        headers: {
            'APCA-API-KEY-ID': ALPACA_API_KEY,
            'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
        }
    });

    if (!resp.ok) {
        throw new Error(`Alpaca ${resp.status}: ${resp.statusText}`);
    }

    const data = await resp.json();
    return (data.bars || []).map(bar => ({
        time: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v
    }));
}

function computeEMA(values, period) {
    const result = [];
    const k = 2 / (period + 1);
    let ema = values[0];
    result.push(ema);
    for (let i = 1; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
        result.push(ema);
    }
    return result;
}

function computeRSI(closes, period = 14) {
    const result = new Array(closes.length).fill(NaN);
    if (closes.length < period + 1) return result;

    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) avgGain += diff;
        else avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;
    result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return result;
}

function computeMACD(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = computeEMA(closes, fast);
    const emaSlow = computeEMA(closes, slow);
    const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
    const signalLine = computeEMA(macdLine, signal);
    return { macdLine, signalLine };
}

function buildReasoning(closes, index, action) {
    const rsiValues = computeRSI(closes, 14);
    const ema20 = computeEMA(closes, 20);
    const ema50 = computeEMA(closes, 50);
    const { macdLine, signalLine } = computeMACD(closes);

    const rsi = rsiValues[index];
    const macdBullish = macdLine[index] > signalLine[index];
    const emaAbove = ema20[index] > ema50[index];

    let rsiLabel = 'neutral';
    if (rsi < 30) rsiLabel = 'oversold';
    else if (rsi < 45) rsiLabel = 'weakening';
    else if (rsi > 70) rsiLabel = 'overbought';
    else if (rsi > 55) rsiLabel = 'strong';

    const score = (rsi > 55 ? 1 : rsi < 45 ? -1 : 0)
        + (macdBullish ? 1 : -1)
        + (emaAbove ? 1 : -1);

    return {
        indicators: {
            rsi: isNaN(rsi) ? null : parseFloat(rsi.toFixed(2)),
            macd: macdBullish ? 'bullish' : 'bearish',
            ema_cross: emaAbove ? 'above' : 'below',
            composite_score: score
        },
        condition: `RSI=${isNaN(rsi) ? 'N/A' : rsi.toFixed(1)} [${rsiLabel}], MACD ${macdBullish ? 'bullish' : 'bearish'}, EMA20 ${emaAbove ? 'above' : 'below'} EMA50`,
        decision: action.toUpperCase()
    };
}

async function main() {
    if (!fs.existsSync(DB_PATH)) {
        console.error(`Database not found at ${DB_PATH}`);
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const fileBuffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(fileBuffer);

    // Get all trades with NULL reasoning, grouped by symbol
    const trades = db.exec(`
        SELECT id, strategy_id, symbol, side, price, executed_at
        FROM strategy_trades
        WHERE reasoning IS NULL
        ORDER BY symbol, executed_at
    `);

    if (!trades.length || !trades[0].values.length) {
        console.log('No trades need backfilling.');
        db.close();
        return;
    }

    const rows = trades[0].values.map(r => ({
        id: r[0], strategy_id: r[1], symbol: r[2], side: r[3], price: r[4], executed_at: r[5]
    }));

    // Group by symbol
    const bySymbol = {};
    for (const row of rows) {
        if (!bySymbol[row.symbol]) bySymbol[row.symbol] = [];
        bySymbol[row.symbol].push(row);
    }

    let totalBackfilled = 0;

    for (const [symbol, symbolTrades] of Object.entries(bySymbol)) {
        const dates = symbolTrades.map(t => t.executed_at).sort();
        const minDate = dates[0].split('T')[0];
        // Add buffer days before min for indicator warm-up
        const warmupDate = new Date(new Date(minDate).getTime() - 60 * 24 * 60 * 60 * 1000);
        const startDate = warmupDate.toISOString().split('T')[0];
        const maxDate = dates[dates.length - 1].split('T')[0];

        let bars;
        try {
            bars = await fetchBars(symbol, startDate, maxDate);
        } catch (error) {
            console.error(`Alpaca unavailable for ${symbol}: ${error.message}`);
            // Fallback: set basic reasoning
            for (const trade of symbolTrades) {
                const fallback = JSON.stringify({
                    condition: 'Historical data unavailable for replay',
                    decision: trade.side.toUpperCase()
                });
                db.run('UPDATE strategy_trades SET reasoning = ? WHERE id = ?', [fallback, trade.id]);
                totalBackfilled++;
            }
            console.log(`Backfilled ${symbolTrades.length}/${symbolTrades.length} trades for ${symbol} (fallback)`);
            continue;
        }

        if (bars.length < 2) {
            for (const trade of symbolTrades) {
                const fallback = JSON.stringify({
                    condition: 'Insufficient historical data',
                    decision: trade.side.toUpperCase()
                });
                db.run('UPDATE strategy_trades SET reasoning = ? WHERE id = ?', [fallback, trade.id]);
                totalBackfilled++;
            }
            console.log(`Backfilled ${symbolTrades.length}/${symbolTrades.length} trades for ${symbol} (insufficient data)`);
            continue;
        }

        const closes = bars.map(b => b.close);
        const barTimes = bars.map(b => new Date(b.time).getTime());

        let symbolCount = 0;
        for (const trade of symbolTrades) {
            const tradeTime = new Date(trade.executed_at).getTime();
            // Find nearest bar within 5 min tolerance (or closest day)
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < barTimes.length; i++) {
                const dist = Math.abs(barTimes[i] - tradeTime);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIdx = i;
                }
            }

            const reasoning = buildReasoning(closes, bestIdx, trade.side);
            db.run('UPDATE strategy_trades SET reasoning = ? WHERE id = ?', [JSON.stringify(reasoning), trade.id]);
            symbolCount++;
            totalBackfilled++;
        }
        console.log(`Backfilled ${symbolCount}/${symbolTrades.length} trades for ${symbol}`);
    }

    // Save DB
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    db.close();

    console.log(`\nDone. Backfilled ${totalBackfilled} total trades.`);
}

main().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});

'use client';

import { useState } from 'react';
import type { ActiveSymbol } from '@deriv/core';
import { useAccumulatorBot, type BotConfig, type BotStrategy } from '../hooks/use-accumulator-bot';
import type { AccumulatorProposalInfo } from '../hooks/use-accumulator-proposal';
import type { OpenPosition } from '../lib/types';

const MARKETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const MARKET_LABEL: Record<string, string> = {
  R_10: 'Volatility 10', R_25: 'Volatility 25', R_50: 'Volatility 50', R_75: 'Volatility 75', R_100: 'Volatility 100',
};
const STRATEGIES: { value: BotStrategy; label: string }[] = [
  { value: 'hit', label: 'Enter right after a barrier hit' },
  { value: 'quiet', label: 'Enter after N ticks with no hit' },
  { value: 'streak', label: 'Enter after N hits in a row' },
  { value: 'always', label: 'Enter every time (no condition)' },
];

const field =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground';
const lbl = 'mb-1 mt-2 block text-xs text-muted-foreground';

interface Props {
  isAuthenticated: boolean;
  isRealAccount: boolean;
  symbols: ActiveSymbol[];
  activeSymbol: ActiveSymbol | null;
  selectSymbol: (symbol: string) => void;
  growthRate: number;
  setGrowthRate: (rate: number) => void;
  stake: string;
  setStake: (v: string) => void;
  proposal: AccumulatorProposalInfo | null;
  buyContract: () => Promise<void>;
  isBuying: boolean;
  openPositions: OpenPosition[];
  sellContract: (contractId: number, bidPrice: string) => Promise<void>;
}

export function BotPanel(p: Props) {
  const [open, setOpen] = useState(true);
  const [allowReal, setAllowReal] = useState(false);
  const [cfg, setCfg] = useState<BotConfig>({
    strategy: 'hit', n: 3, targetTicks: 2, stopProfit: 5, stopLoss: 10,
  });
  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  const bot = useAccumulatorBot(
    {
      proposal: p.proposal, buyContract: p.buyContract, isBuying: p.isBuying,
      openPositions: p.openPositions, sellContract: p.sellContract,
      resetKey: `${p.activeSymbol?.underlying_symbol}-${p.growthRate}`,
    },
    cfg
  );

  const canStart = p.isAuthenticated && (!p.isRealAccount || allowReal);
  const markets = MARKETS.filter((m) => p.symbols.some((s) => s.underlying_symbol === m));
  const winRate = bot.trades ? Math.round((bot.wins / bot.trades) * 100) : 0;

  return (
    <div className="fixed bottom-3 right-3 z-[80] w-[320px] max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-card text-card-foreground shadow-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold"
      >
        <span>Auto Bot {bot.running ? '(running)' : ''}</span>
        <span className="text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="max-h-[75vh] overflow-y-auto border-t border-border px-3 pb-3">
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded border border-border px-2 py-0.5">Since hit: <b>{bot.since}</b></span>
            <span className="rounded border border-border px-2 py-0.5">Hits: {bot.hits}</span>
            <span className="rounded border border-border px-2 py-0.5">P/L: {bot.sessionPL.toFixed(2)}</span>
            <span className="rounded border border-border px-2 py-0.5">Trades: {bot.trades} ({winRate}% win)</span>
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            Gaps: {bot.gaps.length ? bot.gaps.join('  ') : '-'}
          </div>

          <label className={lbl}>Market</label>
          <select className={field} disabled={bot.running}
            value={p.activeSymbol?.underlying_symbol ?? ''} onChange={(e) => p.selectSymbol(e.target.value)}>
            {markets.map((m) => <option key={m} value={m}>{MARKET_LABEL[m]}</option>)}
          </select>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={lbl}>Growth %</label>
              <select className={field} disabled={bot.running} value={Math.round(p.growthRate * 100)}
                onChange={(e) => p.setGrowthRate(Number(e.target.value) / 100)}>
                {[1, 2, 3, 4, 5].map((g) => <option key={g} value={g}>{g}%</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Stake</label>
              <input className={field} type="number" min="1" disabled={bot.running}
                value={p.stake} onChange={(e) => p.setStake(e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Target ticks</label>
              <select className={field} value={cfg.targetTicks}
                onChange={(e) => set('targetTicks', Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <label className={lbl}>Strategy</label>
          <select className={field} value={cfg.strategy} onChange={(e) => set('strategy', e.target.value as BotStrategy)}>
            {STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {(cfg.strategy === 'quiet' || cfg.strategy === 'streak') && (
            <>
              <label className={lbl}>N</label>
              <input className={field} type="number" min="1" value={cfg.n}
                onChange={(e) => set('n', Math.max(1, Number(e.target.value)))} />
            </>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lbl}>Stop at profit</label>
              <input className={field} type="number" min="0" value={cfg.stopProfit}
                onChange={(e) => set('stopProfit', Number(e.target.value))} />
            </div>
            <div>
              <label className={lbl}>Stop at loss</label>
              <input className={field} type="number" min="0" value={cfg.stopLoss}
                onChange={(e) => set('stopLoss', Number(e.target.value))} />
            </div>
          </div>

          {p.isRealAccount && (
            <label className="mt-2 flex items-start gap-2 text-xs text-destructive">
              <input type="checkbox" checked={allowReal} onChange={(e) => setAllowReal(e.target.checked)} />
              <span>REAL account is active. Tick to let the bot trade real money.</span>
            </label>
          )}
          {!p.isAuthenticated && <p className="mt-2 text-xs text-muted-foreground">Log in first to start the bot.</p>}

          <button
            type="button"
            disabled={!bot.running && !canStart}
            onClick={bot.running ? bot.stop : bot.start}
            className={`mt-3 w-full rounded-md px-3 py-2 text-sm font-bold disabled:opacity-50 ${
              bot.running ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground'
            }`}
          >
            {bot.running ? 'Stop bot' : 'Start bot'}
          </button>

          <div className="mt-3 h-32 overflow-y-auto rounded border border-border p-2 font-mono text-[11px] leading-5">
            {bot.log.length === 0 && <span className="text-muted-foreground">No activity yet</span>}
            {bot.log.map((l) => (
              <div key={l.id} className={l.kind === 'win' ? 'text-green-500' : l.kind === 'loss' ? 'text-red-500' : 'text-muted-foreground'}>
                {l.time} {l.text}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            No strategy guarantees profit. A barrier hit loses the whole stake. Test on demo first.
          </p>
        </div>
      )}
    </div>
  );
}

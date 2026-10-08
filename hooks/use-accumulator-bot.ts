'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccumulatorProposalInfo } from './use-accumulator-proposal';
import type { OpenPosition } from '../lib/types';

export type BotStrategy = 'hit' | 'quiet' | 'streak' | 'always';

export interface BotConfig {
  strategy: BotStrategy;
  /** Strategy parameter N (ticks with no hit / hits in a row). */
  n: number;
  /** Close the contract once this many ticks have passed (1-5). */
  targetTicks: number;
  /** Stop the bot when session profit reaches this (USD). 0 = off. */
  stopProfit: number;
  /** Stop the bot when session loss reaches this (USD). 0 = off. */
  stopLoss: number;
}

export interface BotLogEntry {
  id: number;
  time: string;
  text: string;
  kind: 'info' | 'win' | 'loss';
}

interface Params {
  proposal: AccumulatorProposalInfo | null;
  buyContract: () => Promise<void>;
  isBuying: boolean;
  openPositions: OpenPosition[];
  sellContract: (contractId: number, bidPrice: string) => Promise<void>;
  /** Changing these resets the hit counters. */
  resetKey: string;
}

/**
 * Auto-trading engine layered on top of the template's own hooks.
 * Every new proposal update is one tick. A "barrier hit" is a tick whose spot
 * crossed the barriers shown for the previous tick (proposal.hasCrossedBarrier).
 */
export function useAccumulatorBot(
  { proposal, buyContract, isBuying, openPositions, sellContract, resetKey }: Params,
  config: BotConfig
) {
  const [running, setRunning] = useState(false);
  const [since, setSince] = useState(0);
  const [hits, setHits] = useState(0);
  const [gaps, setGaps] = useState<number[]>([]);
  const [sessionPL, setSessionPL] = useState(0);
  const [trades, setTrades] = useState(0);
  const [wins, setWins] = useState(0);
  const [log, setLog] = useState<BotLogEntry[]>([]);

  const cfg = useRef(config);
  cfg.current = config;
  const runningRef = useRef(false);
  runningRef.current = running;

  const sinceRef = useRef(0);
  const consecRef = useRef(0);
  const lastProposalId = useRef<string | null>(null);
  const lastBuyAt = useRef(0);
  const trackedId = useRef<number | null>(null);
  const sellSent = useRef<Set<number>>(new Set());
  const settled = useRef<Set<number>>(new Set());
  const logId = useRef(0);

  const addLog = useCallback((text: string, kind: BotLogEntry['kind'] = 'info') => {
    setLog((prev) =>
      [{ id: ++logId.current, time: new Date().toLocaleTimeString(), text, kind }, ...prev].slice(0, 60)
    );
  }, []);

  const stop = useCallback(
    (why: string) => {
      setRunning(false);
      addLog(`Bot stopped: ${why}`);
    },
    [addLog]
  );

  // Reset counters when market or growth rate changes.
  useEffect(() => {
    sinceRef.current = 0;
    consecRef.current = 0;
    lastProposalId.current = null;
    setSince(0);
    setGaps([]);
  }, [resetKey]);

  // One proposal update = one tick: track hits, then check the strategy.
  useEffect(() => {
    if (!proposal || proposal.id === lastProposalId.current) return;
    lastProposalId.current = proposal.id;

    const hit = proposal.hasCrossedBarrier;
    if (hit) {
      setGaps((g) => [sinceRef.current, ...g].slice(0, 10));
      setHits((h) => h + 1);
      consecRef.current += 1;
      sinceRef.current = 0;
    } else {
      sinceRef.current += 1;
      consecRef.current = 0;
    }
    setSince(sinceRef.current);

    if (!runningRef.current || isBuying) return;
    const hasOpen = openPositions.some((p) => p.contract_type === 'ACCU' && p.status === 'open');
    if (hasOpen || trackedId.current !== null) return;
    if (Date.now() - lastBuyAt.current < 2000) return;

    const { strategy, n } = cfg.current;
    const signal =
      strategy === 'always' ||
      (strategy === 'hit' && hit) ||
      (strategy === 'quiet' && sinceRef.current >= n) ||
      (strategy === 'streak' && consecRef.current >= n);
    if (!signal) return;

    lastBuyAt.current = Date.now();
    addLog(`Signal matched (${strategy}) - buying`);
    void buyContract();
  }, [proposal, isBuying, openPositions, buyContract, addLog]);

  // Manage the running trade: sell at target ticks, book the result when closed.
  useEffect(() => {
    for (const p of openPositions) {
      if (p.contract_type !== 'ACCU') continue;
      if (trackedId.current === null && p.status === 'open') trackedId.current = p.contract_id;
      if (p.contract_id !== trackedId.current) continue;

      const closed = !!p.is_sold || !!p.is_expired || p.status !== 'open';
      if (closed) {
        if (settled.current.has(p.contract_id)) continue;
        settled.current.add(p.contract_id);
        trackedId.current = null;
        const profit = parseFloat(p.profit) || 0;
        setSessionPL((v) => {
          const next = v + profit;
          const { stopProfit, stopLoss } = cfg.current;
          if (runningRef.current) {
            if (stopProfit > 0 && next >= stopProfit) stop('profit target reached');
            else if (stopLoss > 0 && next <= -stopLoss) stop('loss limit reached');
          }
          return next;
        });
        setTrades((t) => t + 1);
        if (profit > 0) setWins((w) => w + 1);
        addLog(`${profit >= 0 ? 'WIN' : 'LOSS'} ${profit.toFixed(2)} after ${p.tick_count} ticks`, profit >= 0 ? 'win' : 'loss');
      } else if (
        p.tick_count >= cfg.current.targetTicks &&
        p.is_valid_to_sell &&
        !sellSent.current.has(p.contract_id)
      ) {
        sellSent.current.add(p.contract_id);
        addLog(`Target ${cfg.current.targetTicks} ticks reached - selling`);
        void sellContract(p.contract_id, p.bid_price);
      }
    }
  }, [openPositions, sellContract, addLog, stop]);

  const start = useCallback(() => {
    setSessionPL(0);
    setTrades(0);
    setWins(0);
    setRunning(true);
    addLog('Bot started');
  }, [addLog]);

  return { running, start, stop: () => stop('manual'), since, hits, gaps, sessionPL, trades, wins, log };
}

// The automatic loop (Basic Design §3 / §7). Diff-driven and work-driven:
// capture → normalize → classify → abstract → consolidate. Re-detects sources
// each run (path-independent, NFR-024) and converges to idle because dedup
// (content_fingerprint / event_identity / claimkey) and the Ouroboros Law stop
// the loop from re-eating its own output (§4.13).
import { capture, getSourceCursor } from '@intake/capture';
import { normalizeOccurrence } from '@intake/normalize';
import { getConnector } from '@intake/registry';
import type { CaptureMethod } from './schema/enums';
import type { MemEvent } from './schema/entities';
import { classifyEvent } from '@claim/classify';
import { abstractEvents } from '@claim/extractor';
import { consolidatePending } from '@claim/consolidation';
import { indexClaim, indexEvent } from '@retrieval/search';
import { RuleBasedProvider, type MemoryProvider } from '@claim/provider';
import type { RealmContext } from './runtime';
import { log } from './log';

export interface LoopStats {
  captured: number;
  events: number;
  quarantined: number;
  /** Genuine per-line JSON parse failures surfaced (not silently dropped, FR-013). */
  parseFailures: number;
  deduped: number;
  classified: number;
  candidates: number;
  merged: number;
  /** Abstraction batches that errored (model/network/timeout) and were skipped —
   *  the run continues; this surfaces incomplete LLM coverage (never a silent drop). */
  abstractFailures: number;
  consolidated: number;
  rejected: number;
}

export interface LoopOptions {
  method?: CaptureMethod;
  provider?: MemoryProvider;
  now?: Date;
}

export async function runLoop(ctx: RealmContext, opts: LoopOptions = {}): Promise<LoopStats> {
  const method: CaptureMethod = opts.method ?? 'backfill';
  const provider = opts.provider ?? new RuleBasedProvider();
  const now = opts.now ?? new Date();
  const stats: LoopStats = {
    captured: 0,
    events: 0,
    quarantined: 0,
    parseFailures: 0,
    deduped: 0,
    classified: 0,
    candidates: 0,
    merged: 0,
    abstractFailures: 0,
    consolidated: 0,
    rejected: 0,
  };

  const newEvents: MemEvent[] = [];

  // ── Input + normalize: walk registered sources per connector instance. ──────
  for (const instance of ctx.config.connectors) {
    const connector = getConnector(instance.connector_id);
    if (!connector) {
      log.warn('loop:no_connector', { connector_id: instance.connector_id });
      continue;
    }
    const registered = new Set(instance.source_stable_ids);
    const detection = await connector.detect();
    for (const detected of detection.sources) {
      if (!registered.has(detected.source_stable_id)) continue; // selected sources only
      const source = ctx.store.findSourceByStableId(ctx.realmId, detected.source_stable_id);
      if (!source) continue;
      const cursor = getSourceCursor(ctx, source.source_id);
      const chunks = connector.read(detected, cursor, method);
      for (const chunk of chunks) {
        const cap = capture(ctx, source, chunk, now); // gate 1: raw stored first
        stats.captured += 1;
        const norm = normalizeOccurrence(ctx, source, cap.occurrence, cap.undiluted, connector, now);
        stats.events += norm.events.length;
        stats.quarantined += norm.quarantined;
        stats.parseFailures += norm.parseFailures;
        stats.deduped += norm.deduped;
        newEvents.push(...norm.events);
      }
    }
  }

  // ── classify (scope + sensitivity) for new events. ──────────────────────────
  for (const event of newEvents) {
    const assignment = classifyEvent(ctx, event, now);
    if (assignment) stats.classified += 1;
  }
  // Re-read classified events so abstract sees updated sensitivity/assignments.
  const classifiedEvents = newEvents
    .map((e) => ctx.store.getEvent(e.event_id))
    .filter((e): e is MemEvent => Boolean(e));

  // ── index events (after Secret Scan; secret/unknown/unclassified skipped). ────
  for (const event of classifiedEvents) indexEvent(ctx, event);

  // ── abstract → candidates. ───────────────────────────────────────────────────
  const abstractResult = await abstractEvents(ctx, provider, classifiedEvents, now);
  stats.candidates += abstractResult.newCandidates.length;
  stats.merged += abstractResult.merged;
  stats.abstractFailures = abstractResult.failed;
  if (stats.abstractFailures > 0) {
    log.warn('loop:abstract_failures', { count: stats.abstractFailures });
  }

  // ── consolidate (fully automatic). ───────────────────────────────────────────
  const outcomes = consolidatePending(ctx, now);
  for (const o of outcomes) {
    if (o.status === 'consolidated') {
      stats.consolidated += 1;
      const claim = ctx.store.getClaim(o.claim_id);
      if (claim) indexClaim(ctx, claim);
    } else if (o.status === 'rejected') stats.rejected += 1;
  }

  if (stats.parseFailures > 0) {
    // Surface genuine malformed lines (raw is preserved in the Undiluted and can
    // be reprocessed; never a silent drop — FR-013).
    log.warn('loop:parse_failures', { count: stats.parseFailures });
  }

  ctx.flush();
  return stats;
}

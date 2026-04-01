import type { IpcMetricEntry, ChannelMetricsSummary, MetricsSummary } from '../../src/types/database';

/**
 * In-memory metrics collector for IPC handler performance.
 * Stores entries for the current app session only (not persisted).
 * Capped at MAX_ENTRIES to prevent unbounded memory growth.
 */

const MAX_ENTRIES = 10_000;
const startTime = Date.now();

let entries: IpcMetricEntry[] = [];

/**
 * Record a single IPC call metric.
 */
export function recordMetric(entry: IpcMetricEntry): void {
  entries.push(entry);
  // Evict oldest entries when cap is reached
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
}

/**
 * Compute a percentile value from a sorted array of numbers.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Get aggregated metrics summary grouped by channel.
 */
export function getMetricsSummary(): MetricsSummary {
  const byChannel = new Map<string, IpcMetricEntry[]>();

  for (const entry of entries) {
    const existing = byChannel.get(entry.channel);
    if (existing) {
      existing.push(entry);
    } else {
      byChannel.set(entry.channel, [entry]);
    }
  }

  const channels: ChannelMetricsSummary[] = [];
  let totalCalls = 0;
  let totalErrors = 0;

  for (const [channel, channelEntries] of byChannel) {
    const durations = channelEntries.map(e => e.durationMs).sort((a, b) => a - b);
    const payloadSum = channelEntries.reduce((sum, e) => sum + e.payloadBytes, 0);
    const errorCount = channelEntries.filter(e => !e.success).length;

    channels.push({
      channel,
      callCount: channelEntries.length,
      errorCount,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      avgPayloadBytes: Math.round(payloadSum / channelEntries.length),
    });

    totalCalls += channelEntries.length;
    totalErrors += errorCount;
  }

  // Sort by call count descending for readability
  channels.sort((a, b) => b.callCount - a.callCount);

  return {
    channels,
    totalCalls,
    totalErrors,
    uptimeMs: Date.now() - startTime,
  };
}

/**
 * Clear all collected metrics (useful for testing or memory reclaim).
 */
export function clearMetrics(): void {
  entries = [];
}

/**
 * Approximate JSON payload size in bytes.
 * Uses a rough heuristic to avoid the cost of full serialization.
 */
export function estimatePayloadSize(data: unknown): number {
  if (data === null || data === undefined) return 0;
  try {
    const json = JSON.stringify(data);
    return json ? json.length : 0;
  } catch {
    return 0;
  }
}

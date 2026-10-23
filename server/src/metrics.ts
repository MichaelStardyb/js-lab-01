import { performance, type EventLoopUtilization } from 'node:perf_hooks';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { RoomManager } from './rooms.js';

export type RejectionReason =
  | 'origin'
  | 'ip_limit'
  | 'rate_limit'
  | 'invalid_payload'
  | 'room_limit'
  | 'room_full'
  | 'join_timeout'
  | 'slow_client'
  | 'shutting_down';

type WindowSample = {
  time: number;
  messagesIn: number;
  messagesOut: number;
  bytesIn: number;
  bytesOut: number;
};

export class ServerMetrics {
  readonly registry: Registry;
  readonly connectedPlayersGauge: Gauge;
  readonly activeRoomsGauge: Gauge;
  readonly messagesInCounter: Counter;
  readonly messagesOutCounter: Counter;
  readonly messagesInRateGauge: Gauge;
  readonly messagesOutRateGauge: Gauge;
  readonly bytesInCounter: Counter;
  readonly bytesOutCounter: Counter;
  readonly bytesInRateGauge: Gauge;
  readonly bytesOutRateGauge: Gauge;
  readonly tickDurationHistogram: Histogram;
  readonly tickDurationP99Gauge: Gauge;
  readonly eventLoopUtilizationGauge: Gauge;
  readonly memoryRssGauge: Gauge;
  readonly rejectionsCounter: Counter<'reason'>;

  #roomManager: RoomManager;
  #lastElu: EventLoopUtilization;
  #totalMessagesIn = 0;
  #totalMessagesOut = 0;
  #totalBytesIn = 0;
  #totalBytesOut = 0;
  #rejections = new Map<RejectionReason, number>();
  #buckets: WindowSample[] = [];

  constructor({ roomManager }: { roomManager: RoomManager }) {
    this.#roomManager = roomManager;
    this.#lastElu = performance.eventLoopUtilization();
    this.registry = new Registry();

    collectDefaultMetrics({
      register: this.registry,
      prefix: 'dogfight_node_',
    });

    this.connectedPlayersGauge = new Gauge({
      name: 'dogfight_connected_players',
      help: 'Current number of players in rooms',
      registers: [this.registry],
    });

    this.activeRoomsGauge = new Gauge({
      name: 'dogfight_active_rooms',
      help: 'Current number of active game rooms',
      registers: [this.registry],
    });

    this.messagesInCounter = new Counter({
      name: 'dogfight_messages_in_total',
      help: 'Total WebSocket messages received from clients',
      registers: [this.registry],
    });

    this.messagesOutCounter = new Counter({
      name: 'dogfight_messages_out_total',
      help: 'Total WebSocket messages sent to clients',
      registers: [this.registry],
    });

    this.messagesInRateGauge = new Gauge({
      name: 'dogfight_messages_in_per_sec',
      help: 'Incoming WebSocket messages per second over the last 1s window',
      registers: [this.registry],
    });

    this.messagesOutRateGauge = new Gauge({
      name: 'dogfight_messages_out_per_sec',
      help: 'Outgoing WebSocket messages per second over the last 1s window',
      registers: [this.registry],
    });

    this.bytesInCounter = new Counter({
      name: 'dogfight_bytes_in_total',
      help: 'Total WebSocket payload bytes received from clients',
      registers: [this.registry],
    });

    this.bytesOutCounter = new Counter({
      name: 'dogfight_bytes_out_total',
      help: 'Total WebSocket payload bytes sent to clients',
      registers: [this.registry],
    });

    this.bytesInRateGauge = new Gauge({
      name: 'dogfight_bytes_in_per_sec',
      help: 'Incoming WebSocket bytes per second over the last 1s window',
      registers: [this.registry],
    });

    this.bytesOutRateGauge = new Gauge({
      name: 'dogfight_bytes_out_per_sec',
      help: 'Outgoing WebSocket bytes per second over the last 1s window',
      registers: [this.registry],
    });

    this.tickDurationHistogram = new Histogram({
      name: 'dogfight_tick_duration_ms',
      help: 'Simulation step duration in milliseconds across active rooms',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 33.3],
      registers: [this.registry],
    });

    this.tickDurationP99Gauge = new Gauge({
      name: 'dogfight_tick_duration_p99_ms',
      help: '99th percentile simulation step duration in milliseconds across active rooms',
      registers: [this.registry],
    });

    this.eventLoopUtilizationGauge = new Gauge({
      name: 'dogfight_event_loop_utilization',
      help: 'Node.js event loop utilization ratio (0.0 to 1.0)',
      registers: [this.registry],
    });

    this.memoryRssGauge = new Gauge({
      name: 'dogfight_memory_rss_bytes',
      help: 'Resident Set Size memory usage in bytes',
      registers: [this.registry],
    });

    this.rejectionsCounter = new Counter({
      name: 'dogfight_ws_rejected_total',
      help: 'Total rejected WebSocket connections or frames by reason',
      labelNames: ['reason'],
      registers: [this.registry],
    });
  }

  recordMessageIn(bytes: number): void {
    this.#totalMessagesIn += 1;
    this.#totalBytesIn += bytes;
    this.messagesInCounter.inc(1);
    this.bytesInCounter.inc(bytes);
    this.#recordWindow({ messagesIn: 1, messagesOut: 0, bytesIn: bytes, bytesOut: 0 });
  }

  recordMessageOut(bytes: number): void {
    this.#totalMessagesOut += 1;
    this.#totalBytesOut += bytes;
    this.messagesOutCounter.inc(1);
    this.bytesOutCounter.inc(bytes);
    this.#recordWindow({ messagesIn: 0, messagesOut: 1, bytesIn: 0, bytesOut: bytes });
  }

  recordTick(durationMs: number): void {
    this.tickDurationHistogram.observe(durationMs);
  }

  recordRejection(reason: RejectionReason): void {
    const current = this.#rejections.get(reason) ?? 0;
    this.#rejections.set(reason, current + 1);
    this.rejectionsCounter.inc({ reason }, 1);
  }

  #recordWindow(delta: Omit<WindowSample, 'time'>): void {
    const now = performance.now();
    const bucketTime = Math.floor(now / 100) * 100;
    const last = this.#buckets.at(-1);
    if (last && last.time === bucketTime) {
      last.messagesIn += delta.messagesIn;
      last.messagesOut += delta.messagesOut;
      last.bytesIn += delta.bytesIn;
      last.bytesOut += delta.bytesOut;
    } else {
      this.#buckets.push({
        time: bucketTime,
        ...delta,
      });
    }
    this.#pruneWindow(now);
  }

  #pruneWindow(now: number): void {
    const cutoff = now - 1000;
    while (this.#buckets.length > 0 && (this.#buckets[0]?.time ?? 0) < cutoff) {
      this.#buckets.shift();
    }
  }

  sampleEventLoopUtilization(): number {
    const current = performance.eventLoopUtilization();
    const delta = performance.eventLoopUtilization(current, this.#lastElu);
    this.#lastElu = current;
    const utilization = Number.isFinite(delta.utilization) ? delta.utilization : current.utilization;
    return Number(utilization.toFixed(4));
  }

  getSnapshot() {
    const now = performance.now();
    this.#pruneWindow(now);

    let messagesInPerSec = 0;
    let messagesOutPerSec = 0;
    let bytesInPerSec = 0;
    let bytesOutPerSec = 0;
    for (const bucket of this.#buckets) {
      messagesInPerSec += bucket.messagesIn;
      messagesOutPerSec += bucket.messagesOut;
      bytesInPerSec += bucket.bytesIn;
      bytesOutPerSec += bucket.bytesOut;
    }

    let totalPlayers = 0;
    let activeSessions = 0;
    let totalTicks = 0;
    let maxTickDuration = 0;
    let maxTickP99 = 0;
    let sumAvgTickDuration = 0;
    let maxJitter = 0;
    let sumAvgJitter = 0;
    const roomBreakdown: Record<string, { players: number; tickAvgMs: number; tickP99Ms: number; tickMaxMs: number }> = {};

    for (const room of this.#roomManager.rooms.values()) {
      totalPlayers += room.players.size;
      const session = room.gameSession;
      if (session) {
        activeSessions += 1;
        const stats = session.getStats();
        totalTicks += stats.ticks;
        maxTickDuration = Math.max(maxTickDuration, stats.durationMs.max);
        maxTickP99 = Math.max(maxTickP99, stats.durationMs.p99);
        sumAvgTickDuration += stats.durationMs.avg;
        maxJitter = Math.max(maxJitter, stats.jitterMs.max);
        sumAvgJitter += stats.jitterMs.avg;
        roomBreakdown[room.id] = {
          players: room.players.size,
          tickAvgMs: stats.durationMs.avg,
          tickP99Ms: stats.durationMs.p99,
          tickMaxMs: stats.durationMs.max,
        };
      }
    }

    const activeRooms = this.#roomManager.rooms.size;
    const elu = this.sampleEventLoopUtilization();
    const memory = process.memoryUsage();
    const avgTickDuration = activeSessions > 0 ? Number((sumAvgTickDuration / activeSessions).toFixed(3)) : 0;
    const avgJitter = activeSessions > 0 ? Number((sumAvgJitter / activeSessions).toFixed(3)) : 0;
    const tickP99Ms = Number(maxTickP99.toFixed(3));

    this.connectedPlayersGauge.set(totalPlayers);
    this.activeRoomsGauge.set(activeRooms);
    this.messagesInRateGauge.set(messagesInPerSec);
    this.messagesOutRateGauge.set(messagesOutPerSec);
    this.bytesInRateGauge.set(bytesInPerSec);
    this.bytesOutRateGauge.set(bytesOutPerSec);
    this.tickDurationP99Gauge.set(tickP99Ms);
    this.eventLoopUtilizationGauge.set(elu);
    this.memoryRssGauge.set(memory.rss);

    const rejections: Record<string, number> = {};
    for (const [reason, count] of this.#rejections.entries()) {
      rejections[reason] = count;
    }

    return {
      players: totalPlayers,
      rooms: activeRooms,
      activeSessions,
      ticks: totalTicks,
      messagesPerSec: {
        in: messagesInPerSec,
        out: messagesOutPerSec,
        totalIn: this.#totalMessagesIn,
        totalOut: this.#totalMessagesOut,
      },
      bytesPerSec: {
        in: bytesInPerSec,
        out: bytesOutPerSec,
        totalIn: this.#totalBytesIn,
        totalOut: this.#totalBytesOut,
      },
      tickDurationMs: {
        avg: avgTickDuration,
        p99: tickP99Ms,
        max: Number(maxTickDuration.toFixed(3)),
      },
      jitterMs: {
        avg: avgJitter,
        max: Number(maxJitter.toFixed(3)),
      },
      roomStats: roomBreakdown,
      eventLoopUtilization: elu,
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
      },
      rejections,
      uptime: process.uptime(),
    };
  }

  async toPrometheusText(): Promise<string> {
    this.getSnapshot();
    return this.registry.metrics();
  }
}

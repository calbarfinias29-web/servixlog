import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';

export type LocalEventType =
  | 'car.created' | 'car.updated' | 'car.status_changed'
  | 'job.created' | 'job.updated' | 'job.status_changed'
  | 'timer.started' | 'timer.resumed' | 'timer.paused' | 'timer.stopped' | 'timer.finalized'
  | 'overtime.started' | 'overtime.stopped'
  | 'employee.updated' | 'appointment.created' | 'appointment.updated' | 'appointment.deleted'
  | 'rates.updated' | 'schedule.updated' | 'device.updated';

export interface LocalEvent {
  eventId: string;
  type: LocalEventType;
  timestamp: string;
  entity: string;
  entityId: string | null;
  version: number;
}

export interface EventSubscription {
  close(): void;
}

export class LocalEventBus {
  private readonly clients = new Set<ServerResponse>();
  private version = 0;

  subscribe(res: ServerResponse): EventSubscription {
    this.clients.add(res);
    return { close: () => this.clients.delete(res) };
  }

  publish(type: LocalEventType, entity: string, entityId: string | null = null): LocalEvent {
    const event: LocalEvent = {
      eventId: randomUUID(), type, entity, entityId, version: ++this.version, timestamp: new Date().toISOString(),
    };
    const frame = `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try { client.write(frame); } catch { this.clients.delete(client); }
    }
    return event;
  }

  remove(res: ServerResponse): void { this.clients.delete(res); }
  size(): number { return this.clients.size; }
  closeAll(): void { for (const client of this.clients) { try { client.end(); } catch { /* disconnected */ } } this.clients.clear(); }
}

export function eventForWrite(method: string, path: string, payload: unknown): { type: LocalEventType; entity: string; entityId: string | null } | null {
  if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') return null;
  const match = /^\/api\/(cars|jobs|employees|appointments)(?:\/([^/]+))?$/.exec(path);
  if (match) {
    const entity = match[1] === 'appointments' ? 'appointment' : match[1].slice(0, -1);
    const id = match[2] ?? ((payload as Record<string, unknown> | null)?.[entity] as Record<string, unknown> | undefined)?.id as string | undefined ?? null;
    const suffix = method === 'POST' ? 'created' : method === 'DELETE' ? 'deleted' : 'updated';
    return { type: `${entity}.${suffix}` as LocalEventType, entity, entityId: id ?? null };
  }
  if (path === '/api/rates') return { type: 'rates.updated', entity: 'rates', entityId: null };
  if (path === '/api/schedule') return { type: 'schedule.updated', entity: 'schedule', entityId: null };
  const timer = /^\/api\/timer\/(start|resume|pause|stop|finalize|overtime\/start|overtime\/stop|takeover|transfer)$/.exec(path);
  if (timer) {
    const action = timer[1].replace('/', '.');
    const map: Record<string, LocalEventType> = { start: 'timer.started', resume: 'timer.resumed', pause: 'timer.paused', stop: 'timer.stopped', finalize: 'timer.finalized', 'overtime.start': 'overtime.started', 'overtime.stop': 'overtime.stopped', takeover: 'timer.resumed', transfer: 'job.updated' };
    return { type: map[action] ?? 'job.updated', entity: 'job', entityId: null };
  }
  return null;
}

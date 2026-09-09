/**
 * SERVIX — LocalDataAdapter (FAZA 4)
 *
 * Implementarea Data Adapter peste Local Server (HTTP) → SQLite.
 *
 * Suportă TOATE citirile READ ale contractului DataAdapter (FAZA 5):
 *   getCars      → GET /api/cars
 *   getEmployees → GET /api/employees
 *   getJobs      → GET /api/jobs
 *   getRates     → GET /api/rates
 *   getSchedule  → GET /api/schedule
 *   getThemes    → GET /api/themes
 *   getAppointments → GET /api/appointments
 *   getVehicleMakes → GET /api/vehicle-makes
 *   getVehicleModels → GET /api/vehicle-models
 *   getWorkCatalog  → GET /api/work-catalog
 *   getCarActivityLog(carId) → GET /api/activity-log?carId=
 *   getTimeEntries({fromIso,toIso,employeeId?}) → GET /api/time-entries
 *
 * Toate endpoint-urile READ (FAZA 5) + WRITE local de bază (FAZA 7A):
 *   createCar/updateCar        → POST/PATCH /api/cars[/:id]
 *   createJob/updateJob        → POST/PATCH /api/jobs[/:id]
 *   createEmployee/updateEmployee → POST/PATCH /api/employees[/:id]
 *   createAppointment/updateAppointment → POST/PATCH /api/appointments[/:id]
 *   updateRates                → PATCH /api/rates
 *   updateSchedule             → PATCH /api/schedule
 *
 * Erorile HTTP/local sunt transformate în forma { data: null, error }, fără a fi
 * ascunse și fără fallback automat la Supabase. Clientul trimite DOAR JSON
 * validat server-side — niciodată SQL. WRITE-ul scrie EXCLUSIV în SQLite.
 *
 * URL-ul Local Server este configurabil (baseUrl), cu default local sigur.
 * Zero dependențe noi: folosește fetch-ul browser-ului/Node.
 */
import type { PostgrestError } from '@supabase/supabase-js';

import type { DataAdapter, QueryResult, CarActivityEntry, EmployeeTimeEntry,
  CarWriteInput, CarUpdateInput, JobWriteInput, JobUpdateInput,
  EmployeeWriteInput, EmployeeUpdateInput, AppointmentWriteInput, AppointmentUpdateInput,
  RatesUpdateInput, ScheduleUpdateInput, TimerOperationInput, TimerStatusInput, TimerPayload, CatalogOption,
  TimerTakeoverInput, TimerTransferInput, EventSubscriptionOptions, LocalEvent } from './DataAdapter.ts';
import type { EmployeeInactivityNotification, InactivityObservationResult } from '../lib/employeeInactivity.ts';
import type { DeviceListResult, DevicePairingResult, DeviceType, ManagedDevice } from './DataAdapter.ts';
import type { Appointment, Car, Employee, Job, Rates, Schedule, Theme } from '../types.ts';

/** URL implicit al Local Server (localhost, nu LAN). */
export const DEFAULT_LOCAL_SERVER_URL = 'http://127.0.0.1:8787';

/** Construiește un error compatibil cu PostgrestError (forma { data, error }). */
function localError(message: string, code = 'LOCAL_HTTP'): PostgrestError {
  return { message, details: '', hint: '', code } as PostgrestError;
}

export class LocalDataAdapter implements DataAdapter {
  private readonly baseUrl: string;

  constructor(baseUrl: string = DEFAULT_LOCAL_SERVER_URL) {
    this.baseUrl = baseUrl;
  }

  /** GET generic + mapare erori (rețea / HTTP / JSON) în QueryResult. */
  private async request(path: string): Promise<{ data: unknown; error: PostgrestError | null }> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}${path}`;
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    } catch (err) {
      return {
        data: null,
        error: localError(
          `Local Server indisponibil la ${this.baseUrl} (${err instanceof Error ? err.message : String(err)}).`,
          'LOCAL_UNAVAILABLE',
        ),
      };
    }
    if (!res.ok) {
      return {
        data: null,
        error: localError(`Local Server error: HTTP ${res.status} la ${path}.`, `LOCAL_HTTP_${res.status}`),
      };
    }
    try {
      const json = (await res.json()) as unknown;
      return { data: json, error: null };
    } catch (err) {
      return {
        data: null,
        error: localError(
          `Răspuns invalid din Local Server (${err instanceof Error ? err.message : String(err)}).`,
          'LOCAL_INVALID_JSON',
        ),
      };
    }
  }

  private async field<T>(path: string, field: string): Promise<QueryResult<T>> {
    const { data, error } = await this.request(path);
    if (error) return { data: null, error };
    const record = data as Record<string, unknown> | null;
    return { data: ((record?.[field] as T | undefined) ?? null) as T | null, error: null };
  }

  async getEmployees(): Promise<QueryResult<Employee[]>> {
    return this.field('/api/employees', 'employees');
  }

  async getCars(): Promise<QueryResult<Car[]>> {
    return this.field('/api/cars', 'cars');
  }

  async getJobs(): Promise<QueryResult<Job[]>> {
    return this.field('/api/jobs', 'jobs');
  }

  async getSchedule(): Promise<QueryResult<Schedule | null>> {
    return this.field('/api/schedule', 'schedule');
  }

  async getRates(): Promise<QueryResult<Rates | null>> {
    return this.field('/api/rates', 'rates');
  }

  async getThemes(): Promise<QueryResult<Theme[]>> {
    return this.field('/api/themes', 'themes');
  }

  async getAppointments(): Promise<QueryResult<Appointment[]>> {
    return this.field('/api/appointments', 'appointments');
  }

  async getVehicleMakes(): Promise<QueryResult<CatalogOption[]>> {
    return this.field('/api/vehicle-makes', 'makes');
  }

  async getVehicleModels(): Promise<QueryResult<CatalogOption[]>> {
    return this.field('/api/vehicle-models', 'models');
  }

  async getWorkCatalog(): Promise<QueryResult<CatalogOption[]>> {
    return this.field('/api/work-catalog', 'catalog');
  }

  async getCarActivityLog(carId: string): Promise<QueryResult<CarActivityEntry[]>> {
    return this.field(`/api/activity-log?carId=${encodeURIComponent(carId)}`, 'entries');
  }

  async getTimeEntries(params: { fromIso: string; toIso: string; employeeId?: string }): Promise<QueryResult<EmployeeTimeEntry[]>> {
    const qs = new URLSearchParams({ fromIso: params.fromIso, toIso: params.toIso });
    if (params.employeeId) qs.set('employeeId', params.employeeId);
    return this.field(`/api/time-entries?${qs.toString()}`, 'entries');
  }

  async observeEmployeeInactivity(employeeIds: string[], observedAt = new Date().toISOString()): Promise<QueryResult<InactivityObservationResult>> {
    const result = await this.send('POST', '/api/inactivity/observe', { employee_ids: employeeIds, observed_at: observedAt });
    return { data: result.data as InactivityObservationResult | null, error: result.error };
  }

  async getEmployeeInactivityNotifications(unreadOnly = true): Promise<QueryResult<EmployeeInactivityNotification[]>> {
    return this.field(`/api/inactivity-notifications?unreadOnly=${unreadOnly ? 'true' : 'false'}`, 'notifications');
  }

  async markEmployeeInactivityNotificationRead(notificationId: string): Promise<QueryResult<EmployeeInactivityNotification>> {
    const result = await this.send('PATCH', `/api/inactivity/notifications/${encodeURIComponent(notificationId)}`, {});
    return this.entity<EmployeeInactivityNotification>(result, 'notification');
  }

  // ============================ FAZA 7A — WRITE LOCAL ============================

  /**
   * POST/PATCH generic spre Local Server. Erorile sunt mapate identic cu
   * request() (LOCAL_UNAVAILABLE / LOCAL_HTTP_<status>), fără fallback la
   * Supabase. Body-ul este JSON validat server-side — niciodată SQL.
   */
  private async send(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
  ): Promise<{ data: Record<string, unknown> | null; error: PostgrestError | null }> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
    } catch (err) {
      return {
        data: null,
        error: localError(
          `Local Server indisponibil la ${this.baseUrl} (${err instanceof Error ? err.message : String(err)}).`,
          'LOCAL_UNAVAILABLE',
        ),
      };
    }
    if (!res.ok) {
      let message = `Local Server error: HTTP ${res.status} la ${path}.`;
      try {
        const detail = (await res.json()) as { error?: string; issues?: Array<{ field: string; message: string }> };
        if (detail?.error) message += ` (${detail.error}${detail.issues ? `: ${detail.issues.map((i) => i.field).join(', ')}` : ''})`;
      } catch { /* corp non-JSON — păstrăm mesajul de bază */ }
      return { data: null, error: localError(message, `LOCAL_HTTP_${res.status}`) };
    }
    try {
      const json = (await res.json()) as Record<string, unknown>;
      return { data: json, error: null };
    } catch (err) {
      return {
        data: null,
        error: localError(
          `Răspuns invalid din Local Server (${err instanceof Error ? err.message : String(err)}).`,
          'LOCAL_INVALID_JSON',
        ),
      };
    }
  }

  /** Extrage entitatea din payload-ul { ok, <singular> }. */
  private entity<T>(result: { data: Record<string, unknown> | null; error: PostgrestError | null }, key: string): QueryResult<T> {
    if (result.error) return { data: null, error: result.error };
    return { data: ((result.data?.[key] as T | undefined) ?? null) as T | null, error: null };
  }

  private timerResult(result: { data: Record<string, unknown> | null; error: PostgrestError | null }): QueryResult<TimerPayload> {
    if (result.error) return { data: null, error: result.error };
    return { data: result.data as TimerPayload | null, error: null };
  }

  async createCar(input: CarWriteInput): Promise<QueryResult<Car>> {
    return this.entity<Car>(await this.send('POST', '/api/cars', input), 'car');
  }

  async updateCar(id: string, input: CarUpdateInput): Promise<QueryResult<Car>> {
    return this.entity<Car>(await this.send('PATCH', `/api/cars/${encodeURIComponent(id)}`, input), 'car');
  }

  async createJob(input: JobWriteInput): Promise<QueryResult<Job>> {
    return this.entity<Job>(await this.send('POST', '/api/jobs', input), 'job');
  }

  async updateJob(id: string, input: JobUpdateInput): Promise<QueryResult<Job>> {
    return this.entity<Job>(await this.send('PATCH', `/api/jobs/${encodeURIComponent(id)}`, input), 'job');
  }

  async upsertWorkCatalog(name: string): Promise<QueryResult<CatalogOption>> {
    return this.entity<CatalogOption>(await this.send('POST', '/api/work-catalog', { name }), 'catalog');
  }

  async addMileageLog(input: { car_id: string; mileage: number }): Promise<QueryResult<{ id: string; car_id: string; mileage: number }>> {
    return this.entity<{ id: string; car_id: string; mileage: number }>(await this.send('POST', '/api/mileage-log', input), 'entry');
  }

  async createEmployee(input: EmployeeWriteInput): Promise<QueryResult<Employee>> {
    return this.entity<Employee>(await this.send('POST', '/api/employees', input), 'employee');
  }

  async updateEmployee(id: string, input: EmployeeUpdateInput): Promise<QueryResult<Employee>> {
    return this.entity<Employee>(await this.send('PATCH', `/api/employees/${encodeURIComponent(id)}`, input), 'employee');
  }

  async createAppointment(input: AppointmentWriteInput): Promise<QueryResult<Appointment>> {
    return this.entity<Appointment>(await this.send('POST', '/api/appointments', input), 'appointment');
  }

  async updateAppointment(id: string, input: AppointmentUpdateInput): Promise<QueryResult<Appointment>> {
    return this.entity<Appointment>(await this.send('PATCH', `/api/appointments/${encodeURIComponent(id)}`, input), 'appointment');
  }

  async deleteAppointment(id: string): Promise<QueryResult<Appointment>> {
    return this.entity<Appointment>(await this.send('DELETE', `/api/appointments/${encodeURIComponent(id)}`, {}), 'appointment');
  }

  async updateRates(input: RatesUpdateInput): Promise<QueryResult<Rates>> {
    return this.entity<Rates>(await this.send('PATCH', '/api/rates', input), 'rates');
  }

  async updateSchedule(input: ScheduleUpdateInput): Promise<QueryResult<Schedule>> {
    return this.entity<Schedule>(await this.send('PATCH', '/api/schedule', input), 'schedule');
  }

  async startJobTimer(input: TimerOperationInput): Promise<QueryResult<TimerPayload>> {
    return this.timerResult(await this.send('POST', '/api/timer/start', input));
  }

  async updateJobTimerStatus(input: TimerStatusInput): Promise<QueryResult<TimerPayload>> {
    return this.timerResult(await this.send('POST', '/api/timer/status', input));
  }

  async startOvertimeTimer(input: TimerOperationInput): Promise<QueryResult<TimerPayload>> {
    return this.timerResult(await this.send('POST', '/api/timer/overtime/start', input));
  }

  async stopOvertimeTimer(input: TimerOperationInput): Promise<QueryResult<TimerPayload>> {
    return this.timerResult(await this.send('POST', '/api/timer/overtime/stop', input));
  }

  async takeoverJob(input: TimerTakeoverInput): Promise<QueryResult<TimerPayload>> {
    return this.timerResult(await this.send('POST', '/api/timer/takeover', input));
  }

  async transferJob(input: TimerTransferInput): Promise<QueryResult<TimerPayload>> {
    return this.timerResult(await this.send('POST', '/api/timer/transfer', input));
  }

  async getTimerState(jobId: string): Promise<QueryResult<TimerPayload>> {
    const result = await this.request(`/api/timer/${encodeURIComponent(jobId)}`);
    return this.timerResult({ data: result.data as Record<string, unknown> | null, error: result.error });
  }

  async getDevices(): Promise<QueryResult<DeviceListResult>> {
    return this.field('/api/devices', 'devices').then((result) => ({ data: result.data ? { devices: result.data as ManagedDevice[] } : null, error: result.error }));
  }

  async createDevicePairing(input: { deviceType: DeviceType; deviceName: string }): Promise<QueryResult<DevicePairingResult>> {
    return this.send('POST', '/api/devices/pair', input).then((result) => ({ data: result.data as DevicePairingResult | null, error: result.error }));
  }

  async revokeDevice(deviceId: string): Promise<QueryResult<{ device: ManagedDevice }>> {
    return this.send('POST', '/api/devices/revoke', { deviceId }).then((result) => ({ data: result.data as { device: ManagedDevice } | null, error: result.error }));
  }

  async reactivateDevice(deviceId: string): Promise<QueryResult<DevicePairingResult>> {
    return this.send('POST', '/api/devices/reactivate', { deviceId }).then((result) => ({ data: result.data as DevicePairingResult | null, error: result.error }));
  }

  subscribeToEvents(onEvent: (event: LocalEvent) => void, options: EventSubscriptionOptions = {}): () => void {
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let retryDelay = 1000;
    const connect = async (): Promise<void> => {
      if (stopped) return;
      options.onStatus?.('connecting');
      controller = new AbortController();
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (options.deviceId) headers['x-servix-device-id'] = options.deviceId;
      if (options.credential) headers['x-servix-device-credential'] = options.credential;
      try {
        const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/events`, { headers, signal: controller.signal });
        if (response.status === 401 || response.status === 403) { options.onStatus?.('revoked'); return; }
        if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
        options.onStatus?.('online'); retryDelay = 1000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const frames = buffer.split('\n\n'); buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
            if (data) { try { onEvent(JSON.parse(data) as LocalEvent); } catch { /* ignore malformed frame */ } }
          }
        }
        if (!stopped) throw new Error('SSE disconnected');
      } catch (error) {
        if (!stopped && (error as Error).name !== 'AbortError') {
          options.onStatus?.('offline');
          retryTimer = setTimeout(() => void connect(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      }
    };
    void connect();
    return () => { stopped = true; if (retryTimer) clearTimeout(retryTimer); controller?.abort(); options.onStatus?.('offline'); };
  }
}
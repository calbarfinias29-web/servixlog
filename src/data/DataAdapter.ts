/**
 * SERVIX — Data Adapter (FAZA 2A)
 *
 * Contract abstract între UI și sursa de date.
 *
 * Acum:  doar Supabase (SupabaseDataAdapter).
 * Viitor: Supabase | Local Server (SQLite) — aceleași metode,
 *        doar implementarea diferă. UI-ul nu cunoaște sursa reală.
 *
 * Reguli FAZA 2A (Safe Mode):
 *  - doar operații READ sigure sunt migrate prin adapter;
 *  - operațiile de TIMER / RPC sensibile rămân direct pe supabase;
 *  - formatul de retur rămâne exact ca supabase-js ({ data, error }),
 *    astfel încât apelanții să nu fie modificați.
 */
import type { PostgrestError } from '@supabase/supabase-js';

import type { Appointment, Car, Employee, Job, Rates, Schedule, Theme } from '../types.ts';
import type { PairingConfiguration } from '../devicePairing.ts';

export interface CatalogOption {
  id: string;
  name: string;
  normalized_name: string;
  make_id?: string;
}

/** Format de retur identic cu PostgrestResponse din @supabase/supabase-js. */
export interface QueryResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/** O intrare de activitate din Car History (activity_log pentru o mașină). */
export interface CarActivityEntry {
  id: string;
  action: string;
  detail: string | null;
  created_at: string;
}

/**
 * O intrare de timp din rapoartele angajatului (time_entries + car_id
 * din relația jobs). Forma identică cu cea folosită de EmployeeReportsTab.
 */
export interface EmployeeTimeEntry {
  employee_id: string;
  job_id: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  is_overtime: boolean;
  jobs: { car_id: string } | null;
}

/**
 * FAZA 7A — WRITE LOCAL DE BAZĂ (opțional în contract).
 *
 * Metodele WRITE sunt OPTIONAL-E în DataAdapter: SupabaseDataAdapter nu le
 * implementează (varianta Web rămâne neafectată), LocalDataAdapter le
 * implementează toate. UI-ul poate verifica `if (adapter.createCar)` înainte
 * de utilizare.
 *
 * Clientul NU trimite niciodată SQL — doar obiecte JSON validate server-side.
 */
export interface CarWriteInput {
  license_plate: string;
  client_name: string;
  client_phone?: string | null;
  client_email?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  vin?: string | null;
  mileage?: number | null;
  fuel_level?: string | null;
  status?: string;
  priority?: string;
  deadline?: string | null;
  is_warranty?: boolean;
  notes?: string | null;
  assigned_employee_id?: string | null;
}

export type CarUpdateInput = Partial<Omit<CarWriteInput, 'license_plate' | 'client_name'>> & {
  license_plate?: string;
  client_name?: string;
};

export interface JobWriteInput {
  car_id: string;
  title: string;
  description?: string | null;
  status?: string;
  order_index?: number;
}

export type JobUpdateInput = Partial<JobWriteInput>;

export interface EmployeeWriteInput {
  name: string;
  role?: string;
  active?: boolean;
  username?: string | null;
}

export type EmployeeUpdateInput = Partial<EmployeeWriteInput>;

export interface AppointmentWriteInput {
  license_plate: string;
  client_name?: string | null;
  make?: string | null;
  model?: string | null;
  appointment_date: string;
  appointment_time: string;
  status?: string;
  notes?: string | null;
  car_id?: string | null;
  employee_id?: string | null;
}

export type AppointmentUpdateInput = Partial<AppointmentWriteInput>;

export interface RatesUpdateInput {
  normal_rate?: number;
  urgent_rate?: number;
  warranty_rate?: number;
  overtime_rate?: number;
  vat_rate?: number;
}

type ScheduleDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
type ScheduleDayUpdate = `${ScheduleDay}_active` | `${ScheduleDay}_start` | `${ScheduleDay}_end`;

export interface ScheduleUpdateInput extends Partial<Record<ScheduleDayUpdate, boolean | string>> {
  work_start?: string;
  work_end?: string;
  break_start?: string;
  break_end?: string;
}

export interface TimerOperationInput {
  job_id: string;
  employee_id: string;
}

export interface TimerTakeoverInput extends TimerOperationInput {}

export interface TimerTransferInput {
  car_id: string;
  new_employee_id: string;
  admin_id: string;
}

export interface TimerStatusInput extends TimerOperationInput {
  status: 'asteptare' | 'asteptare_piese' | 'finalizat';
  pause_reason?: 'manual' | 'auto_break' | 'parts' | 'completed';
}

export interface TimerPayload {
  ok: boolean;
  no_op?: boolean;
  job?: Job | null;
  session?: Record<string, unknown> | null;
  interval?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export type DeviceType = 'MAIN_PC' | 'PC_COMPANION' | 'TABLET' | 'PHONE';
export type DeviceStatus = 'pending' | 'paired' | 'revoked';

export interface ManagedDevice {
  deviceId: string;
  deviceType: DeviceType;
  deviceName: string;
  status: DeviceStatus;
  apiVersion: string;
  createdAt: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface DevicePairingResult {
  device: ManagedDevice;
  credential: string;
  pairing: PairingConfiguration;
}

export interface LocalEvent {
  eventId: string;
  type: string;
  timestamp: string;
  entity: string;
  entityId: string | null;
  version: number;
}

export interface EventSubscriptionOptions {
  deviceId?: string;
  credential?: string;
  onStatus?: (status: 'connecting' | 'online' | 'offline' | 'revoked') => void;
}

export interface DeviceListResult {
  devices: ManagedDevice[];
}

export interface DataAdapterWrites {
  createCar?(input: CarWriteInput): Promise<QueryResult<Car>>;
  updateCar?(id: string, input: CarUpdateInput): Promise<QueryResult<Car>>;
  createJob?(input: JobWriteInput): Promise<QueryResult<Job>>;
  updateJob?(id: string, input: JobUpdateInput): Promise<QueryResult<Job>>;
  createEmployee?(input: EmployeeWriteInput): Promise<QueryResult<Employee>>;
  updateEmployee?(id: string, input: EmployeeUpdateInput): Promise<QueryResult<Employee>>;
  createAppointment?(input: AppointmentWriteInput): Promise<QueryResult<Appointment>>;
  updateAppointment?(id: string, input: AppointmentUpdateInput): Promise<QueryResult<Appointment>>;
  deleteAppointment?(id: string): Promise<QueryResult<Appointment>>;
  updateRates?(input: RatesUpdateInput): Promise<QueryResult<Rates>>;
  updateSchedule?(input: ScheduleUpdateInput): Promise<QueryResult<Schedule>>;
  startJobTimer?(input: TimerOperationInput): Promise<QueryResult<TimerPayload>>;
  updateJobTimerStatus?(input: TimerStatusInput): Promise<QueryResult<TimerPayload>>;
  startOvertimeTimer?(input: TimerOperationInput): Promise<QueryResult<TimerPayload>>;
  stopOvertimeTimer?(input: TimerOperationInput): Promise<QueryResult<TimerPayload>>;
  takeoverJob?(input: TimerTakeoverInput): Promise<QueryResult<TimerPayload>>;
  transferJob?(input: TimerTransferInput): Promise<QueryResult<TimerPayload>>;
  getTimerState?(jobId: string): Promise<QueryResult<TimerPayload>>;
  getDevices?(): Promise<QueryResult<DeviceListResult>>;
  createDevicePairing?(input: { deviceType: DeviceType; deviceName: string }): Promise<QueryResult<DevicePairingResult>>;
  revokeDevice?(deviceId: string): Promise<QueryResult<{ device: ManagedDevice }>>;
  reactivateDevice?(deviceId: string): Promise<QueryResult<DevicePairingResult>>;
  subscribeToEvents?(onEvent: (event: LocalEvent) => void, options?: EventSubscriptionOptions): () => void;
}

export interface DataAdapter extends DataAdapterWrites {
  /** Angajații activi (toate câmpurile), ordonați pe nume. */
  getEmployees(): Promise<QueryResult<Employee[]>>;
  /**
   * Mașini (toate câmpurile + relațiile jobs/plate_history/mileage_log/car_photos),
   * ordonate descrescător pe created_at.
   * NOTE: jobs vin incluse aici — getJobs() există pentru viitor în mod standalone.
   */
  getCars(): Promise<QueryResult<Car[]>>;
  /** Lucrări (tabel jobs), ordonate pe order_index. */
  getJobs(): Promise<QueryResult<Job[]>>;
  /** Programul de lucru activ (work_schedule cu active=true). Poate fi null. */
  getSchedule(): Promise<QueryResult<Schedule | null>>;
  /** Tarifele active (rates cu active=true). Poate fi null. */
  getRates(): Promise<QueryResult<Rates | null>>;
  /** Temele disponibile (themes), ordonate pe nume. */
  getThemes(): Promise<QueryResult<Theme[]>>;
  /** Programări (appointments), ordonate pe dată + oră. */
  getAppointments(): Promise<QueryResult<Appointment[]>>;
  /** Cataloage pentru formulare — mărci. */
  getVehicleMakes(): Promise<QueryResult<CatalogOption[]>>;
  /** Cataloage pentru formulare — modele. */
  getVehicleModels(): Promise<QueryResult<CatalogOption[]>>;
  /** Cataloage pentru formulare — lucrări. */
  getWorkCatalog(): Promise<QueryResult<CatalogOption[]>>;
  /** Istoricul de activitate al unei mașini (activity_log), ordonat cronologic. */
  getCarActivityLog(carId: string): Promise<QueryResult<CarActivityEntry[]>>;
  /**
   * Intrări de timp din EmployeeReportsTab (time_entries + jobs!inner(car_id)).
   * Filtrează pe start_time în [fromIso, toIso] (inclusiv); opțional pe employeeId.
   */
  getTimeEntries(params: { fromIso: string; toIso: string; employeeId?: string }): Promise<QueryResult<EmployeeTimeEntry[]>>;
}
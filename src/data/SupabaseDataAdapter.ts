/**
 * SERVIX — SupabaseDataAdapter (FAZA 2A)
 *
 * Implementarea Data Adapter peste sursa Supabase existentă.
 * Query-urile aici sunt IDENTICE cu cele folosite anterior în App.tsx
 * (loadData) — doar relocată într-un strat recuperabil.
 *
 * NU modifică schema / RLS / RPC / migrations Supabase.
 */
import { supabase } from '@/lib/supabase';

import type { DataAdapter, QueryResult, CarActivityEntry, EmployeeTimeEntry, CarUpdateInput } from './DataAdapter';
import type { Appointment, Car, Employee, Job, Rates, Schedule, Theme } from '@/types';
import type { CatalogOption } from '@/components/CatalogAutocomplete';
import type { EmployeeInactivityNotification, InactivityObservationResult } from '@/lib/employeeInactivity';

export class SupabaseDataAdapter implements DataAdapter {
  async getEmployees(): Promise<QueryResult<Employee[]>> {
    const { data, error } = await supabase.from('employees').select('*').order('name');
    return { data: data as Employee[] | null, error };
  }

  async getCars(): Promise<QueryResult<Car[]>> {
    const { data, error } = await supabase
      .from('cars')
      .select('*, jobs(*), plate_history(*), mileage_log(*), car_photos(*)')
      .order('created_at', { ascending: false });
    return { data: data as Car[] | null, error };
  }

  async getJobs(): Promise<QueryResult<Job[]>> {
    const { data, error } = await supabase.from('jobs').select('*').order('order_index');
    return { data: data as Job[] | null, error };
  }

  async getSchedule(): Promise<QueryResult<Schedule | null>> {
    const { data, error } = await supabase
      .from('work_schedule')
      .select('*')
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    return { data: data as Schedule | null, error };
  }

  async getRates(): Promise<QueryResult<Rates | null>> {
    const { data, error } = await supabase
      .from('rates')
      .select('*')
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    return { data: data as Rates | null, error };
  }

  async getThemes(): Promise<QueryResult<Theme[]>> {
    const { data, error } = await supabase.from('themes').select('*').order('name');
    return { data: data as Theme[] | null, error };
  }

  async getAppointments(): Promise<QueryResult<Appointment[]>> {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true });
    return { data: data as Appointment[] | null, error };
  }

  async getVehicleMakes(): Promise<QueryResult<CatalogOption[]>> {
    const { data, error } = await supabase
      .from('vehicle_makes')
      .select('id, name, normalized_name')
      .order('name');
    return { data: data as CatalogOption[] | null, error };
  }

  async getVehicleModels(): Promise<QueryResult<CatalogOption[]>> {
    const { data, error } = await supabase
      .from('vehicle_models')
      .select('id, make_id, name, normalized_name')
      .order('name');
    return { data: data as CatalogOption[] | null, error };
  }

  async getWorkCatalog(): Promise<QueryResult<CatalogOption[]>> {
    const { data, error } = await supabase
      .from('work_catalog')
      .select('id, name, normalized_name')
      .order('name');
    return { data: data as CatalogOption[] | null, error };
  }

  async getCarActivityLog(carId: string): Promise<QueryResult<CarActivityEntry[]>> {
    const { data, error } = await supabase
      .from('activity_log')
      .select('id, action, detail, created_at, employee_id, job_id')
      .eq('car_id', carId)
      .order('created_at', { ascending: true });
    return { data: data as CarActivityEntry[] | null, error };
  }

  async getTimeEntries(params: { fromIso: string; toIso: string; employeeId?: string }): Promise<QueryResult<EmployeeTimeEntry[]>> {
    let query = supabase
      .from('time_entries')
      .select('employee_id, job_id, start_time, end_time, duration_seconds, is_overtime, jobs!inner(car_id)')
      .gte('start_time', params.fromIso)
      .lte('start_time', params.toIso);
    if (params.employeeId) query = query.eq('employee_id', params.employeeId);
    const { data, error } = await query;
    return { data: data as EmployeeTimeEntry[] | null, error };
  }

  async observeEmployeeInactivity(): Promise<QueryResult<InactivityObservationResult>> {
    const { data: created, error: observeError } = await supabase.rpc('observe_employee_inactivity');
    if (observeError) return { data: null, error: observeError };
    const unread = await this.getEmployeeInactivityNotifications(true);
    if (unread.error) return { data: null, error: unread.error };
    return { data: { created: (created ?? []) as EmployeeInactivityNotification[], unread: unread.data ?? [] }, error: null };
  }

  async getEmployeeInactivityNotifications(unreadOnly = true): Promise<QueryResult<EmployeeInactivityNotification[]>> {
    let query = supabase
      .from('employee_inactivity_notifications')
      .select('id, employee_id, period_id, threshold_minutes, created_at, read_at')
      .order('created_at', { ascending: false });
    if (unreadOnly) query = query.is('read_at', null);
    const { data, error } = await query;
    return { data: data as EmployeeInactivityNotification[] | null, error };
  }

  async markEmployeeInactivityNotificationRead(notificationId: string): Promise<QueryResult<EmployeeInactivityNotification>> {
    const { data, error } = await supabase
      .from('employee_inactivity_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .select('id, employee_id, period_id, threshold_minutes, created_at, read_at')
      .maybeSingle();
    return { data: data as EmployeeInactivityNotification | null, error };
  }

  /**
   * FAZA 7A — WRITE prin aceeași abstracție ca Local/SQLite.
   * UPDATE pe mașina existentă (aceeași id), NU inserare. NU atinge istoricul
   * (jobs / time_entries / plate_history / mileage_log) — doar câmpurile mașinii.
   */
  async updateCar(id: string, input: CarUpdateInput): Promise<QueryResult<Car>> {
    const { data, error } = await supabase
      .from('cars')
      .update(input)
      .eq('id', id)
      .select('*, jobs(*), plate_history(*), mileage_log(*), car_photos(*)')
      .maybeSingle();
    return { data: data as Car | null, error };
  }
}
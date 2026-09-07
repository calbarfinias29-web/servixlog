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

import type { DataAdapter, QueryResult, CarActivityEntry, EmployeeTimeEntry } from './DataAdapter';
import type { Appointment, Car, Employee, Job, Rates, Schedule, Theme } from '@/types';
import type { CatalogOption } from '@/components/CatalogAutocomplete';

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
      .select('id, action, detail, created_at')
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
}
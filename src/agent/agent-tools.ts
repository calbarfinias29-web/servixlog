/**
 * Agent SERVIX — Tool Layer FAZA 1 (READ-ONLY)
 */

import { supabase } from '@/lib/supabase';
import { dataAdapter, registry } from '@/data';
import { SecurityLevel } from './agent-types';
import type { AgentTool, AgentToolResult } from './agent-types';
import type { Car, Job, Employee, Appointment } from '@/types';
import { calculateCostSummary } from '@/lib/costs';

function ok(data: unknown): AgentToolResult { return { success: true, data }; }
function fail(error: string): AgentToolResult { return { success: false, data: null, error }; }

async function get_dashboard(): Promise<AgentToolResult> {
  try {
    const [cR, jR, eR, aR] = await Promise.all([
      supabase.from('cars').select('id, status').eq('is_demo', false),
      supabase.from('jobs').select('id, status').eq('is_demo', false),
      supabase.from('employees').select('id, active').eq('is_demo', false),
      supabase.from('appointments').select('id, status').eq('is_demo', false),
    ]);
    if (cR.error) return fail(cR.error.message); if (jR.error) return fail(jR.error.message);
    if (eR.error) return fail(eR.error.message); if (aR.error) return fail(aR.error.message);
    const cars = (cR.data ?? []) as Car[]; const jobs = (jR.data ?? []) as Job[];
    const emps = (eR.data ?? []) as Employee[]; const appts = (aR.data ?? []) as Appointment[];
    return ok({ cars: { total: cars.length, in_lucru: cars.filter(c => c.status === 'in_lucru').length, finalizata: cars.filter(c => c.status === 'finalizata').length }, jobs: { total: jobs.length, in_lucru: jobs.filter(j => j.status === 'in_lucru').length, finalizat: jobs.filter(j => j.status === 'finalizat').length }, employees: { total: emps.length, active: emps.filter(e => e.active).length }, appointments: { total: appts.length, programata: appts.filter(a => a.status === 'programata').length } });
  } catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_cars(params: Record<string, unknown>): Promise<AgentToolResult> {
  if (registry.kind === 'local') {
    const { data, error } = await dataAdapter.getCars();
    if (error) return fail(error.message);
    const status = params.status as string | undefined;
    return ok((data ?? []).filter((car) => !car.is_demo && (!status || car.status === status)));
  }
  try { const st = params.status as string | undefined; let q = supabase.from('cars').select('*').eq('is_demo', false).order('created_at', { ascending: false }); if (st) q = q.eq('status', st); const { data, error } = await q; if (error) return fail(error.message); return ok(data ?? []); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_car(params: Record<string, unknown>): Promise<AgentToolResult> {
  try { const id = params.car_id as string; if (!id) return fail('car_id obligatoriu'); const { data, error } = await supabase.from('cars').select('*, jobs(*)').eq('id', id).single(); if (error) return fail(error.message); return ok(data); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_employees(): Promise<AgentToolResult> {
  if (registry.kind === 'local') {
    const { data, error } = await dataAdapter.getEmployees();
    return error ? fail(error.message) : ok((data ?? []).filter((employee) => !employee.is_demo));
  }
  try { const { data, error } = await supabase.from('employees').select('*').eq('is_demo', false).order('name'); if (error) return fail(error.message); return ok(data ?? []); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_employee(params: Record<string, unknown>): Promise<AgentToolResult> {
  try { const id = params.employee_id as string; if (!id) return fail('employee_id obligatoriu'); const { data, error } = await supabase.from('employees').select('*').eq('id', id).single(); if (error) return fail(error.message); return ok(data); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_jobs(params: Record<string, unknown>): Promise<AgentToolResult> {
  if (registry.kind === 'local') {
    const { data, error } = await dataAdapter.getJobs();
    if (error) return fail(error.message);
    const status = params.status as string | undefined;
    return ok((data ?? []).filter((job) => !job.is_demo && (!status || job.status === status)));
  }
  try { const st = params.status as string | undefined; let q = supabase.from('jobs').select('*').eq('is_demo', false).order('order_index'); if (st) q = q.eq('status', st); const { data, error } = await q; if (error) return fail(error.message); return ok(data ?? []); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_job(params: Record<string, unknown>): Promise<AgentToolResult> {
  try { const id = params.job_id as string; if (!id) return fail('job_id obligatoriu'); const { data, error } = await supabase.from('jobs').select('*').eq('id', id).single(); if (error) return fail(error.message); return ok(data); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_appointments(params: Record<string, unknown>): Promise<AgentToolResult> {
  try { const st = params.status as string | undefined; let q = supabase.from('appointments').select('*').eq('is_demo', false).order('appointment_date'); if (st) q = q.eq('status', st); const { data, error } = await q; if (error) return fail(error.message); return ok(data ?? []); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_rates(): Promise<AgentToolResult> {
  if (registry.kind === 'local') {
    const { data, error } = await dataAdapter.getRates();
    return error ? fail(error.message) : ok(data);
  }
  try { const { data, error } = await supabase.from('rates').select('*').order('id').limit(1); if (error) return fail(error.message); return ok(data?.[0] ?? null); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_schedule(): Promise<AgentToolResult> {
  if (registry.kind === 'local') {
    const { data, error } = await dataAdapter.getSchedule();
    return error ? fail(error.message) : ok(data);
  }
  try { const { data, error } = await supabase.from('work_schedule').select('*').eq('active', true).order('id').limit(1); if (error) return fail(error.message); return ok(data?.[0] ?? null); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_time_entries(params: Record<string, unknown>): Promise<AgentToolResult> {
  try { const eid = params.employee_id as string | undefined; let q = supabase.from('time_entries').select('*').order('start_time', { ascending: false }).limit(100); if (eid) q = q.eq('employee_id', eid); const { data, error } = await q; if (error) return fail(error.message); return ok(data ?? []); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function get_activity_log(params: Record<string, unknown>): Promise<AgentToolResult> {
  try { const lim = (params.limit as number) || 50; const { data, error } = await supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(lim); if (error) return fail(error.message); return ok(data ?? []); }
  catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function analyze_productivity(): Promise<AgentToolResult> {
  try {
    const [{ data: emps, error: e1 }, { data: tes, error: e2 }] = await Promise.all([
      supabase.from('employees').select('*').eq('is_demo', false).eq('active', true),
      supabase.from('time_entries').select('*'),
    ]);
    if (e1) return fail(e1.message); if (e2) return fail(e2.message);
    const employees = (emps ?? []) as Employee[];
    const entries = (tes ?? []) as Array<{ employee_id: string; duration_seconds: number | null; is_overtime: boolean }>;
    const result = employees.map(emp => {
      const ee = entries.filter(e => e.employee_id === emp.id);
      const norm = ee.filter(e => !e.is_overtime).reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
      const ot = ee.filter(e => e.is_overtime).reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
      return { id: emp.id, name: emp.name, normal_hours: Math.round((norm / 3600) * 100) / 100, overtime_hours: Math.round((ot / 3600) * 100) / 100, total_hours: Math.round(((norm + ot) / 3600) * 100) / 100 };
    });
    result.sort((a, b) => b.total_hours - a.total_hours);
    return ok(result);
  } catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function analyze_overtime(): Promise<AgentToolResult> {
  try {
    const { data, error } = await supabase.from('jobs').select('*').eq('is_demo', false);
    if (error) return fail(error.message);
    const jobs = (data ?? []) as Job[];
    return ok({ total_jobs: jobs.length, jobs_with_overtime: jobs.filter(j => j.overtime_seconds > 0).length, total_normal_hours: Math.round((jobs.reduce((s, j) => s + j.worked_seconds, 0) / 3600) * 100) / 100, total_overtime_hours: Math.round((jobs.reduce((s, j) => s + j.overtime_seconds, 0) / 3600) * 100) / 100 });
  } catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function analyze_costs(): Promise<AgentToolResult> {
  try {
    const [{ data: jobs, error: e1 }, { data: rates, error: e2 }] = await Promise.all([
      supabase.from('jobs').select('*').eq('is_demo', false).eq('status', 'finalizat'),
      supabase.from('rates').select('*').order('id').limit(1),
    ]);
    if (e1) return fail(e1.message); if (e2) return fail(e2.message);
    const jList = (jobs ?? []) as Job[];
    const rate = (rates?.[0] ?? null) as { normal_rate: number; overtime_rate: number; vat_rate: number } | null;
    const nR = rate?.normal_rate ?? 100; const oR = rate?.overtime_rate ?? 150; const vR = rate?.vat_rate ?? 21;
    let nC = 0, oC = 0;
    const details = jList.map(j => { const nc = (j.worked_seconds / 3600) * nR; const oc = (j.overtime_seconds / 3600) * oR; nC += nc; oC += oc; return { id: j.id, title: j.title, normal_cost: Math.round(nc * 100) / 100, overtime_cost: Math.round(oc * 100) / 100 }; });
    const summary = calculateCostSummary(nC + oC, vR);
    return ok({ rates: { normal_rate: nR, overtime_rate: oR, vat_rate: vR }, jobs: details, summary: { subtotal: summary.subtotal, vat_amount: summary.vatAmount, total_with_vat: summary.totalWithVat } });
  } catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

async function detect_anomalies(): Promise<AgentToolResult> {
  try {
    const { data, error } = await supabase.from('jobs').select('*').eq('is_demo', false);
    if (error) return fail(error.message);
    const jobs = (data ?? []) as Job[];
    const anomalies: Array<{ type: string; job_id: string; title: string; value: number }> = [];
    for (const j of jobs) {
      if (j.worked_seconds < 0) anomalies.push({ type: 'negative_worked_seconds', job_id: j.id, title: j.title, value: j.worked_seconds });
      if (j.overtime_seconds < 0) anomalies.push({ type: 'negative_overtime_seconds', job_id: j.id, title: j.title, value: j.overtime_seconds });
    }
    return ok({ total: anomalies.length, anomalies });
  } catch (err) { return fail(err instanceof Error ? err.message : 'Eroare'); }
}

export const AGENT_TOOLS: AgentTool[] = [
  { name: 'get_dashboard', description: 'Rezumat dashboard', securityLevel: SecurityLevel.READ, execute: get_dashboard },
  { name: 'get_cars', description: 'Lista masini', securityLevel: SecurityLevel.READ, execute: (p) => get_cars(p) },
  { name: 'get_car', description: 'Detalii masina', securityLevel: SecurityLevel.READ, execute: (p) => get_car(p) },
  { name: 'get_employees', description: 'Lista angajati', securityLevel: SecurityLevel.READ, execute: get_employees },
  { name: 'get_employee', description: 'Detalii angajat', securityLevel: SecurityLevel.READ, execute: (p) => get_employee(p) },
  { name: 'get_jobs', description: 'Lista lucrari', securityLevel: SecurityLevel.READ, execute: (p) => get_jobs(p) },
  { name: 'get_job', description: 'Detalii lucrare', securityLevel: SecurityLevel.READ, execute: (p) => get_job(p) },
  { name: 'get_appointments', description: 'Programari', securityLevel: SecurityLevel.READ, execute: (p) => get_appointments(p) },
  { name: 'get_rates', description: 'Tarife', securityLevel: SecurityLevel.READ, execute: get_rates },
  { name: 'get_schedule', description: 'Program lucru', securityLevel: SecurityLevel.READ, execute: get_schedule },
  { name: 'get_time_entries', description: 'Intrari timp', securityLevel: SecurityLevel.READ, execute: (p) => get_time_entries(p) },
  { name: 'get_activity_log', description: 'Jurnal activitate', securityLevel: SecurityLevel.READ, execute: (p) => get_activity_log(p) },
  { name: 'analyze_productivity', description: 'Analiza productivitate', securityLevel: SecurityLevel.ANALYZE, execute: analyze_productivity },
  { name: 'analyze_overtime', description: 'Analiza overtime', securityLevel: SecurityLevel.ANALYZE, execute: analyze_overtime },
  { name: 'analyze_costs', description: 'Analiza costuri', securityLevel: SecurityLevel.ANALYZE, execute: analyze_costs },
  { name: 'detect_anomalies', description: 'Detectare anomalii', securityLevel: SecurityLevel.ANALYZE, execute: detect_anomalies },
];

export async function executeTool(toolName: string, params: Record<string, unknown> = {}): Promise<AgentToolResult> {
  const tool = AGENT_TOOLS.find(t => t.name === toolName);
  if (!tool) return fail(`Tool necunoscut: ${toolName}`);
  if (tool.securityLevel === SecurityLevel.WRITE || tool.securityLevel === SecurityLevel.DELETE || tool.securityLevel === SecurityLevel.PROTECTED) {
    return fail(`Tool-ul ${toolName} nu este disponibil in FAZA 1 (READ-ONLY)`);
  }
  return await tool.execute(params);
}

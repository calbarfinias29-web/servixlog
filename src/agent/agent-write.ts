/**
 * Agent SERVIX — WRITE Layer FAZA 2 (CU CONFIRMARE)
 * Aceste operații NU sunt executabile direct de AgentModal.
 */

import { supabase } from '@/lib/supabase';
import { dataAdapter, registry } from '@/data';
import type { CarUpdateInput, RatesUpdateInput, ScheduleUpdateInput } from '@/data/DataAdapter';
import type { Job } from '@/types';
import { ADMIN_WRITE_EXECUTION_ENABLED } from './agent-phase3';

export type WriteKind =
  | 'create_car' | 'update_car' | 'update_client'
  | 'create_employee' | 'update_employee'
  | 'create_job' | 'update_job' | 'update_job_status' | 'transfer_job'
  | 'create_appointment' | 'update_appointment'
  | 'phase3_admin'
  | 'update_schedule' | 'update_rates';

export interface WritePlan {
  kind: WriteKind;
  description: string;
  params: Record<string, unknown>;
}

export interface WriteResult {
  success: boolean;
  message: string;
  /** ID-ul entitatii create/modificate, pentru READ-BACK (cand este disponibil). */
  id?: string;
  ids?: string[];
  /** Cauza reala (nu afisata in UI) — pentru diagnostic intern/teste. */
  debugError?: string;
}

const okW = (m: string): WriteResult => ({ success: true, message: m });
const failW = (m: string, debugError?: string): WriteResult => ({ success: false, message: m, debugError });
const IS_DEMO: boolean = false;

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

function normalizedPlate(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function runUpdate(table: string, values: Record<string, unknown>, id: string): Promise<WriteResult> {
  try {
    const { error } = await supabase.from(table).update(values).eq('id', id);
    if (error) return failW('Actualizarea nu a reusit.');
    return okW('Actualizat cu succes.');
  } catch (e) { return failW('Eroare la actualizare.'); }
}

/**
 * FAZA 2B ETAPA 2: allowlist dur la nivel de executor.
 * Active: update_rates, update_schedule (ETAPA 1) + create_car, update_car,
 * update_client (ETAPA 2). Toate celelalte WRITE raman blocate.
 * update_client modifica DOAR campurile client de pe masina (client_name,
 * client_phone, client_email) — in aceasta aplicatie clientul nu este o
 * entitate separata, ci campuri pe `cars`.
 */
const EXECUTABLE_KINDS: ReadonlyArray<WriteKind> = [
  'update_rates', 'update_schedule', 'create_car', 'update_car', 'update_client',
];

export async function executeWrite(plan: WritePlan): Promise<WriteResult> {
  if (plan.kind === 'phase3_admin') {
    return ADMIN_WRITE_EXECUTION_ENABLED
      ? failW('Operațiile administrative necesită activare explicită într-o fază ulterioară.')
      : failW('Operația a fost confirmată, dar execuția operațiilor administrative ale Agentului este momentan dezactivată.');
  }
  if (!EXECUTABLE_KINDS.includes(plan.kind)) {
    return failW('Aceasta operatie WRITE nu este activata (FAZA 2B ETAPA 2: tarife/program, masini si date client).');
  }
  switch (plan.kind) {
    case 'create_car': return createCar(plan.params);
    case 'update_car': return updateCar(plan.params);
    case 'update_client': return updateCar(plan.params);
    case 'create_employee': return createEmployee(plan.params);
    case 'update_employee': return updateEmployee(plan.params);
    case 'create_job': return createJob(plan.params);
    case 'update_job': return updateJob(plan.params);
    case 'update_job_status': return updateJobStatus(plan.params);
    case 'transfer_job': return transferJob(plan.params);
    case 'create_appointment': return createAppointment(plan.params);
    case 'update_appointment': return updateAppointment(plan.params);
    case 'update_schedule': return updateSchedule(plan.params);
    case 'update_rates': return updateRates(plan.params);
  }
}
async function createCar(p: Record<string, unknown>): Promise<WriteResult> {
  if (Array.isArray(p.cars)) {
    const ids: string[] = [];
    for (const car of p.cars) {
      if (!car || typeof car !== 'object' || Array.isArray(car)) return failW('Date invalide pentru una dintre mașini.');
      const result = await createCar(car as Record<string, unknown>);
      if (!result.success || !result.id) return failW(result.message, result.debugError);
      ids.push(result.id);
    }
    return { success: true, message: `Au fost create ${ids.length} mașini.`, ids };
  }
  try {
    const plate = String(p.license_plate as string || '').trim().toUpperCase();
    const cname = String(p.client_name as string || '').trim();
    const phone = (p.client_phone as string) || null;
    const email = (p.client_email as string) || null;
    const mk = (p.make as string) || null;
    const md = (p.model as string) || null;
    const yr = num(p.year);
    const col = (p.color as string) || null;
    const vi = (p.vin as string) || null;
    const ml = num(p.mileage);
    if (!plate || !cname) return failW('Numar si nume client obligatorii.');

    const { data: existingCars, error: duplicateCheckError } = await supabase
      .from('cars')
      .select('license_plate')
      .eq('is_demo', false);
    if (duplicateCheckError) {
      const detail = `${duplicateCheckError.code ?? ''} ${duplicateCheckError.message ?? ''} ${duplicateCheckError.details ?? ''} ${duplicateCheckError.hint ?? ''}`.trim();
      console.error('[create_car] duplicate check failed:', detail);
      return failW('Masina nu a putut fi verificata.', detail);
    }
    if ((existingCars ?? []).some((car) => normalizedPlate(car.license_plate) === normalizedPlate(plate))) {
      return failW('Exista deja o masina cu acest numar.', `duplicate license_plate: ${plate}`);
    }

    // Folosim doar contractul de creare al tabelului cars. Valorile financiare
    // si overtime au default-uri DB si nu trebuie trimise de acest executor.
    const ins = {
      license_plate: plate, client_name: cname, client_phone: phone, client_email: email,
      make: mk, model: md, year: yr, color: col, vin: vi, mileage: ml,
      fuel_level: (p.fuel_level as string) || null, status: (p.status as string) || 'noua',
      priority: (p.priority as string) || 'normala', is_warranty: p.is_warranty === true,
      deadline: (p.deadline as string) || null,
      notes: (p.notes as string) || null,
      assigned_employee_id: (p.assigned_employee_id as string) || null,
    };
    if (registry.kind === 'local') {
      if (!dataAdapter.createCar) return failW('Crearea locală a mașinii nu este disponibilă.');
      const { data, error } = await dataAdapter.createCar(ins);
      if (error || !data) return failW('Mașina nu a putut fi creată.', error?.message);
      return { success: true, message: 'Mașina a fost creată cu succes.', id: data.id };
    }
    const { data, error } = await supabase.from('cars').insert(ins).select('id').single();
    if (error || !data) {
      const detail = error ? `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.trim() : 'no data returned';
      console.error('[create_car] insert failed:', detail);
      return failW('Masina nu a putut fi creata.', detail);
    }
    // Reutilizeaza logica existenta din AddCarModal: prima inregistrare de kilometraj.
    if (ml !== undefined) {
      try { await supabase.from('mileage_log').insert({ car_id: data.id, mileage: ml, is_demo: IS_DEMO }); }
      catch (e) { /* kilometrajul initial nu blocheaza crearea masinii */ }
    }
    return { success: true, message: 'Masina a fost creata cu succes.', id: data.id };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[create_car] exception:', detail);
    return failW('Eroare la crearea masinii.', detail);
  }
}

async function updateCar(p: Record<string, unknown>): Promise<WriteResult> {
  const id = String(p.car_id as string || '');
  if (!id) return failW('car_id obligatoriu.');
  const patch: Record<string, unknown> = {};
  const lp = p.license_plate as string;
 const cn = p.client_name as string;
 if (lp) patch.license_plate = lp.trim().toUpperCase();
 if (cn) patch.client_name = cn;
 if (p.client_phone !== undefined) patch.client_phone = (p.client_phone as string) || null;
 if (p.client_email !== undefined) patch.client_email = (p.client_email as string) || null;
 if (p.make !== undefined) patch.make = (p.make as string) || null;
 if (p.model !== undefined) patch.model = (p.model as string) || null;
 if (p.year !== undefined) patch.year = num(p.year);
 if (p.color !== undefined) patch.color = (p.color as string) || null;
 if (p.vin !== undefined) patch.vin = (p.vin as string) || null;
 if (p.mileage !== undefined) patch.mileage = num(p.mileage);
 if (p.status as string) patch.status = (p.status as string);
 if (p.priority as string) patch.priority = (p.priority as string);
 if (p.is_warranty !== undefined) patch.is_warranty = p.is_warranty === true;
 if (p.notes !== undefined) patch.notes = (p.notes as string) || null;
 if (Object.keys(patch).length === 0) return failW('Niciun camp de actualizat.');
 if (registry.kind === 'local') {
   if (!dataAdapter.updateCar) return failW('Actualizarea locală a mașinii nu este disponibilă.');
   const { error } = await dataAdapter.updateCar(id, patch as CarUpdateInput);
   return error ? failW('Actualizarea nu a reușit.', error.message) : { ...okW('Actualizat cu succes.'), id };
 }
 const res = await runUpdate('cars', patch, id);
 return { ...res, id: res.success ? id : undefined };
}
async function createEmployee(p: Record<string, unknown>): Promise<WriteResult> {
  try {
    const name = String(p.name as string || '').trim();
    if (!name) return failW('Numele angajatului este obligatoriu.');
    const ins = {
      name, role: p.role === 'admin' ? 'admin' : 'employee',
      active: p.active === false ? false : true, is_demo: IS_DEMO,
    };
    const { error } = await supabase.from('employees').insert(ins);
    if (error) return failW('Angajatul nu a putut fi creat.');
    return okW('Angajatul a fost creat cu succes.');
  } catch (e) { return failW('Eroare la crearea angajatului.'); }
}

async function updateEmployee(p: Record<string, unknown>): Promise<WriteResult> {
  const id = String(p.employee_id as string || '');
  if (!id) return failW('employee_id obligatoriu.');
  const patch: Record<string, unknown> = {};
 const nm = p.name as string;
 const rl = p.role as string;
 if (nm) patch.name = nm;
 if (p.role) patch.role = rl === 'admin' ? 'admin' : 'employee';
 if (p.active !== undefined) patch.active = p.active === true;
 return runUpdate('employees', patch, id);
}

async function createJob(p: Record<string, unknown>): Promise<WriteResult> {
  try {
    const carId = String(p.car_id as string || '');
    const title = String(p.title as string || '').trim();
    if (!carId || !title) return failW('car_id si titlul lucrarii sunt obligatorii.');
    const ins = {
      car_id: carId, title, description: (p.description as string) || null,
      status: (p.status as string) || 'asteptare', worked_seconds: 0, overtime_seconds: 0,
      is_overtime: false, started_at: null, completed_at: null,
      order_index: num(p.order_index) ?? 0, is_demo: IS_DEMO,
    };
    const { error } = await supabase.from('jobs').insert(ins);
    if (error) return failW('Lucrarea nu a putut fi creata.');
    return okW('Lucrarea a fost creata cu succes.');
  } catch (e) { return failW('Eroare la crearea lucrarii.'); }
}

async function updateJob(p: Record<string, unknown>): Promise<WriteResult> {
  const id = String(p.job_id as string || '');
  if (!id) return failW('job_id obligatoriu.');
  const patch: Record<string, unknown> = {};
/* NU modificam worked_seconds / overtime_seconds / started_at aici. */
const ti = p.title as string;
 if (ti) patch.title = ti;
 if (p.description !== undefined) patch.description = (p.description as string) || null;
 if (p.order_index !== undefined) { const o = num(p.order_index); if (o !== undefined) patch.order_index = o; }
 return runUpdate('jobs', patch, id);
}

async function updateJobStatus(p: Record<string, unknown>): Promise<WriteResult> {
  const jobId = String(p.job_id as string || '');
  const status = String(p.status as string || '');
  const empId = p.employee_id ? String(p.employee_id as string) : null;
/* Folosim EXACT RPC-ul existent safe_update_job_status cu valorile actuale. */
if (!jobId || !status) return failW('job_id si status obligatorii.');
  try {
    const { data: job, error: readErr } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (readErr || !job) return failW('Lucrarea nu a putut fi citita.');
    const j = job as Job;
    const completedAt = status === 'finalizat' ? new Date().toISOString() : j.completed_at;
   const { data, error } = await supabase.rpc('safe_update_job_status', {
      p_job_id: j.id, p_employee_id: empId ?? null, p_status: status,
      p_worked_seconds: j.worked_seconds ?? 0, p_overtime_seconds: j.overtime_seconds ?? 0, p_started_at: j.started_at,
    });
    if (error) return failW('Statusul nu a putut fi actualizat.');
    if (data && data.ok === false) return failW('Statusul nu a putut fi actualizat.');
    if (status === 'finalizat') { await supabase.from('jobs').update({ completed_at: completedAt }).eq('id', jobId); }
    return okW('Statusul lucrarii a fost actualizat cu succes.');
  } catch (e) { return failW('Eroare la actualizarea statusului.'); }
}

async function transferJob(p: Record<string, unknown>): Promise<WriteResult> {
  const carId = String(p.car_id as string || '');
  const newEmpId = String(p.new_employee_id as string || '');
  const adminId = p.admin_id ? String(p.admin_id as string) : null;
// Exact patternul existent: admin_transfer_car + fallback direct. */
try {
    const res = await supabase.rpc('admin_transfer_car', { p_car_id: carId, p_new_employee_id: newEmpId, p_admin_id: adminId });
    if (res.error || ((res.data as { ok?: boolean } | null)?.ok === false)) {
      const up = await supabase.from('cars').update({ assigned_employee_id: newEmpId }).eq('id', carId);
      if (up.error) return failW('Transferul nu a putut fi efectuat.');
    }
    return okW('Transferul a fost efectuat. Timpul lucrat anterior ramane in istoric.');
  } catch (e) { return failW('Eroare la transfer.'); }
}
async function createAppointment(p: Record<string, unknown>): Promise<WriteResult> {
  try {
    const date = String(p.appointment_date as string || '');
    const time = String(p.appointment_time as string || '');
    if (!date || !time) return failW('Data si ora programarii sunt obligatorii.');
    const ins = {
      appointment_date: date, appointment_time: time,
      client_name: (p.client_name as string) || null, client_phone: (p.client_phone as string) || null,
      license_plate: (p.license_plate as string) || null, make: (p.make as string) || null,
      model: (p.model as string) || null, employee_id: (p.employee_id as string) || null,
      status: (p.status as string) || 'programata', notes: (p.notes as string) || null,
      is_demo: IS_DEMO,
    };
    const { error } = await supabase.from('appointments').insert(ins);
    if (error) return failW('Programarea nu a putut fi creata.');
    return okW('Programarea a fost creata cu succes.');
  } catch (e) { return failW('Eroare la crearea programarii.'); }
}

async function updateAppointment(p: Record<string, unknown>): Promise<WriteResult> {
  const id = String(p.appointment_id as string || '');
  if (!id) return failW('appointment_id obligatoriu.');
  const patch: Record<string, unknown> = {};
 const dt = p.appointment_date as string;
 const tm = p.appointment_time as string;
 const cname = p.client_name as string;
 if (dt) patch.appointment_date = dt;
 if (tm) patch.appointment_time = tm;
 if (cname) patch.client_name = cname;
 if (p.notes !== undefined) patch.notes = (p.notes as string) || null;
 if (p.employee_id !== undefined) patch.employee_id = (p.employee_id as string) || null;
 return runUpdate('appointments', patch, id);
}

async function updateSchedule(p: Record<string, unknown>): Promise<WriteResult> {
  try {
    const patch: Record<string, unknown> = {};
    const days: Array<`monday`|`tuesday`|`wednesday`|`thursday`|`friday`|`saturday`|`sunday`> = [`monday`,`tuesday`,`wednesday`,`thursday`,`friday`,`saturday`,`sunday`];
   for (const d of days) {
      const activeK = `${d}_active`;
      const startK = `${d}_start`;
      const endK = `${d}_end`;
      if (activeK in p) patch[activeK] = p[activeK] === true;
      if (startK in p) patch[startK] = String(p[startK] as string);
      if (endK in p) patch[endK] = String(p[endK] as string);
    }
    if (registry.kind === 'local') {
      if (!dataAdapter.updateSchedule) return failW('Actualizarea locală a programului nu este disponibilă.');
      const { error } = await dataAdapter.updateSchedule(patch as ScheduleUpdateInput);
      return error ? failW('Programul nu a putut fi actualizat.', error.message) : okW('Programul de lucru a fost actualizat cu succes.');
    }
    const { error } = await supabase.from('work_schedule').update(patch).eq('active', true);
    if (error) return failW('Programul nu a putut fi actualizat.');
    return okW('Programul de lucru a fost actualizat cu succes.');
  } catch (e) { return failW('Eroare la actualizarea programului.'); }
}

async function updateRates(p: Record<string, unknown>): Promise<WriteResult> {
  const patch: Record<string, unknown> = {};
/* NU inventam formula TVA. */
const nr = num(p.normal_rate); if (nr !== undefined) patch.normal_rate = nr;
const or = num(p.overtime_rate); if (or !== undefined) patch.overtime_rate = or;
const wr = num(p.warranty_rate); if (wr !== undefined) patch.warranty_rate = wr;
const vr = num(p.vat_rate); if (vr !== undefined) patch.vat_rate = vr;
const ur = num(p.urgent_rate); if (ur !== undefined) patch.urgent_rate = ur;
try {
    if (registry.kind === 'local') {
      if (!dataAdapter.updateRates) return failW('Actualizarea locală a tarifelor nu este disponibilă.');
      const { error } = await dataAdapter.updateRates(patch as RatesUpdateInput);
      return error ? failW('Tarifele nu au putut fi actualizate.', error.message) : okW('Tarifele au fost actualizate cu succes.');
    }
    const { data: rows, error: e2 } = await supabase.from('rates').select('id').order('id').limit(1);
    if (e2) return failW('Nu am putut citi tarifele.');
    const row = rows?.[0]; if (!row) return failW('Nu exista un rand de tarife.');
    const { error } = await supabase.from('rates').update(patch).eq('id', row.id);
    if (error) return failW('Tarifele nu au putut fi actualizate.');
    return okW('Tarifele au fost actualizate cu succes.');
  } catch (e) { return failW('Eroare la actualizarea tarifelor.'); }
}
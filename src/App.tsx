import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bell, BriefcaseBusiness, CarFront, Check,
  Clock3, Cog, Coffee, LogOut, Package, PanelLeft, Pause, Play, Plus, Search,
  Settings, ShieldCheck, Trash2, UserRound, Users, Wrench, X, Zap,
  Palette, FileBarChart, Calendar, AlertTriangle, Save, FileText, Image,
  Hash, KeyRound, Lock, Download, Upload, Clock, CalendarClock, Eye, EyeOff, Info,
  UserPlus, Mail, Phone, Coins, MoreVertical, ChevronDown, DollarSign, SlidersHorizontal,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Car, CarStatus, Employee, EmployeeEventSettings, EventMode, Job, JobStatus, Priority, Rates, Schedule, Theme, ThemeColors, View, FinancialStatus, FuelLevel, PlateHistoryEntry, MileageLogEntry, Appointment, AppointmentStatus, CarPhoto } from '@/types';
import { generateReportPdf, title as pdfTitle, heading as pdfHeading, row as pdfRow, type PdfLine } from '@/lib/pdf';
import PanouAngajat from '@/PanouAngajat';
import { VehicleImage } from '@/components/VehicleImage';
import { VEHICLE_MAKES, modelsFor } from '@/lib/vehicleCatalog';
import ServiceDarkDashboard from '@/ServiceDarkDashboard';

function isInBreak(schedule: Schedule | null, date = new Date()): boolean {
  if (!schedule) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const bs = Number(schedule.break_start.slice(0, 2)) * 60 + Number(schedule.break_start.slice(3, 5));
  const be = Number(schedule.break_end.slice(0, 2)) * 60 + Number(schedule.break_end.slice(3, 5));
  return now >= bs && now < be;
}
function isAfterHours(schedule: Schedule | null, date = new Date()): boolean {
  if (!schedule) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const we = Number(schedule.work_end.slice(0, 2)) * 60 + Number(schedule.work_end.slice(3, 5));
  return now >= we;
}
function isOvertimeWindowFn(schedule: Schedule | null, date = new Date()): boolean {
  if (!schedule) return false;
  return isAfterHours(schedule, date) && !isInBreak(schedule, date);
}
function isCarActivelyWorkedByOther(car: Car, employeeId: string): boolean {
  if (!car.assigned_employee_id) return false;
  if (car.assigned_employee_id === employeeId) return false;
  return Boolean(car.jobs?.some((job: Job) => job.status === 'in_lucru'));
}
function canSwitchCar(activeJob: Job | undefined): boolean {
  return !activeJob;
}
type EmployeeView = 'acasa' | 'masiniile' | 'lucrari' | 'piese' | 'profil';
function daysOverdue(deadline: string | null, status: CarStatus): number {
  if (!deadline || status === 'finalizata') return 0;
  const diff = Math.floor((Date.now() - new Date(deadline + 'T23:59:59').getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}

const statusLabels: Record<CarStatus | JobStatus, string> = {
  noua: 'NOUĂ', in_lucru: 'ÎN LUCRU', asteptare_piese: 'AȘTEPTARE PIESE', in_garantie: 'ÎN GARANȚIE',
  finalizata: 'FINALIZATĂ', asteptare: 'AȘTEPTARE', finalizat: 'FINALIZAT',
};
const statusStyles: Record<string, string> = {
  noua: 'bg-[var(--border)] text-[var(--text-secondary)]', in_lucru: 'bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]', asteptare_piese: 'bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-[var(--warning)]',
  in_garantie: 'bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] text-[var(--primary)]', finalizata: 'bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]', asteptare: 'bg-[var(--border)] text-[var(--text-secondary)]', finalizat: 'bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]',
};

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}h ${minutes.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
}
function formatShortDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${minutes}m`;
}
function formatTimer(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
function isOverdue(deadline: string | null, status: CarStatus): boolean {
  return Boolean(deadline && status !== 'finalizata' && new Date(`${deadline}T23:59:59`) < new Date());
}
function getCarStatus(jobs: Job[]): CarStatus {
  if (jobs.length > 0 && jobs.every((job: Job) => job.status === 'finalizat')) return 'finalizata';
  if (jobs.some((job: Job) => job.status === 'asteptare_piese')) return 'asteptare_piese';
  if (jobs.some((job: Job) => job.status === 'in_lucru')) return 'in_lucru';
  return 'noua';
}
function totalWorkedSeconds(jobs: Job[] | undefined): number {
  return (jobs ?? []).reduce((sum: number, j: Job) => sum + j.worked_seconds, 0);
}
function totalOvertimeSeconds(jobs: Job[] | undefined): number {
  return (jobs ?? []).reduce((sum: number, j: Job) => sum + (j.overtime_seconds ?? 0), 0);
}
function normalWorkedSeconds(jobs: Job[] | undefined): number {
  return (jobs ?? []).reduce((sum: number, j: Job) => sum + (j.worked_seconds - (j.overtime_seconds ?? 0)), 0);
}
function formatMileage(km: number | null): string {
  if (km == null) return '—';
  return km.toLocaleString('ro-RO') + ' km';
}
const fuelLabels: Record<FuelLevel, string> = {
  'rezerva': 'Rezervă', '1/4': '1/4', '1/2': '1/2', '3/4': '3/4', 'plin': 'Plin',
};
const fuelOptions: FuelLevel[] = ['rezerva', '1/4', '1/2', '3/4', 'plin'];
const financialLabels: Record<FinancialStatus, string> = {
  'incasat': 'ÎNCASAT', 'neincasat': 'NEÎNCASAT', 'facturat': 'FACTURAT', 'nefacturat': 'NEFACTURAT',
};
const financialStyles: Record<FinancialStatus, string> = {
  'incasat': 'bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]', 'neincasat': 'bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] text-[var(--danger)]', 'facturat': 'bg-[color-mix(in_srgb,var(--info)_18%,transparent)] text-[var(--info)]', 'nefacturat': 'bg-[var(--border)] text-[var(--text-secondary)]',
};
const financialOptions: FinancialStatus[] = ['incasat', 'neincasat', 'facturat', 'nefacturat'];
const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  'programata': 'PROGRAMATĂ', 'preluata': 'PRELUATĂ', 'in_lucru': 'ÎN LUCRU', 'finalizata': 'FINALIZATĂ', 'anulata': 'ANULATĂ', 'neprezentata': 'NEPREZENTATĂ',
};
const appointmentStatusStyles: Record<AppointmentStatus, string> = {
  'programata': 'bg-[color-mix(in_srgb,var(--info)_18%,transparent)] text-[var(--info)]', 'preluata': 'bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] text-[var(--primary)]', 'in_lucru': 'bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-[var(--warning)]', 'finalizata': 'bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]', 'anulata': 'bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] text-[var(--danger)]', 'neprezentata': 'bg-[var(--border)] text-[var(--text-secondary)]',
};

function applyTheme(colors: ThemeColors): void {
  const root = document.documentElement;
  Object.entries(colors).forEach(([key, value]) => { root.style.setProperty(key, value); });
}

// SERVICEX PREMIUM — aceeași interfață, două palete de token-uri.
// Light = business / clean / premium; Dark = business / technical / premium.
const SERVIX_EMPLOYEE_DARK: ThemeColors = {
  '--primary': '#6D35F2', '--primary-hover': '#7C4DFF', '--secondary': '#A78BFA', '--accent': '#6D35F2',
  '--background': '#090D14', '--surface': '#111722', '--surface-secondary': '#151B26', '--sidebar': '#0D121B', '--card': '#111722',
  '--button': '#6D35F2', '--text-primary': '#F5F7FA', '--text-secondary': '#A8B0BF', '--text-muted': '#727C8D',
  '--border': '#242C3A', '--success': '#22C55E', '--warning': '#F97316', '--danger': '#EF233C', '--info': '#3B82F6',
};
const SERVIX_ADMIN_LIGHT: ThemeColors = {
  '--primary': '#6D35F2', '--primary-hover': '#7C4DFF', '--secondary': '#7C4DFF', '--accent': '#7C4DFF',
  '--background': '#F6F7FB', '--surface': '#FFFFFF', '--surface-secondary': '#FFFFFF', '--sidebar': '#FFFFFF', '--card': '#FFFFFF',
  '--button': '#6D35F2', '--text-primary': '#171A24', '--text-secondary': '#687083', '--text-muted': '#8B93A3',
  '--border': '#E5E7EF', '--success': '#22A05A', '--warning': '#F97316', '--danger': '#EF233C', '--info': '#3B82F6',
};
// Temă Dark pentru panoul de administrare (aceleași token-uri ca Employee Dark)
const SERVIX_ADMIN_DARK: ThemeColors = {
  '--primary': '#6D35F2', '--primary-hover': '#7C4DFF', '--secondary': '#A78BFA', '--accent': '#6D35F2',
  '--background': '#090D14', '--surface': '#111722', '--surface-secondary': '#151B26', '--sidebar': '#0D121B', '--card': '#111722',
  '--button': '#6D35F2', '--text-primary': '#F5F7FA', '--text-secondary': '#A8B0BF', '--text-muted': '#727C8D',
  '--border': '#242C3A', '--success': '#22C55E', '--warning': '#F97316', '--danger': '#EF233C', '--info': '#3B82F6',
};
// Temă Light pentru angajați/tabletă (aceleași token-uri ca Admin Light)
const SERVIX_EMPLOYEE_LIGHT: ThemeColors = {
  '--primary': '#6D35F2', '--primary-hover': '#7C4DFF', '--secondary': '#7C4DFF', '--accent': '#7C4DFF',
  '--background': '#F6F7FB', '--surface': '#FFFFFF', '--surface-secondary': '#FFFFFF', '--sidebar': '#FFFFFF', '--card': '#FFFFFF',
  '--button': '#6D35F2', '--text-primary': '#171A24', '--text-secondary': '#687083', '--text-muted': '#8B93A3',
  '--border': '#E5E7EF', '--success': '#22A05A', '--warning': '#F97316', '--danger': '#EF233C', '--info': '#3B82F6',
};
function clearTheme(): void {
  const root = document.documentElement;
  const keys = ['--primary','--primary-hover','--secondary','--accent','--background','--surface','--surface-secondary','--sidebar','--card','--button','--text-primary','--text-secondary','--text-muted','--border','--success','--warning','--danger','--info'];
  keys.forEach(k => root.style.removeProperty(k));
}

function Badge({ value, compact = false }: { value: string; compact?: boolean }) {
  return <span className={`inline-flex items-center rounded-md font-semibold tracking-[0.08em] ${compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-[11px]'} ${statusStyles[value] ?? 'bg-[var(--border)] text-[var(--text-secondary)]'}`}>{statusLabels[value as keyof typeof statusLabels] ?? value}</span>;
}
function IconButton({ label, onClick, children, tone = 'default' }: { label: string; onClick?: () => void; children: React.ReactNode; tone?: 'default' | 'danger' }) {
  return <button aria-label={label} onClick={onClick} className={`rounded-lg p-2 transition-colors ${tone === 'danger' ? 'text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] hover:text-[var(--danger)]' : 'text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]'}`}>{children}</button>;
}
function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"><div className={`max-h-[90vh] ${wide ? 'max-w-4xl' : 'max-w-2xl'} w-full overflow-auto rounded-2xl bg-[var(--surface)] shadow-2xl`}><div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5"><div><p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--primary)' }}>SERVIX</p><h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">{title}</h2></div><IconButton label="Închide" onClick={onClose}><X size={20} /></IconButton></div>{children}</div></div>;
}

// ============================================================
// LANDING
// ============================================================
function Landing({ employees, onEmployee, onAdmin, children }: { employees: Employee[]; onEmployee: (employee: Employee) => void; onAdmin: () => void; children?: React.ReactNode }) {
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const handleSelect = (emp: Employee): void => {
    if (emp.access_code) { setSelectedEmp(emp); setCode(''); setCodeError(''); }
    else onEmployee(emp);
  };
  const handleVerify = async (): Promise<void> => {
    if (!selectedEmp) return;
    setVerifying(true); setCodeError('');
    const { data, error } = await supabase.rpc('verify_employee_access_code', { p_employee_id: selectedEmp.id, p_code: code });
    if (error) { setCodeError('Eroare la verificare.'); setVerifying(false); return; }
    if (data && data.ok === true) { onEmployee(selectedEmp); }
    else { setCodeError(data?.reason ?? 'Cod incorect.'); }
    setVerifying(false);
  };

  return <main className="min-h-screen px-5 py-8 sm:px-10" style={{ background: 'var(--background)' }}>
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col justify-between">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: 'var(--primary)' }}><Wrench size={20} strokeWidth={2.5} /></div>
          <div>
            <div className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text-primary)' }}>SERVIX</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-secondary)' }}>Atelier management</div>
          </div>
        </div>
      </header>
      <section className="mx-auto w-full max-w-4xl py-14">
        <div className="mb-10 max-w-xl">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em]" style={{ color: 'var(--secondary)' }}>Acces echipă</p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl" style={{ color: 'var(--text-primary)' }}>Cine preia tableta?</h1>
          <p className="mt-4 text-base leading-7" style={{ color: 'var(--text-secondary)' }}>Selectează profilul tău pentru a vedea mașinile și lucrările alocate.</p>
        </div>
        {!selectedEmp ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.filter((e: Employee) => e.role === 'employee' && e.active).map((employee: Employee) => <button key={employee.id} onClick={() => handleSelect(employee)} className="group flex min-h-[180px] items-center justify-between gap-4 rounded-xl border p-4 text-left transition duration-200 hover:-translate-y-1" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <span className="flex min-w-0 flex-col items-start gap-2">
              {employee.avatar_url
                ? <img src={employee.avatar_url} alt={employee.name} className="h-14 w-14 flex-none rounded-full border-2 object-cover" style={{ borderColor: 'var(--primary)' }} />
                : <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full border-2 text-xl font-bold" style={{ borderColor: 'var(--primary)', background: 'var(--card)', color: 'var(--secondary)' }}>{employee.name.slice(0, 1)}</span>}
              <span className="block truncate text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{employee.name}</span>
              {employee.is_demo && <span className="inline-block rounded px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em]" style={{ background: 'color-mix(in srgb, var(--warning) 16%, transparent)', color: 'var(--warning)' }}>DEMO</span>}
              {employee.access_code && <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}><Lock size={12} /> Cod necesar</span>}
              <span className="flex items-center gap-1 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Angajat <ArrowRight size={14} className="transition group-hover:translate-x-1" /></span>
            </span>
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border text-white transition group-hover:brightness-110" style={{ background: 'var(--primary)', borderColor: 'color-mix(in srgb, #FFFFFF 18%, transparent)' }}><ArrowRight size={18} /></span>
          </button>)}
          {employees.filter((e: Employee) => e.role === 'employee').length === 0 && <div className="col-span-3 rounded-xl border border-dashed p-10 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Nu există angajați activi.</div>}
        </div>
        : <div className="mx-auto max-w-sm rounded-xl p-8 shadow-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="mb-2 text-center text-[26px] font-extrabold tracking-tight"><span style={{ color: 'var(--text-primary)' }}>SERV</span><span style={{ color: 'var(--primary)' }}>IX</span></div>
            <p className="mb-6 text-center text-xs font-bold uppercase tracking-[0.22em]" style={{ color: 'var(--secondary)' }}>Acces angajat</p>
            <div className="mb-6 text-center">
              {selectedEmp.avatar_url
                ? <img src={selectedEmp.avatar_url} alt={selectedEmp.name} className="mx-auto h-16 w-16 rounded-full border-2 object-cover" style={{ borderColor: 'var(--primary)' }} />
                : <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 text-2xl font-bold" style={{ borderColor: 'var(--primary)', background: 'var(--card)', color: 'var(--secondary)' }}>{selectedEmp.name[0]}</span>}
              <h2 className="mt-4 text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{selectedEmp.name}</h2>
              <p className="mt-1 text-[13px] font-normal" style={{ color: 'var(--text-secondary)' }}>Cod angajat</p>
            </div>
            <div className="space-y-4">
              <div className="relative">
                <KeyRound size={18} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
                <input type={showCode ? 'text' : 'password'} value={code} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') void handleVerify(); }} placeholder="Cod acces" className="h-14 w-full rounded-lg border pl-10 pr-12 text-center text-2xl font-bold tracking-[0.3em] outline-none" style={{ borderColor: 'var(--border)', background: 'var(--card)', color: 'var(--text-primary)' }} autoFocus />
                <button type="button" onClick={() => setShowCode((v: boolean): boolean => !v)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }}>{showCode ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
              {codeError && <p className="text-sm font-semibold" style={{ color: '#F87171' }}>{codeError}</p>}
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={() => { setSelectedEmp(null); setCode(''); setCodeError(''); setShowCode(false); }} className="flex-1 rounded-lg border px-4 py-3 text-sm font-semibold transition hover:bg-white/5" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Înapoi</button>
              <button onClick={() => void handleVerify()} disabled={verifying || !code} className="flex-1 rounded-lg px-4 py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40" style={{ background: 'var(--primary)' }}>{verifying ? 'Verific...' : 'INTRĂ'}</button>
            </div>
          </div>}
      </section>
      <div className="mb-6 flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-white" style={{ background: 'var(--primary)' }}><Plus size={18} /></span>
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Nu ești în listă?</p>
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Informează administratorul pentru a-ți crea un cont.</p>
          </div>
        </div>
      </div>
      <footer className="flex items-center justify-between border-t pt-5 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><span>Acces privat • Service intern</span><span>SERVIX © 2026</span></footer>
      {children}
    </div>
  </main>
}

// ============================================================
// EMPLOYEE PANEL (tablet)
// ============================================================
function EmployeePanel({ employee, cars, schedule, rates, employees, onRefresh, onChange }: { employee: Employee; cars: Car[]; schedule: Schedule | null; rates: Rates | null; employees: Employee[]; onRefresh: () => Promise<void>; onChange: () => void }) {
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showPicker, setShowPicker] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [activeView, setActiveView] = useState<EmployeeView>('acasa');
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerFilter, setPickerFilter] = useState<'toate' | 'disponibile' | 'in_lucru' | 'asteptare_piese' | 'finalizate'>('disponibile');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [startError, setStartError] = useState('');
  const [showOvertimeConfirm, setShowOvertimeConfirm] = useState(false);
  const [overtimeStartedAt, setOvertimeStartedAt] = useState<string | null>(null);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, []);
  const myCars = cars.filter((car: Car) => car.assigned_employee_id === employee.id && getCarStatus(car.jobs ?? []) !== 'finalizata');
  const selectedCar = cars.find((car: Car) => car.id === selectedCarId) ?? myCars[0] ?? null;
  const activeJob = selectedCar?.jobs?.find((job: Job) => job.status === 'in_lucru');
  const pendingJob = selectedCar?.jobs?.find((job: Job) => job.status === 'asteptare_piese') ?? selectedCar?.jobs?.find((job: Job) => job.status === 'asteptare');
  const currentJob = activeJob ?? pendingJob;
  const breakActive = isInBreak(schedule, new Date(now));
  const liveSeconds = activeJob?.started_at ? Math.max(0, Math.floor((now - new Date(activeJob.started_at).getTime()) / 1000)) : 0;
  const isOvertimeActive = Boolean(activeJob?.is_overtime) && Boolean(activeJob?.started_at);
  const normalSeconds = activeJob ? (breakActive ? activeJob.worked_seconds - (activeJob.overtime_seconds ?? 0) : (isOvertimeActive ? activeJob.worked_seconds - (activeJob.overtime_seconds ?? 0) : activeJob.worked_seconds + liveSeconds - (activeJob.overtime_seconds ?? 0))) : 0;
  const overtimeLiveSeconds = isOvertimeActive ? liveSeconds : 0;
  const overtimeTotalSeconds = (activeJob?.overtime_seconds ?? 0) + overtimeLiveSeconds;
  // „Timp total” = DOAR timpul normal (worked_seconds + live normal).
  // overtime_seconds NU se adaugă — este afișat separat la „Timp peste program”.
  const currentSeconds = normalSeconds;
  const employeeNameById = (id: string | null): string => employees.find((e: Employee) => e.id === id)?.name ?? 'Nealocat';
  const updateJob = async (job: Job, status: JobStatus, extra: Record<string, unknown> = {}): Promise<void> => {
    const isStarting = status === 'in_lucru';
    const payload: Record<string, unknown> = { status, ...extra };
    if (isStarting) payload.started_at = new Date().toISOString();
    else if (job.started_at) {
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(job.started_at).getTime()) / 1000));
      payload.worked_seconds = job.worked_seconds + elapsed;
      // Overtime seconds must accumulate too when stopping a running overtime job
      if (job.is_overtime) payload.overtime_seconds = (job.overtime_seconds ?? 0) + elapsed;
      payload.started_at = null;
    }
    if (status === 'finalizat') payload.completed_at = new Date().toISOString();
    const { error } = await supabase.from('jobs').update(payload).eq('id', job.id);
    if (!error) { await supabase.from('activity_log').insert({ employee_id: employee.id, car_id: job.car_id, job_id: job.id, action: status, detail: `${employee.name} a actualizat lucrarea` }); await onRefresh(); }
  };
  const handleStart = async (job: Job): Promise<void> => {
    if (breakActive) return;
    setStartError('');
    const { data, error } = await supabase.rpc('safe_start_job', { p_job_id: job.id, p_employee_id: employee.id });
    if (error) { setStartError('Nu am putut porni lucrarea.'); return; }
    if (data && data.ok === false) { setStartError(String(data.reason)); return; }
    await onRefresh();
  };
  const handleStartOvertime = async (job: Job): Promise<void> => {
    setStartError('');
    const { data, error } = await supabase.rpc('safe_start_overtime', { p_job_id: job.id, p_employee_id: employee.id });
    if (error) { setStartError('Nu am putut porni lucrarea peste program.'); return; }
    if (data && data.ok === false) { setStartError(String(data.reason)); return; }
    await onRefresh();
  };
  const handleStopOvertime = async (job: Job): Promise<void> => {
    setStartError('');
    const { data, error } = await supabase.rpc('safe_stop_overtime', { p_job_id: job.id, p_employee_id: employee.id });
    if (error) { setStartError('Nu am putut opri lucrarea peste program.'); return; }
    if (data && data.ok === false) { setStartError(String(data.reason)); return; }
    await onRefresh();
  };
  const handleStop = async (job: Job): Promise<void> => { await updateJob(job, 'asteptare'); };
  const handleParts = async (job: Job): Promise<void> => { await updateJob(job, 'asteptare_piese'); };
  const handleFinish = async (job: Job): Promise<void> => { await updateJob(job, 'finalizat'); };
  const addJob = async (title: string): Promise<void> => {
    const maxOrder = (selectedCar?.jobs ?? []).reduce((max: number, j: Job) => Math.max(max, j.order_index), 0);
    await supabase.from('jobs').insert({ car_id: selectedCar!.id, title, order_index: maxOrder + 1 });
    await onRefresh();
  };
  const handleAssign = async (car: Car): Promise<void> => {
    if (isCarActivelyWorkedByOther(car, employee.id)) return;
    setAssigning(true); setAssignError('');
    const { data, error } = await supabase.rpc('safe_assign_car', { p_car_id: car.id, p_employee_id: employee.id });
    if (error) { setAssignError('Nu am putut aloca mașina.'); }
    else if (data && data.ok === false) { setAssignError(String(data.reason)); }
    else { setSelectedCarId(car.id); setShowPicker(false); await onRefresh(); }
    setAssigning(false);
  };
  const switchDisabled = !canSwitchCar(activeJob);
  const carStatus = selectedCar ? getCarStatus(selectedCar.jobs ?? []) : 'noua';
  const isWorking = Boolean(activeJob) && !breakActive;
  const isBreak = breakActive && Boolean(activeJob);
  const isParts = currentJob?.status === 'asteptare_piese' && !activeJob;
  const isPending = currentJob?.status === 'asteptare' && !activeJob;
  const isDone = carStatus === 'finalizata';
  const noJobs = !currentJob && !isDone;
  const timerColor = isWorking ? 'text-blue-700' : isBreak ? 'text-orange-600' : isParts ? 'text-amber-600' : 'text-[var(--text-primary)]';
  const pickerCars = useMemo(() => {
    const q = pickerQuery.toLowerCase();
    return cars.filter((car: Car) => {
      const matchesQuery = `${car.license_plate} ${car.client_name} ${car.make ?? ''} ${car.model ?? ''}`.toLowerCase().includes(q);
      const matchesPlateHistory = (car.plate_history ?? []).some((p: PlateHistoryEntry) => p.license_plate.toLowerCase().includes(q));
      const matchesVin = (car.vin ?? '').toLowerCase().includes(q);
      const matchesInternalId = (car.internal_id ?? '').toLowerCase().includes(q);
      const searchMatch = matchesQuery || matchesPlateHistory || matchesVin || matchesInternalId;
      const cs = getCarStatus(car.jobs ?? []);
      const matchesFilter = pickerFilter === 'toate'
        || (pickerFilter === 'disponibile' && !car.assigned_employee_id)
        || (pickerFilter === 'in_lucru' && cs === 'in_lucru')
        || (pickerFilter === 'asteptare_piese' && cs === 'asteptare_piese')
        || (pickerFilter === 'finalizate' && cs === 'finalizata');
      return searchMatch && matchesFilter;
    });
  }, [cars, pickerQuery, pickerFilter]);

  return <div className="flex min-h-screen" style={{ background: 'var(--background)' }}>
    {/* SIDEBAR STÂNGA */}
    <aside className="fixed inset-y-0 left-0 hidden w-[180px] flex-col border-r lg:flex" style={{ background: 'var(--sidebar)', borderColor: 'var(--border)' }}>
      <div className="flex flex-col h-full">
        {/* Profil sus */}
        <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            {employee.avatar_url ? <img src={employee.avatar_url} alt={employee.name} className="h-10 w-10 rounded-full object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full text-base font-bold" style={{ background: '#7C3AED', color: '#fff' }}>{employee.name[0]}</span>}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{employee.name}</h2>
              <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--success)' }}><span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />Activ</p>
            </div>
          </div>
        </div>
        {/* Meniu */}
        <nav className="flex-1 space-y-2 p-3">
          {([
            ['acasa', 'Acasă', PanelLeft],
            ['masiniile', 'Mașini', CarFront],
            ['lucrari', 'Lucrări', BriefcaseBusiness],
            ['piese', 'Așteptare piese', Package],
            ['profil', 'Profil', UserRound],
          ] as const).map(([key, label, Icon]) => <button key={key} onClick={() => { setActiveView(key as EmployeeView); setShowPicker(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition" style={activeView === key ? { background: '#7C3AED', color: '#FFFFFF' } : { color: 'var(--text-secondary)' }}>{createElement(Icon, { size: 18 })}{label}</button>)}
          <div className="my-2 border-t" style={{ borderColor: 'var(--border)' }} />
          <button onClick={onChange} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition" style={{ color: 'var(--text-secondary)' }}><LogOut size={18} />Ieși</button>
        </nav>
      </div>
    </aside>

    {/* ZONA DREAPTA */}
    <div className="flex-1 lg:pl-[180px]">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b px-6 backdrop-blur" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--surface) 95%, transparent)' }}>
        <div className="flex items-center gap-8">
          <div className="text-[26px] font-extrabold leading-none tracking-tight"><span style={{ color: 'var(--text-primary)' }}>SERV</span><span style={{ color: '#7C3AED' }}>IX</span></div>
          <div className="hidden items-center gap-2 sm:flex">
            <Clock size={16} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{new Date(now).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="text-xs font-normal capitalize" style={{ color: 'var(--text-secondary)' }}>{new Date(now).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {employee.avatar_url ? <img src={employee.avatar_url} alt={employee.name} className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold" style={{ background: '#7C3AED', color: '#fff' }}>{employee.name[0]}</span>}
          <span className="hidden text-sm font-medium sm:block" style={{ color: 'var(--text-primary)' }}>{employee.name}</span>
          <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
          <button onClick={onChange} className="ml-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><LogOut size={14} /> SCHIMBĂ</button>
        </div>
      </header>
      <main className="p-6">
        {activeView === 'masiniile' ? <MyCarsView cars={cars} employeeId={employee.id} onSelectCar={(car: Car) => { setSelectedCarId(car.id); setActiveView('acasa'); }} onOpenPicker={() => setShowPicker(true)} />
        : activeView === 'lucrari' ? <ActiveJobsView cars={cars} employeeId={employee.id} onSelectCar={(car: Car) => { setSelectedCarId(car.id); setActiveView('acasa'); }} />
        : activeView === 'piese' ? <PartsWaitingView cars={cars} employeeId={employee.id} now={now} onSelectCar={(car: Car) => { setSelectedCarId(car.id); setActiveView('acasa'); setStartError(''); }} onContinue={handleStart} />
        : activeView === 'profil' ? <ProfileView employee={employee} />
        : showPicker ? <CarPicker cars={pickerCars} filter={pickerFilter} onFilter={setPickerFilter} query={pickerQuery} onQuery={setPickerQuery} onAssign={handleAssign} assigning={assigning} assignError={assignError} employeeId={employee.id} employeeNameById={employeeNameById} onBack={() => { setShowPicker(false); if (activeView !== 'acasa') setActiveView('acasa'); }} /> : selectedCar ? <div className="space-y-5">
          {startError && <div className="rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: 'color-mix(in srgb, #EF4444 14%, transparent)', border: '1px solid color-mix(in srgb, #EF4444 35%, transparent)', color: '#F87171' }}>{startError}</div>}
          {isBreak && <BreakBanner schedule={schedule} />}
          {isDone && <DoneCard car={selectedCar} onPick={() => setShowPicker(true)} onDetails={() => setShowDetails(true)} />}
          {noJobs && !isDone && <NoJobsCard car={selectedCar} onPick={() => setShowPicker(true)} onDetails={() => setShowDetails(true)} />}
          {/* CARD MAȘINA CURENTĂ */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              {/* CARD MAȘINA CURENTĂ */}
              <div className="rounded-xl border bg-[var(--surface)] p-4 shadow-sm" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Mașină curentă</p>
                <div className="mt-3 flex items-center gap-4">
                  <VehicleImage car={selectedCar} fallback={<div className="flex h-24 w-44 items-center justify-center rounded-xl" style={{ background: 'color-mix(in srgb, #7C3AED 12%, transparent)' }}><CarFront size={40} style={{ color: '#A78BFA' }} /></div>} className="h-24 w-44 flex-none rounded-xl object-contain" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', padding: '2px' }} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{selectedCar.license_plate}</h2>
                    <p className="mt-0.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{[selectedCar.make, selectedCar.model].filter(Boolean).join(' ') || '—'}</p>
                    <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Client: {selectedCar.client_name}</p>
                    <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Kilometraj: {formatMileage(selectedCar.mileage)} km</p>
                  </div>
                  <button onClick={() => setShowDetails(true)} className="flex flex-none items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white transition" style={{ background: '#7C3AED' }}><Wrench size={16} /> DETALII</button>
                </div>
              </div>
              {/* CARD REPARAȚIE / LUCRARE */}
              <div className="rounded-xl border bg-[var(--surface)] p-4 shadow-sm" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Wrench size={16} style={{ color: '#A78BFA' }} /><p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Reparație / Lucrare</p></div>
                  {isOvertimeActive
                    ? <span className="rounded-full px-3 py-1 text-xs font-bold uppercase" style={{ background: 'color-mix(in srgb, #7C3AED 18%, transparent)', color: '#A78BFA', border: '1px solid color-mix(in srgb, #7C3AED 40%, transparent)' }}>PESTE PROGRAM</span>
                    : isWorking
                      ? <span className="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase" style={{ background: 'color-mix(in srgb, #22C55E 14%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, #22C55E 35%, transparent)' }}><span className="h-2 w-2 animate-pulse rounded-full bg-[#22C55E]" />ÎN LUCRU</span>
                      : isParts
                        ? <span className="rounded-full px-3 py-1 text-xs font-bold uppercase" style={{ background: 'color-mix(in srgb, #F59E0B 14%, transparent)', color: '#F59E0B', border: '1px solid color-mix(in srgb, #F59E0B 35%, transparent)' }}>AȘTEPTARE PIESE</span>
                        : isBreak
                          ? <span className="rounded-full px-3 py-1 text-xs font-bold uppercase" style={{ background: 'color-mix(in srgb, #F59E0B 14%, transparent)', color: '#F59E0B', border: '1px solid color-mix(in srgb, #F59E0B 35%, transparent)' }}>PAUZĂ</span>
                          : <span className="rounded-full px-3 py-1 text-xs font-bold uppercase" style={{ background: 'var(--card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>AȘTEPTARE</span>}
                </div>
                <p className="mt-3 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{currentJob?.title ?? '—'}</p>
                {(isWorking || isBreak || isParts) && <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{isBreak ? 'Pauza nu se adaugă la timpul lucrat.' : isParts ? 'Timpul de așteptare nu se adaugă la timpul lucrat.' : 'Cronometrul este pornit.'}</p>}
              </div>
            </div>

            <div className="space-y-4">
              <ScheduleDisplay schedule={schedule} />
              {/* INFORMAȚII UTILE */}
              <div className="rounded-xl border bg-[var(--surface)] p-4 shadow-sm" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2"><Info size={16} style={{ color: '#7C3AED' }} /><p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Informații utile</p></div>
                <ul className="mt-3 space-y-2 text-[13px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
                  <li>• Cronometrul se oprește automat la pauza de masă.</li>
                  <li>• La finalul programului, timpul normal se oprește.</li>
                  <li>• Poți continua peste program — timpul se contorizează separat, la tarif majorat.</li>
                  <li>• În așteptarea pieselor cronometrul stă oprit.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* TIMP LUCRARE */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Timp lucrare</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border bg-[var(--surface)] p-4 shadow-sm" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Timp normal</p>
                <p className="mt-2 text-[28px] font-bold tabular-nums leading-none" style={{ color: 'var(--success)' }}>{formatTimer(normalSeconds)}</p>
              </div>
              <div className="rounded-xl border bg-[var(--surface)] p-4 shadow-sm" style={{ borderColor: isOvertimeActive ? '#7C3AED' : 'var(--border)', boxShadow: isOvertimeActive ? '0 0 0 1px #7C3AED' : undefined }}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Timp peste program</p>
                <p className="mt-2 text-[28px] font-bold tabular-nums leading-none" style={{ color: isOvertimeActive ? '#F59E0B' : 'var(--text-secondary)' }}>{formatTimer(overtimeTotalSeconds)}</p>
              </div>
              <div className="rounded-xl border bg-[var(--surface)] p-4 shadow-sm" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Timp total</p>
                <p className="mt-2 text-[28px] font-bold tabular-nums leading-none" style={{ color: '#7C3AED' }}>{formatTimer(currentSeconds)}</p>
              </div>
            </div>
          </div>

          {/* 4 BUTOANE ORIZONTALE */}
          {!isDone && !noJobs && <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {isWorking && !isOvertimeActive ? <button onClick={() => currentJob && void updateJob(currentJob, 'asteptare')} disabled={isBreak} className="flex items-center justify-center gap-2 rounded-lg px-4 py-6 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40" style={{ background: '#7C3AED' }}><Pause size={22} /> PAUZĂ</button>
              : <button onClick={() => currentJob && handleStart(currentJob)} disabled={isWorking || isBreak} className="flex flex-col items-center gap-2 rounded-lg px-4 py-6 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40" style={{ background: '#7C3AED' }}><Play size={22} fill="currentColor" /> CONTINUĂ LUCRAREA<span className="text-xs font-normal opacity-80">Pornește cronometrul</span></button>}
            <button onClick={() => currentJob && handleParts(currentJob)} disabled={isParts || isBreak} className="flex items-center justify-center gap-2 rounded-lg px-4 py-6 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40" style={{ background: '#F59E0B' }}><Package size={22} /> AȘTEPT PIESE</button>
            <button onClick={() => currentJob && handleFinish(currentJob)} disabled={!isWorking || isBreak} className="flex items-center justify-center gap-2 rounded-lg px-4 py-6 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40" style={{ background: '#EF4444' }}><Check size={22} /> FINALIZEZ LUCRAREA</button>
            <button onClick={() => setShowPicker(true)} disabled={switchDisabled} className="flex flex-col items-center gap-2 rounded-lg border bg-[var(--surface)] px-4 py-6 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}><CarFront size={22} /> ALEGE ALTĂ MAȘINĂ<span className="text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>{switchDisabled ? 'Oprește lucrarea' : 'Schimbă mașina'}</span></button>
          </div>}

          {/* BUTON PESTE PROGRAM */}
          {!isDone && !noJobs && isAfterHours(schedule, new Date(now)) && !isOvertimeActive && !isBreak && <button onClick={() => setShowOvertimeConfirm(true)} className="flex items-center justify-center gap-2 rounded-lg px-4 py-5 text-base font-bold text-white transition hover:brightness-110" style={{ background: '#7C3AED' }}><Clock size={20} /> CONTINUĂ PESTE PROGRAM</button>}
          {isOvertimeActive && <div className="space-y-3"><div className="rounded-xl px-4 py-3 text-sm font-bold" style={{ background: 'color-mix(in srgb, #7C3AED 16%, transparent)', color: '#A78BFA', border: '1px solid color-mix(in srgb, #7C3AED 40%, transparent)' }}>Lucru peste program activ — cronometru la tarif {rates?.overtime_rate ?? 150} lei/oră</div><button onClick={() => currentJob && void handleStopOvertime(currentJob)} className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-4 text-sm font-bold text-white transition hover:brightness-110" style={{ background: '#7C3AED' }}><Pause size={18} /> OPREȘTE PESTE PROGRAM</button></div>}

        </div> : <div className="flex flex-col items-center justify-center gap-6 py-20"><div className="text-center"><p className="text-sm font-semibold text-[var(--text-secondary)]">Nu ai nicio mașină alocată.</p></div><button onClick={() => setShowPicker(true)} className="flex items-center gap-2 rounded-lg px-6 py-4 text-base font-bold text-white shadow-sm transition" style={{ background: '#7C3AED' }}><CarFront size={20} /> ALEGE MAȘINĂ</button></div>}

        {showDetails && selectedCar && <DetailsModal car={selectedCar} jobs={selectedCar.jobs ?? []} onClose={() => setShowDetails(false)} onAddJob={addJob} onJobAction={(job, action) => { if (action === 'start') handleStart(job); else if (action === 'stop') handleStop(job); else if (action === 'parts') handleParts(job); else if (action === 'finish') handleFinish(job); }} breakActive={breakActive} activeJobId={activeJob?.id} />}
        {showOvertimeConfirm && selectedCar && currentJob && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"><div className="max-w-md w-full rounded-xl bg-[var(--surface)] p-6 shadow-2xl" style={{ border: '1px solid var(--border)' }}><div className="mb-4 flex items-center gap-3"><Clock size={24} style={{ color: '#7C3AED' }} /><h2 className="text-lg font-bold text-[var(--text-primary)]">Continui peste program?</h2></div><p className="text-sm text-[var(--text-secondary)]">Lucrarea <strong>{currentJob.title}</strong> la <strong>{selectedCar.license_plate}</strong> va fi continuată la tariful de {rates?.overtime_rate ?? 150} lei/oră.</p><div className="mt-6 flex gap-3"><button onClick={() => setShowOvertimeConfirm(false)} className="flex-1 rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--card)]">Anulează</button><button onClick={() => { void handleStartOvertime(currentJob); setShowOvertimeConfirm(false); }} className="flex-1 rounded-lg px-4 py-3 text-sm font-bold text-white hover:brightness-110" style={{ background: '#7C3AED' }}>DA, Continuă</button></div></div></div>}
      </main>
    </div>
  </div>;
}

function MyCarsView({ cars, employeeId, onSelectCar, onOpenPicker }: { cars: Car[]; employeeId: string; onSelectCar: (car: Car) => void; onOpenPicker: () => void }) {
  const myCars = cars.filter((c: Car) => c.assigned_employee_id === employeeId);
  const inLucru = myCars.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'in_lucru');
  const inParts = myCars.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'asteptare_piese');
  const finalized = myCars.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'finalizata');
  const pending = myCars.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'noua');
  const renderCarCard = (car: Car) => {
    const cs = getCarStatus(car.jobs ?? []);
    const activeJob = car.jobs?.find((j: Job) => j.status === 'in_lucru');
    const partsJob = car.jobs?.find((j: Job) => j.status === 'asteptare_piese');
    return <button key={car.id} onClick={() => onSelectCar(car)} className="flex items-center justify-between rounded-xl border bg-[var(--surface)] p-5 text-left shadow-sm transition hover:shadow-md" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}><CarFront size={20} style={{ color: 'var(--primary)' }} /></div>
        <div>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{car.license_plate}</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{car.make} {car.model}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          {activeJob && <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{activeJob.title}</p>}
          {partsJob && <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{partsJob.title}</p>}
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{car.client_name}</p>
        </div>
        <Badge value={cs} compact />
      </div>
    </button>;
  };
  return <div className="space-y-6">
    <div className="flex items-center justify-between">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{myCars.length} mașini asociate</p>
      <button onClick={onOpenPicker} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white transition" style={{ background: 'var(--button)' }}><CarFront size={16} /> ALEGE MAȘINĂ</button>
    </div>
    {inLucru.length > 0 && <div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>ÎN LUCRU ({inLucru.length})</h3><div className="grid gap-3">{inLucru.map(renderCarCard)}</div></div>}
    {inParts.length > 0 && <div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>AȘTEPTARE PIESE ({inParts.length})</h3><div className="grid gap-3">{inParts.map(renderCarCard)}</div></div>}
    {pending.length > 0 && <div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>NOUĂ ({pending.length})</h3><div className="grid gap-3">{pending.map(renderCarCard)}</div></div>}
    {finalized.length > 0 && <div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>FINALIZATE ({finalized.length})</h3><div className="grid gap-3">{finalized.map(renderCarCard)}</div></div>}
    {myCars.length === 0 && <div className="rounded-xl border border-dashed bg-[var(--surface)] p-10 text-center" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Nu ai mașini asociate. Apasă „Alege mașină" pentru a începe.</div>}
  </div>;
}

function ActiveJobsView({ cars, employeeId, onSelectCar }: { cars: Car[]; employeeId: string; onSelectCar: (car: Car) => void }) {
  const myActiveJobs = cars
    .filter((c: Car) => c.assigned_employee_id === employeeId)
    .flatMap((car: Car) => (car.jobs ?? []).filter((j: Job) => j.status === 'in_lucru').map((j: Job) => ({ car, job: j })))
    .sort((a, b) => (b.job.started_at ?? '').localeCompare(a.job.started_at ?? ''));
  return <div className="space-y-6">
    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{myActiveJobs.length} lucrări active</p>
    {myActiveJobs.length === 0 && <div className="rounded-xl border border-dashed bg-[var(--surface)] p-10 text-center" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Nu ai lucrări active în acest moment.</div>}
    <div className="grid gap-4">
      {myActiveJobs.map(({ car, job }) => {
        const liveSec = job.started_at ? Math.max(0, Math.floor((Date.now() - new Date(job.started_at).getTime()) / 1000)) : 0;
        const totalSec = job.worked_seconds + liveSec;
        return <button key={job.id} onClick={() => onSelectCar(car)} className="flex items-center justify-between rounded-xl border bg-[var(--surface)] p-5 text-left shadow-sm transition hover:shadow-md" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><Play size={18} fill="currentColor" /></div>
            <div>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{car.license_plate}</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{job.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-mono text-2xl font-bold tabular-nums text-blue-700">{formatTimer(totalSec)}</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>timp lucrat</p>
            </div>
            <Badge value="in_lucru" compact />
          </div>
        </button>;
      })}
    </div>
  </div>;
}

function PartsWaitingView({ cars, employeeId, now, onSelectCar, onContinue }: { cars: Car[]; employeeId: string; now: number; onSelectCar: (car: Car) => void; onContinue: (job: Job) => void }) {
  const myPartsCars = cars
    .filter((c: Car) => c.assigned_employee_id === employeeId)
    .filter((c: Car) => getCarStatus(c.jobs ?? []) === 'asteptare_piese');
  return <div className="space-y-6">
    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{myPartsCars.length} mașini în așteptare piese</p>
    {myPartsCars.length === 0 && <div className="rounded-xl border border-dashed bg-[var(--surface)] p-10 text-center" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Nu ai mașini în așteptare piese.</div>}
    <div className="grid gap-4">
      {myPartsCars.map((car: Car) => {
        const partsJob = car.jobs?.find((j: Job) => j.status === 'asteptare_piese');
        if (!partsJob) return null;
        return <div key={car.id} className="rounded-xl border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><Package size={20} /></div>
              <div>
                <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{car.license_plate}</p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{car.client_name} • {car.make} {car.model}</p>
              </div>
            </div>
            <Badge value="asteptare_piese" compact />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2" style={{ borderColor: 'var(--border)' }}>
            <div><p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>LUCRARE</p><p className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{partsJob.title}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>TIMP EFECTIV LUCRAT</p><p className="mt-1 font-mono text-lg font-bold tabular-nums text-amber-700">{formatTimer(partsJob.worked_seconds)}</p></div>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={() => onContinue(partsJob)} className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white transition" style={{ background: 'var(--button)' }}><Play size={16} fill="currentColor" /> CONTINUĂ LUCRAREA</button>
            <button onClick={() => onSelectCar(car)} className="flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-4 py-3 text-sm font-bold transition" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><Cog size={16} /> DETALII</button>
          </div>
        </div>;
      })}
    </div>
  </div>;
}

function ProfileView({ employee }: { employee: Employee }) {
  return <div className="mx-auto max-w-2xl space-y-6">
    <div className="rounded-2xl border bg-[var(--surface)] p-8 shadow-sm" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-5">
        {employee.avatar_url ? <img src={employee.avatar_url} alt={employee.name} className="h-20 w-20 rounded-full object-cover" /> : <span className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>{employee.name[0]}</span>}
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{employee.name}</h2>
          <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--primary)' }}>Angajat activ</p>
          {employee.is_demo && <span className="mt-1 inline-block rounded bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[var(--warning)]">DEMO</span>}
        </div>
      </div>
    </div>
    <div className="rounded-2xl border bg-[var(--surface)] p-6 shadow-sm" style={{ borderColor: 'var(--border)' }}>
      <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>DATE PERSONALE</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Nume</p><p className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{employee.name}</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Username</p><p className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{employee.username ?? '—'}</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Rol</p><p className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Angajat service</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Status</p><p className="mt-1 text-sm font-semibold text-emerald-700">Activ</p></div>
      </div>
    </div>
  </div>;
}

function BreakBanner({ schedule }: { schedule: Schedule | null }) {
  return <div className="rounded-xl p-5 shadow-sm" style={{ background: 'color-mix(in srgb, #F59E0B 12%, transparent)', border: '1px solid color-mix(in srgb, #F59E0B 35%, transparent)' }}><div className="flex items-center gap-3"><Coffee size={28} style={{ color: '#F59E0B' }} /><div><p className="text-lg font-bold uppercase tracking-[0.12em]" style={{ color: '#F59E0B' }}>PAUZĂ DE MASĂ AUTOMATĂ</p><p className="mt-0.5 text-sm font-semibold" style={{ color: '#FBBF24' }}>{schedule?.break_start.slice(0, 5) ?? '13:00'} – {schedule?.break_end.slice(0, 5) ?? '14:00'}</p></div><p className="ml-auto text-sm" style={{ color: 'var(--text-secondary)' }}>Se reia automat la {schedule?.break_end.slice(0, 5) ?? '14:00'}.</p></div></div>;
}

function ScheduleDisplay({ schedule }: { schedule: Schedule | null }) {
  if (!schedule) return null;
  const row = (range: string, label: string, color: string): React.ReactNode => <div className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)` }}><span className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{range}</span><span className="text-xs font-bold uppercase tracking-wide" style={{ color }}>{label}</span></div>;
  return <div className="rounded-xl border bg-[var(--surface)] p-4 shadow-sm" style={{ borderColor: 'var(--border)' }}>
    <div className="mb-3 flex items-center gap-2"><Calendar size={16} style={{ color: '#7C3AED' }} /><h3 className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Program de lucru</h3></div>
    <div className="space-y-2">
      {row(`${schedule.work_start.slice(0, 5)} – ${schedule.break_start.slice(0, 5)}`, 'Lucru', 'var(--success)')}
      {row(`${schedule.break_start.slice(0, 5)} – ${schedule.break_end.slice(0, 5)}`, 'Pauză', '#F59E0B')}
      {row(`${schedule.break_end.slice(0, 5)} – ${schedule.work_end.slice(0, 5)}`, 'Lucru', 'var(--success)')}
      {row(`după ${schedule.work_end.slice(0, 5)}`, 'Posibil ore suplimentare', '#7C3AED')}
    </div>
  </div>;
}
function DoneCard({ car, onPick, onDetails }: { car: Car; onPick: () => void; onDetails: () => void }) {
  return <div className="rounded-xl border bg-[var(--surface)] p-8 text-center shadow-sm" style={{ borderColor: 'var(--border)' }}><div className="flex items-center justify-center gap-2"><Check size={28} style={{ color: 'var(--success)' }} /><span className="text-lg font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--success)' }}>FINALIZATĂ</span></div><h2 className="mt-3 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{car.license_plate}</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{car.client_name}</p><div className="mt-6 space-y-3"><button onClick={onPick} className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-4 text-base font-bold text-white transition hover:brightness-110" style={{ background: '#7C3AED' }}><CarFront size={20} /> ALEGE ALTĂ MAȘINĂ</button><button onClick={onDetails} className="flex w-full items-center justify-center gap-2 rounded-lg border bg-[var(--card)] px-4 py-3 text-sm font-bold transition" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><Cog size={18} /> DETALII / SETĂRI LUCRARE</button></div></div>;
}
function NoJobsCard({ car, onPick, onDetails }: { car: Car; onPick: () => void; onDetails: () => void }) {
  return <div className="rounded-xl border bg-[var(--surface)] p-8 text-center shadow-sm" style={{ borderColor: 'var(--border)' }}><h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{car.license_plate}</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{car.client_name}</p><p className="mt-4 text-sm text-[var(--text-secondary)]">Nu există lucrări pentru această mașină.</p><div className="mt-6 space-y-3"><button onClick={onPick} className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-4 text-base font-bold text-white transition hover:brightness-110" style={{ background: '#7C3AED' }}><CarFront size={20} /> ALEGE ALTĂ MAȘINĂ</button><button onClick={onDetails} className="flex w-full items-center justify-center gap-2 rounded-lg border bg-[var(--card)] px-4 py-3 text-sm font-bold transition" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><Cog size={18} /> DETALII / SETĂRI LUCRARE</button></div></div>;
}

function DetailsModal({ car, jobs, onClose, onAddJob, onJobAction, breakActive, activeJobId }: { car: Car; jobs: Job[]; onClose: () => void; onAddJob: (title: string) => void; onJobAction: (job: Job, action: 'start' | 'stop' | 'parts' | 'finish') => void; breakActive: boolean; activeJobId?: string }) {
  const [newJobTitle, setNewJobTitle] = useState('');
  const sortedJobs = [...jobs].sort((a: Job, b: Job) => a.order_index - b.order_index);
  const handleAdd = (): void => { if (newJobTitle.trim()) { onAddJob(newJobTitle.trim()); setNewJobTitle(''); } };
  return <Modal title={`Detalii ${car.license_plate}`} onClose={onClose}><div className="space-y-6 p-6"><div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"><div className="grid gap-3 sm:grid-cols-2"><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Client</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{car.client_name}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Marcă / Model</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{car.make ?? '—'} {car.model ?? ''}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Telefon</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{car.client_phone ?? '—'}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Termen</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{car.deadline ? new Date(car.deadline).toLocaleDateString('ro-RO') : '—'}</p></div></div>{car.notes && <div className="mt-3 border-t border-[var(--border)] pt-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Note</p><p className="mt-1 text-sm text-[var(--text-secondary)]">{car.notes}</p></div>}</div><div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">LUCRĂRI MAȘINĂ ({sortedJobs.length})</h3><div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">{sortedJobs.map((job: Job) => { const isActive = job.status === 'in_lucru'; const isFinished = job.status === 'finalizat'; const isParts = job.status === 'asteptare_piese'; const isPending = job.status === 'asteptare'; const hasOtherActive = activeJobId && activeJobId !== job.id; return <div key={job.id} className={`p-4 ${isActive ? 'bg-blue-50/30' : ''}`}><div className="flex items-start justify-between gap-3"><div className="flex gap-3"><div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isFinished ? 'bg-emerald-100 text-emerald-700' : isActive ? 'bg-blue-100 text-blue-700' : 'bg-[var(--border)] text-[var(--text-secondary)]'}`}>{isFinished ? <Check size={16} /> : <Wrench size={15} />}</div><div><p className="font-bold text-[var(--text-primary)]">{job.title}</p>{job.description && <p className="mt-1 text-xs text-[var(--text-secondary)]">{job.description}</p>}<div className="mt-2 flex flex-wrap items-center gap-2"><Badge value={job.status} compact /><span className="font-mono text-xs text-[var(--text-secondary)]">{formatShortDuration(job.worked_seconds)}</span></div></div></div><div className="flex shrink-0 flex-col gap-1.5">{isPending && <button onClick={() => onJobAction(job, 'start')} disabled={hasOtherActive || breakActive} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition disabled:bg-[var(--border)] disabled:text-[var(--text-secondary)]" style={{ background: 'var(--button)' }}><Play size={13} fill="currentColor" /> ÎNCEPE LUCRAREA</button>}{isActive && <><button onClick={() => onJobAction(job, 'parts')} disabled={breakActive} className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-40"><Package size={13} /> Aștept piese</button><button onClick={() => onJobAction(job, 'finish')} disabled={breakActive} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"><Check size={13} /> Finalizează</button></>}{isParts && <button onClick={() => onJobAction(job, 'start')} disabled={hasOtherActive || breakActive} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition disabled:bg-[var(--border)] disabled:text-[var(--text-secondary)]" style={{ background: 'var(--button)' }}><Play size={13} fill="currentColor" /> Continuă</button>}{isFinished && <span className="text-xs font-bold text-emerald-600">Finalizată</span>}</div></div></div>; })}</div></div><div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Adaugă lucrare</h3><div className="flex gap-2"><input value={newJobTitle} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewJobTitle(event.target.value)} placeholder="Numele lucrării..." className="h-11 flex-1 rounded-lg border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--accent)]" onKeyDown={(event: React.KeyboardEvent) => { if (event.key === 'Enter') handleAdd(); }} /><button onClick={handleAdd} disabled={!newJobTitle.trim()} className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-bold text-white transition disabled:bg-[var(--border)] disabled:text-[var(--text-secondary)]" style={{ background: 'var(--button)' }}><Plus size={16} /> Adaugă</button></div></div></div></Modal>;
}

function CarPicker({ cars, filter, onFilter, query, onQuery, onAssign, assigning, assignError, employeeId, employeeNameById, onBack }: { cars: Car[]; filter: 'toate' | 'disponibile' | 'in_lucru' | 'asteptare_piese' | 'finalizate'; onFilter: (f: 'toate' | 'disponibile' | 'in_lucru' | 'asteptare_piese' | 'finalizate') => void; query: string; onQuery: (q: string) => void; onAssign: (car: Car) => void; assigning: boolean; assignError: string; employeeId: string; employeeNameById: (id: string | null) => string; onBack: () => void }) {
  const filters = [{ key: 'toate', label: 'Toate' }, { key: 'disponibile', label: 'Disponibile' }, { key: 'in_lucru', label: 'În lucru' }, { key: 'asteptare_piese', label: 'Așteptare piese' }, { key: 'finalizate', label: 'Finalizate' }] as const;
  return <div><div className="mb-5 flex items-center gap-3"><button onClick={onBack} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:border-[var(--border)]"><ArrowLeft size={16} /> Înapoi</button><h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Alege mașină</h2></div><div className="mb-5"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} /><input value={query} onChange={(event: React.ChangeEvent<HTMLInputElement>) => onQuery(event.target.value)} placeholder="Caută după număr, client sau model..." className="h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-10 pr-4 text-base outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--accent)]" /></div></div><div className="mb-5 flex flex-wrap gap-2">{filters.map((f) => <button key={f.key} onClick={() => onFilter(f.key)} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${filter === f.key ? 'text-white' : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--primary)]'}`} style={filter === f.key ? { background: 'var(--button)' } : {}}>{f.label}</button>)}</div>{assignError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{assignError}</div>}<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cars.length === 0 ? <div className="col-span-full rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-secondary)]">Nu există mașini pentru filtrul selectat.</div> : cars.map((car: Car) => { const cs = getCarStatus(car.jobs ?? []); const activeJob = car.jobs?.find((job: Job) => job.status === 'in_lucru'); const occupiedByOther = isCarActivelyWorkedByOther(car, employeeId); const isMine = car.assigned_employee_id === employeeId; return <div key={car.id} className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><div className="flex items-start justify-between"><div><span className="block text-lg font-bold text-[var(--text-primary)]">{car.license_plate}</span><span className="mt-1 block text-sm text-[var(--text-secondary)]">{car.make} {car.model}</span></div>{car.priority === 'urgenta' && <Zap size={16} className="text-orange-500" fill="currentColor" />}</div><p className="mt-2 text-sm text-[var(--text-secondary)]">{car.client_name}</p><div className="mt-3 flex flex-wrap items-center gap-2"><Badge value={cs} compact />{activeJob && <span className="flex items-center gap-1 font-mono text-xs text-[var(--text-secondary)]"><Clock3 size={12} /> {formatShortDuration(activeJob.worked_seconds)}</span>}</div>{car.assigned_employee_id && <p className="mt-2 text-xs font-semibold text-[var(--text-secondary)]">{isMine ? 'Alocată ție' : `Lucrată de ${employeeNameById(car.assigned_employee_id)}`}</p>}{activeJob && <p className="mt-1 text-xs text-[var(--text-secondary)]">{activeJob.title}</p>}<div className="mt-4 border-t border-[var(--border)] pt-4">{isMine ? <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--primary)]"><Check size={15} /> Este la tine</span> : occupiedByOther ? <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--text-secondary)]"><Pause size={15} /> ÎN LUCRU — {employeeNameById(car.assigned_employee_id)}</span> : <button onClick={() => onAssign(car)} disabled={assigning} className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white transition disabled:bg-[var(--border)] disabled:text-[var(--text-secondary)]" style={{ background: 'var(--button)' }}><CarFront size={16} /> Alege</button>}</div></div>; })}</div></div>;
}

// ============================================================
// ADMIN PANEL (desktop)
// ============================================================
type AdminTab = 'dashboard' | 'employees' | 'cars' | 'jobs' | 'reports' | 'appointments' | 'settings' | 'themes';

function AdminPanel({ employees, cars, appointments, schedule, rates, themes, onRefresh, onExit, adminTheme, employeeTheme, onChangeAdminTheme, onChangeEmployeeTheme }: { employees: Employee[]; cars: Car[]; appointments: Appointment[]; schedule: Schedule | null; rates: Rates | null; themes: Theme[]; onRefresh: () => Promise<void>; onExit: () => void; adminTheme: 'light' | 'dark'; employeeTheme: 'light' | 'dark'; onChangeAdminTheme: (m: 'light' | 'dark') => void; onChangeEmployeeTheme: (m: 'light' | 'dark') => void }) {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'toate' | CarStatus | 'intarziata'>('toate');
  const [priorityFilter, setPriorityFilter] = useState<'toate' | Priority>('toate');
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [demoFilter, setDemoFilter] = useState<'toate' | 'reale' | 'demo'>('toate');
  const [financialFilter, setFinancialFilter] = useState<'toate' | FinancialStatus>('toate');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [historyCar, setHistoryCar] = useState<Car | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const employeeName = (id: string | null): string => employees.find((e: Employee) => e.id === id)?.name ?? 'Nealocat';

  const filteredCars = useMemo(() => cars.filter((car: Car) => {
    const matchesQuery = `${car.license_plate} ${car.client_name} ${car.make ?? ''} ${car.model ?? ''} ${car.vin ?? ''} ${car.internal_id ?? ''} ${(car.plate_history ?? []).map((p: PlateHistoryEntry) => p.license_plate).join(' ')}`.toLowerCase().includes(query.toLowerCase());
    const cs = getCarStatus(car.jobs ?? []);
    const matchesStatus = statusFilter === 'toate'
      || (statusFilter === 'intarziata' && isOverdue(car.deadline, cs))
      || car.status === statusFilter;
    const matchesPriority = priorityFilter === 'toate' || car.priority === priorityFilter;
    const matchesEmployee = selectedEmployee === 'all' || car.assigned_employee_id === selectedEmployee;
    const matchesDemo = demoFilter === 'toate' || (demoFilter === 'demo' ? car.is_demo : !car.is_demo);
    const matchesFinancial = financialFilter === 'toate' || car.financial_status === financialFilter;
    const matchesDateFrom = !dateFrom || (car.created_at && car.created_at.slice(0, 10) >= dateFrom);
    const matchesDateTo = !dateTo || (car.created_at && car.created_at.slice(0, 10) <= dateTo);
    return matchesQuery && matchesStatus && matchesPriority && matchesEmployee && matchesDemo && matchesFinancial && matchesDateFrom && matchesDateTo;
  }), [cars, query, statusFilter, priorityFilter, selectedEmployee, demoFilter, financialFilter, dateFrom, dateTo]);

  const employeeCars = useMemo(() => selectedEmployee === 'all' ? cars : cars.filter((c: Car) => c.assigned_employee_id === selectedEmployee), [cars, selectedEmployee]);

  const counts = useMemo(() => {
    const inLucru = employeeCars.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'in_lucru').length;
    const finalizate = employeeCars.filter((c: Car) => {
      const cs = getCarStatus(c.jobs ?? []);
      return cs === 'finalizata' && c.completed_at && c.completed_at.slice(0, 10) === new Date().toISOString().slice(0, 10);
    }).length;
    const piese = employeeCars.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'asteptare_piese').length;
    const intarziate = employeeCars.filter((c: Car) => isOverdue(c.deadline, getCarStatus(c.jobs ?? []))).length;
    return { inLucru, finalizate, piese, intarziate };
  }, [employeeCars]);

  const overdueCars = useMemo(() => cars.filter((c: Car) => isOverdue(c.deadline, getCarStatus(c.jobs ?? []))), [cars]);

  const navItems: [AdminTab, string, React.ElementType][] = [
    ['dashboard', 'Dashboard', PanelLeft],
    ['employees', 'Angajați', Users],
    ['cars', 'Mașini', CarFront],
    ['jobs', 'Lucrări', BriefcaseBusiness],
    ['appointments', 'Programări', CalendarClock],
    ['reports', 'Rapoarte', FileBarChart],
    ['themes', 'Teme', Palette],
    ['settings', 'Setări', Settings],
  ];

  return <div className="min-h-screen" style={{ background: 'var(--background)' }}><aside className="fixed inset-y-0 left-0 hidden w-64 border-r lg:block" style={{ background: 'var(--sidebar)', borderColor: 'var(--border)' }}><div className="flex h-full flex-col"><div className="flex h-20 items-center gap-3 border-b px-6" style={{ borderColor: 'var(--border)' }}><div className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ background: 'var(--primary)' }}><Wrench size={18} /></div><div><div className="font-extrabold tracking-tight" style={{ color: 'var(--text-primary)' }}>SERVIX</div><div className="text-[10px] uppercase tracking-[0.17em]" style={{ color: 'var(--text-secondary)' }}>Service Auto</div></div></div><nav className="flex-1 space-y-1 p-4">{navItems.map(([key, label, Icon]) => <button key={key} onClick={() => setActiveTab(key)} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition" style={activeTab === key ? { background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' } : { color: 'var(--text-secondary)' }}>{createElement(Icon, { size: 18 })}{label}</button>)}</nav><div className="border-t p-4" style={{ borderColor: 'var(--border)' }}><button onClick={onExit} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition" style={{ color: 'var(--text-secondary)' }}><LogOut size={18} /> Ieșire</button><div className="mt-3 rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}><ShieldCheck size={15} /></span><span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Control sigur</span></div><p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>Datele tale sunt protejate cu cele mai bune practici.</p></div></div></div></aside><div className="lg:pl-64"><header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b px-5 backdrop-blur sm:px-8" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--surface) 95%, transparent)' }}><div><p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--primary)' }}>Control service</p><h1 className="mt-1 text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{navItems.find(([k]) => k === activeTab)?.[1] ?? 'Dashboard'}</h1></div><div className="flex items-center gap-2"><button className="relative rounded-lg p-2.5" style={{ color: 'var(--text-secondary)' }}><Bell size={19} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-orange-500" /></button><div className="hidden h-8 w-px sm:block" style={{ background: 'var(--border)' }} /><div className="hidden items-center gap-2 sm:flex"><span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Administrator</span><span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--text-primary)' }}>A</span></div></div></header><main className="mx-auto max-w-[1400px] px-5 py-7 sm:px-8">
  {activeTab === 'dashboard' && <DashboardView employees={employees} cars={cars} appointments={appointments} onAddCar={() => setShowAdd(true)} onGoToCars={() => setActiveTab('cars')} onGoToAppointments={() => setActiveTab('appointments')} onGoToEmployees={() => setActiveTab('employees')} onGoToReports={() => setActiveTab('reports')} />}
  {activeTab === 'employees' && <EmployeesView employees={employees} cars={cars} onRefresh={onRefresh} />}
  {activeTab === 'cars' && <CarsView cars={filteredCars} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} selectedEmployee={selectedEmployee} setSelectedEmployee={setSelectedEmployee} demoFilter={demoFilter} setDemoFilter={setDemoFilter} financialFilter={financialFilter} setFinancialFilter={setFinancialFilter} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} employees={employees} employeeName={employeeName} onShowCar={setHistoryCar} onAddCar={() => setShowAdd(true)} />}
  {activeTab === 'jobs' && <JobsView cars={cars} employees={employees} employeeName={employeeName} onShowCar={setHistoryCar} />}
  {activeTab === 'reports' && <ReportsView cars={cars} employees={employees} rates={rates} employeeName={employeeName} />}
  {activeTab === 'appointments' && <AppointmentsView appointments={appointments} cars={cars} employees={employees} employeeName={employeeName} onRefresh={onRefresh} />}
  {activeTab === 'themes' && <ThemesView themes={themes} onRefresh={onRefresh} adminTheme={adminTheme} employeeTheme={employeeTheme} onChangeAdminTheme={onChangeAdminTheme} onChangeEmployeeTheme={onChangeEmployeeTheme} />}
  {activeTab === 'settings' && <SettingsView schedule={schedule} rates={rates} employees={employees} cars={cars} onRefresh={onRefresh} onGoToEmployees={() => setActiveTab('employees')} />}
  </main></div>{showAdd && <AddCarModal employees={employees} onClose={() => setShowAdd(false)} onSaved={async () => { setShowAdd(false); await onRefresh(); }} />}{historyCar && <CarHistoryModal car={historyCar} employees={employees} rates={rates} onClose={() => setHistoryCar(null)} onRefresh={onRefresh} />}</div>;
}

// ============================================================
// DASHBOARD VIEW
// ============================================================
function DashboardView({ employees, cars, appointments, onAddCar, onGoToCars, onGoToAppointments, onGoToEmployees, onGoToReports }: {
  employees: Employee[]; cars: Car[]; appointments: Appointment[];
  onAddCar: () => void; onGoToCars: () => void;
  onGoToAppointments: () => void; onGoToEmployees: () => void; onGoToReports: () => void;
}) {
  // Filtrare locală dashboard: fără filtre = ASTĂZI; cu filtre = perioada selectată.
  const [draftEmployee, setDraftEmployee] = useState('all');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [applied, setApplied] = useState<{ employee: string; from: string; to: string }>({ employee: 'all', from: '', to: '' });
  const [activeStatus, setActiveStatus] = useState<'intarziata' | 'piese' | 'finalizata' | 'in_lucru' | null>(null);
  const useToday = !applied.from && !applied.to;
  const nowD = new Date();
  const todayStr = nowD.getFullYear() + '-' + String(nowD.getMonth() + 1).padStart(2, '0') + '-' + String(nowD.getDate()).padStart(2, '0');
  const rangeStart = new Date(useToday ? todayStr + 'T00:00:00' : applied.from + 'T00:00:00');
  const rangeEnd = new Date(useToday ? todayStr + 'T23:59:59.999' : applied.to + 'T23:59:59.999');
  const inRange = (d: Date) => d >= rangeStart && d <= rangeEnd;
  const empOk = (c: Car) => applied.employee === 'all' || c.assigned_employee_id === applied.employee;
  const carInRange = (c: Car) => {
    const dates = [c.created_at, c.completed_at, c.deadline, ...(c.jobs ?? []).map((j: Job) => j.started_at ?? j.completed_at)].filter(Boolean).map((d) => new Date(d as string));
    return dates.length === 0 || dates.some(inRange);
  };
  const scoped = cars.filter(empOk);
  const intarziateList = scoped.filter((c: Car) => isOverdue(c.deadline, getCarStatus(c.jobs ?? [])));
  const pieseList = scoped.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'asteptare_piese' && carInRange(c));
  const finalizateList = scoped.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'finalizata' && !!c.completed_at && inRange(new Date(c.completed_at)));
  const inLucruList = scoped.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'in_lucru' && (c.jobs ?? []).some((j: Job) => j.status === 'in_lucru' && (!j.started_at || inRange(new Date(j.started_at)))));
  const statusCards: Array<{ key: 'intarziata' | 'piese' | 'finalizata' | 'in_lucru'; label: string; list: Car[]; bg: string; dot: string; Icon: React.ElementType }> = [
    { key: 'intarziata', label: 'ÎN URMĂ CU TERMEN', list: intarziateList, bg: '#FEF2F2', dot: '#EF4444', Icon: AlertTriangle },
    { key: 'piese', label: 'PE AȘTEPTARE PIESE', list: pieseList, bg: 'color-mix(in srgb, var(--warning) 10%, transparent)', dot: 'var(--warning)', Icon: Package },
    { key: 'finalizata', label: useToday ? 'FINALIZATE ASTĂZI' : 'FINALIZATE ÎN PERIOADĂ', list: finalizateList, bg: 'color-mix(in srgb, var(--success) 10%, transparent)', dot: 'var(--success)', Icon: Check },
    { key: 'in_lucru', label: 'ÎN LUCRU', list: inLucruList, bg: 'color-mix(in srgb, var(--info) 10%, transparent)', dot: 'var(--info)', Icon: Clock3 },
  ];
  const activeCard = statusCards.find((k) => k.key === activeStatus) ?? null;
  const resultList = activeCard ? activeCard.list : [];
  const periodLabel = useToday ? 'ASTĂZI' : `${applied.from ? new Date(applied.from + 'T00:00:00').toLocaleDateString('ro-RO') : '...'} – ${applied.to ? new Date(applied.to + 'T00:00:00').toLocaleDateString('ro-RO') : '...'}`;
  const todayAppointments = appointments.filter((a: Appointment) => a.appointment_date === todayStr);
  // Activitate lunară — date reale (mașini create în luna curentă)
  const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
  const perDay = Array.from({ length: daysInMonth }, (_, i) => cars.filter((c: Car) => c.created_at && new Date(c.created_at).getFullYear() === nowD.getFullYear() && new Date(c.created_at).getMonth() === nowD.getMonth() && new Date(c.created_at).getDate() === i + 1).length);
  const maxDay = Math.max(1, ...perDay);
  // Distribuție financiară — mașini finalizate (aceeași sursă ca Rapoarte)
  const finalizedAll = cars.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'finalizata');
  const finRows: Array<{ label: string; n: number; color: string }> = [
    { label: 'Încasate', n: finalizedAll.filter((c: Car) => c.financial_status === 'incasat').length, color: 'var(--success)' },
    { label: 'Neîncasate', n: finalizedAll.filter((c: Car) => c.financial_status === 'neincasat').length, color: '#EF4444' },
    { label: 'Facturate', n: finalizedAll.filter((c: Car) => c.financial_status === 'facturat').length, color: '#3B82F6' },
    { label: 'Nefacturate', n: finalizedAll.filter((c: Car) => c.financial_status === 'nefacturat').length, color: '#8B5CF6' },
  ];
  const finTotal = finalizedAll.length;
  // Top angajați după timp lucrat (din datele existente)
  const topEmployees = employees.filter((e: Employee) => e.role === 'employee').map((e: Employee) => ({ e, sec: cars.filter((c: Car) => c.assigned_employee_id === e.id).reduce((t: number, c: Car) => t + totalWorkedSeconds(c.jobs), 0) })).sort((a, b) => b.sec - a.sec).slice(0, 4);
  const topMax = Math.max(1, topEmployees[0]?.sec ?? 1);
  const chartW = 600; const chartH = 150;
  const pts = perDay.map((v, i) => `${((i / Math.max(1, daysInMonth - 1)) * chartW).toFixed(1)},${(chartH - 12 - (v / maxDay) * (chartH - 34)).toFixed(1)}`).join(' ');
  const areaPts = `0,${chartH} ${pts} ${chartW},${chartH}`;
  const donutR = 54; const donutC = 2 * Math.PI * donutR;
  let finOffset = 0;
  return <div className="space-y-5">
<div>
<p className="text-[13px] font-bold uppercase tracking-[0.18em]" style={{ color: SV.purple }}>Control service</p>
<h2 className="mt-2 text-[32px] font-bold leading-tight" style={{ color: SV.navy }}>Dashboard</h2>
<p className="mt-2 text-sm" style={{ color: SV.sec }}>Prezentare generală a activității service-ului în timp real.</p>
</div>
<div className="rounded-[16px] border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: SV.border }}>
<div className="flex flex-wrap items-center justify-between gap-3">
<div className="flex items-center gap-3">
<span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: SV.lav, color: SV.purple }}><CalendarClock size={18} /></span>
<div><h3 className="text-[18px] font-bold leading-tight" style={{ color: SV.navy }}>Programări astăzi</h3><p className="text-xs" style={{ color: SV.muted }}>{new Date().toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
<span className="rounded-lg px-2.5 py-1 text-xs font-bold" style={{ background: SV.lav, color: SV.purple }}>{todayAppointments.length}</span>
</div>
<button onClick={onGoToAppointments} className="text-sm font-bold transition hover:brightness-125" style={{ color: SV.purple }}>Vezi toate programările →</button>
</div>
{todayAppointments.length === 0 ? <p className="mt-5 rounded-xl border border-dashed py-8 text-center text-sm" style={{ borderColor: SV.border, color: SV.sec }}>Nu există programări pentru azi.</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{todayAppointments.map((apt: Appointment) => <div key={apt.id} className="flex items-center gap-3 rounded-xl border p-3.5 transition hover:shadow-sm" style={{ borderColor: SV.border }}>
<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ background: '#EEF4FF', color: '#3B82F6' }}><Clock3 size={18} /></div>
<div className="min-w-0"><p className="truncate text-sm font-bold" style={{ color: SV.navy }}>{apt.appointment_time} • {apt.license_plate ?? '—'}</p><p className="truncate text-xs" style={{ color: SV.sec }}>{apt.client_name ?? '—'} • {apt.make ?? ''} {apt.model ?? ''}</p></div>
<span className={`ml-auto shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-bold ${appointmentStatusStyles[apt.status]}`}>{appointmentStatusLabels[apt.status]}</span>
</div>)}</div>}
</div>
<div className="rounded-[16px] border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: SV.border }}>
<div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: SV.lav, color: SV.purple }}><SlidersHorizontal size={18} /></span><div><h3 className="text-[18px] font-bold leading-tight" style={{ color: SV.navy }}>Filtrare</h3><p className="text-xs" style={{ color: SV.muted }}>Filtrează activitatea pe angajat și perioadă.</p></div></div>
<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
<label className="block text-[13px] font-semibold" style={{ color: SV.muted }}>Angajat<select value={draftEmployee} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraftEmployee(e.target.value)} className="mt-2 h-[50px] w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none focus:border-[var(--primary)]" style={{ borderColor: SV.border, color: SV.navy }}><option value="all">Toți angajații</option>{employees.filter((e: Employee) => e.role === 'employee').map((e: Employee) => <option key={e.id} value={e.id}>{e.name}{e.is_demo ? ' (DEMO)' : ''}</option>)}</select></label>
<label className="block text-[13px] font-semibold" style={{ color: SV.muted }}>De la<input type="date" value={draftFrom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraftFrom(e.target.value)} className="mt-2 h-[50px] w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none focus:border-[var(--primary)]" style={{ borderColor: SV.border, color: SV.navy }} /></label>
<label className="block text-[13px] font-semibold" style={{ color: SV.muted }}>Până la<input type="date" value={draftTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraftTo(e.target.value)} className="mt-2 h-[50px] w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none focus:border-[var(--primary)]" style={{ borderColor: SV.border, color: SV.navy }} /></label>
<div className="flex items-end gap-2"><button onClick={() => setApplied({ employee: draftEmployee, from: draftFrom, to: draftTo })} className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-lg text-sm font-bold text-white transition hover:brightness-110" style={{ background: SV.purple }}><SlidersHorizontal size={16} /> Aplică filtrele</button><button onClick={() => { setDraftEmployee('all'); setDraftFrom(''); setDraftTo(''); setApplied({ employee: 'all', from: '', to: '' }); }} title="Resetează la ASTĂZI" className="flex h-[50px] items-center justify-center rounded-lg border px-4 text-sm font-bold transition hover:bg-[var(--surface-secondary)]" style={{ borderColor: SV.border, color: SV.sec }}><X size={16} /></button></div>
<p className="mt-3 text-xs font-semibold" style={{ color: SV.muted }}>Perioadă activă: <span style={{ color: SV.purple }}>{periodLabel}</span>{applied.employee !== 'all' ? <> • <span style={{ color: SV.purple }}>{employees.find((e: Employee) => e.id === applied.employee)?.name ?? 'Angajat'}</span></> : null}</p>
</div>
</div>
<div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
{statusCards.map((k) => { const isActive = activeStatus === k.key; return <button key={k.key} onClick={() => setActiveStatus(isActive ? null : k.key)} className="group rounded-[16px] border bg-[var(--surface)] p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: isActive ? k.dot : SV.border, background: isActive ? k.bg : '#fff', boxShadow: isActive ? '0 4px 20px rgba(50,40,100,0.10)' : undefined }}>
<div className="flex items-start justify-between">
<span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: SV.sec }}>{k.label}</span>
{isActive ? <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: k.dot }}>ACTIV</span> : <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: k.bg }}>{createElement(k.Icon, { size: 16, style: { color: k.dot } })}</span>}
</div>
<div className="mt-3 flex items-baseline gap-1.5"><span className="text-[32px] font-bold leading-none" style={{ color: SV.navy }}>{k.list.length}</span><span className="text-xs font-semibold" style={{ color: SV.muted }}>mașini</span></div>
<span className="mt-3 inline-block text-sm font-bold transition group-hover:brightness-125" style={{ color: k.dot }}>{isActive ? 'Ascunde ↑' : 'Vezi detalii →'}</span>
</button>; })}
</div>
{activeCard && <div className="overflow-hidden rounded-[16px] border bg-[var(--surface)] shadow-sm" style={{ borderColor: SV.border }}>
<div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4" style={{ borderColor: SV.border }}>
<h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>Mașini — {activeCard.label} ({resultList.length})</h3>
<div className="flex items-center gap-3">
<span className="text-xs font-semibold" style={{ color: SV.muted }}>Perioadă: {periodLabel}</span>
<button onClick={() => setActiveStatus(null)} className="rounded-lg border px-3 py-1.5 text-xs font-bold transition hover:bg-[var(--surface-secondary)]" style={{ borderColor: SV.border, color: SV.sec }}>Ascunde ↑</button>
</div>
</div>
{resultList.length === 0 ? <p className="p-8 text-center text-sm" style={{ color: SV.sec }}>Nu există mașini pentru acest status în perioada selectată.</p> : resultList.map((car: Car) => <div key={car.id} className="grid grid-cols-1 gap-2 border-b px-6 py-4 last:border-0 sm:grid-cols-[1fr_1fr_1fr_0.9fr_1.1fr_0.8fr_90px] sm:items-center sm:gap-4" style={{ borderColor: SV.border }}>
<span className="text-sm font-semibold" style={{ color: SV.navy }}>{car.client_name}</span>
<span className="text-sm" style={{ color: SV.sec }}>{car.make} {car.model}</span>
<span className="text-sm font-bold" style={{ color: SV.navy }}>{car.license_plate}</span>
<span className="text-sm" style={{ color: SV.sec }}>{car.deadline ? new Date(car.deadline).toLocaleDateString('ro-RO') : car.completed_at ? new Date(car.completed_at).toLocaleDateString('ro-RO') : '—'}</span>
{(() => { const n = employees.find((e: Employee) => e.id === car.assigned_employee_id)?.name ?? '—'; return <span className="flex min-w-0 items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: SV.lav, color: SV.purple }}>{n[0]}</span><span className="truncate text-sm font-medium" style={{ color: SV.navy }}>{n}</span></span>; })()}
<span className="font-mono text-sm" style={{ color: SV.sec }}>{formatShortDuration(totalWorkedSeconds(car.jobs))}</span>
<Badge value={getCarStatus(car.jobs ?? [])} compact />
</div>)}
</div>}
<div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
<div className="rounded-[16px] border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: SV.border }}>
<div className="flex items-center justify-between">
<div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: SV.lav, color: SV.purple }}><FileBarChart size={18} /></span><div><h3 className="text-[18px] font-bold leading-tight" style={{ color: SV.navy }}>Lucrări în această lună</h3><p className="text-xs" style={{ color: SV.muted }}>{new Date().toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })}</p></div></div>
<div className="text-right"><span className="text-[28px] font-bold leading-none" style={{ color: SV.purple }}>{cars.filter((c: Car) => c.created_at && new Date(c.created_at).getFullYear() === nowD.getFullYear() && new Date(c.created_at).getMonth() === nowD.getMonth()).length}</span><p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: SV.muted }}>Total lucrări</p></div>
</div>
{perDay.every((v) => v === 0) ? <p className="mt-6 rounded-xl border border-dashed py-10 text-center text-sm" style={{ borderColor: SV.border, color: SV.sec }}>Nu există activitate înregistrată în această lună.</p> : <svg viewBox={`0 0 ${chartW} ${chartH}`} className="mt-5 h-40 w-full" preserveAspectRatio="none">
<polygon points={areaPts} fill="var(--primary)" opacity="0.08" />
<polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
</svg>}
<div className="mt-2 flex justify-between text-[10px] font-semibold" style={{ color: SV.muted }}><span>1</span><span>{Math.ceil(daysInMonth / 2)}</span><span>{daysInMonth}</span></div>
</div>
<div className="rounded-[16px] border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: SV.border }}>
<h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>Distribuție financiară</h3>
<p className="text-xs" style={{ color: SV.muted }}>Mașini finalizate</p>
<div className="mt-4 flex items-center gap-6">
<svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0">
<circle cx="70" cy="70" r={donutR} fill="none" stroke="#F1F1F7" strokeWidth="14" />
{finTotal > 0 && finRows.map((r) => { const frac = r.n / finTotal; if (frac <= 0) return null; const el = <circle key={r.label} cx="70" cy="70" r={donutR} fill="none" stroke={r.color} strokeWidth="14" strokeDasharray={`${(frac * donutC).toFixed(2)} ${donutC.toFixed(2)}`} strokeDashoffset={(-finOffset * donutC).toFixed(2)} transform="rotate(-90 70 70)" />; finOffset += frac; return el; })}
<text x="70" y="66" textAnchor="middle" fontSize="22" fontWeight="700" fill="#111936">{finTotal}</text>
<text x="70" y="84" textAnchor="middle" fontSize="9" fontWeight="600" fill="#777F9D">TOTAL</text>
</svg>
<div className="min-w-0 flex-1 space-y-2.5">
{finRows.map((r) => <div key={r.label} className="flex items-center justify-between gap-2">
<span className="flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} /><span className="truncate text-sm font-medium" style={{ color: SV.sec }}>{r.label}</span></span>
<span className="shrink-0 text-sm font-bold" style={{ color: SV.navy }}>{r.n}{finTotal > 0 ? <span className="ml-1 text-xs font-semibold" style={{ color: SV.muted }}>{Math.round((r.n / finTotal) * 100)}%</span> : null}</span>
</div>)}
</div>
</div>
</div>
</div>
<div className="rounded-[16px] border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: SV.border }}>
<div className="flex items-center justify-between">
<h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>Top angajați</h3>
<span className="rounded-lg px-2.5 py-1 text-xs font-bold" style={{ background: SV.lav, color: SV.purple }}>După timp lucrat</span>
</div>
<div className="mt-4 space-y-4">
{topEmployees.length === 0 ? <p className="py-4 text-center text-sm" style={{ color: SV.sec }}>Nu există angajați.</p> : topEmployees.map(({ e, sec }, i) => <div key={e.id}>
<div className="flex items-center justify-between gap-3">
<div className="flex min-w-0 items-center gap-3">
<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: SV.lav, color: SV.purple }}>{e.name[0]}</span>
<div className="min-w-0"><p className="truncate text-sm font-bold" style={{ color: SV.navy }}>{i + 1}. {e.name}</p><p className="truncate text-xs" style={{ color: SV.muted }}>{e.username ?? 'Mecanic'}</p></div>
</div>
<span className="shrink-0 font-mono text-sm font-bold" style={{ color: SV.navy }}>{formatShortDuration(sec)}</span>
</div>
<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: '#F1F1F7' }}><div className="h-full rounded-full" style={{ width: `${Math.round((sec / topMax) * 100)}%`, background: SV.purple }} /></div>
</div>)}
</div>
<button onClick={onGoToEmployees} className="mt-5 text-sm font-bold transition hover:brightness-125" style={{ color: SV.purple }}>Vezi toți angajații →</button>
</div>
<div className="rounded-[16px] border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: SV.border }}>
<h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>Acțiuni rapide</h3>
<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
<button onClick={onAddCar} className="flex items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm font-bold text-white transition hover:brightness-110" style={{ background: SV.purple }}><Plus size={17} /> Adaugă mașină</button>
<button onClick={onGoToAppointments} className="flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-sm font-bold transition hover:bg-[var(--surface-secondary)]" style={{ borderColor: SV.border, color: SV.navy }}><CalendarClock size={17} style={{ color: SV.purple }} /> Adaugă programare</button>
<button onClick={onGoToCars} className="flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-sm font-bold transition hover:bg-[var(--surface-secondary)]" style={{ borderColor: SV.border, color: SV.navy }}><CarFront size={17} style={{ color: SV.purple }} /> Vezi mașini</button>
<button onClick={onGoToReports} className="flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-sm font-bold transition hover:bg-[var(--surface-secondary)]" style={{ borderColor: SV.border, color: SV.navy }}><FileBarChart size={17} style={{ color: SV.purple }} /> Vezi rapoarte</button>
</div>
</div>
<p className="pb-4 pt-1 text-center text-xs" style={{ color: SV.muted }}>Date actualizate în timp real.</p>
</div>;
}

// ============================================================
// FILTER BAR
// ============================================================
function FilterBar({ query, setQuery, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter, demoFilter, setDemoFilter, financialFilter, setFinancialFilter, employees }: {
  query: string; setQuery: (v: string) => void;
  statusFilter: 'toate' | CarStatus | 'intarziata'; setStatusFilter: (v: 'toate' | CarStatus | 'intarziata') => void;
  priorityFilter: 'toate' | Priority; setPriorityFilter: (v: 'toate' | Priority) => void;
  demoFilter: 'toate' | 'reale' | 'demo'; setDemoFilter: (v: 'toate' | 'reale' | 'demo') => void;
  financialFilter: 'toate' | FinancialStatus; setFinancialFilter: (v: 'toate' | FinancialStatus) => void;
  employees: Employee[];
}) {
  return <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_160px_140px_140px_140px_140px]"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} /><input value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} placeholder="Caută mașină..." className="h-11 w-full rounded-lg border bg-[var(--surface)] pl-10 pr-4 text-sm outline-none" style={{ borderColor: 'var(--border)' }} /></div><select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value as 'toate' | CarStatus | 'intarziata')} className="h-11 rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><option value="toate">Status: Toate</option><option value="noua">Nouă</option><option value="in_lucru">În lucru</option><option value="asteptare_piese">Așteptare piese</option><option value="finalizata">Finalizată</option><option value="in_garantie">În garanție</option><option value="intarziata">Întârziată</option></select><select value={priorityFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPriorityFilter(e.target.value as 'toate' | Priority)} className="h-11 rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><option value="toate">Prioritate: Toate</option><option value="normala">Normală</option><option value="urgenta">Urgentă</option></select><select value={financialFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFinancialFilter(e.target.value as 'toate' | FinancialStatus)} className="h-11 rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><option value="toate">Financiar: Toate</option><option value="incasat">Încasat</option><option value="neincasat">Neîncasat</option><option value="facturat">Facturat</option><option value="nefacturat">Nefacturat</option></select><select value={demoFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDemoFilter(e.target.value as 'toate' | 'reale' | 'demo')} className="h-11 rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><option value="toate">Tip: Toate</option><option value="reale">Reale</option><option value="demo">Demo</option></select><select className="h-11 rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} disabled><option>Angajat: Toți</option>{employees.filter((e: Employee) => e.role === 'employee').map((e: Employee) => <option key={e.id}>{e.name}</option>)}</select></div>;
}

// ============================================================
// ADMIN CAR TABLE
// ============================================================
function AdminCarTable({ cars, employeeName, onSelect }: { cars: Car[]; employeeName: (id: string | null) => string; onSelect: (car: Car) => void }) {
  return <div className="overflow-hidden rounded-xl border bg-[var(--surface)] shadow-sm" style={{ borderColor: 'var(--border)' }}><div className="hidden grid-cols-[0.8fr_1.2fr_1fr_1fr_1fr_100px_1fr_1fr_1fr] gap-4 border-b bg-[var(--card)]/80 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] sm:grid" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><span>ID intern</span><span>Client</span><span>Mașină</span><span>Nr. Înm.</span><span>Status</span><span>Prioritate</span><span>Termen</span><span>Angajat</span><span>Timp lucrat</span></div>{cars.length === 0 ? <div className="p-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Nu au fost găsite mașini.</div> : cars.map((car: Car) => <button key={car.id} onClick={() => onSelect(car)} className="grid w-full grid-cols-1 gap-2 border-b px-5 py-4 text-left transition last:border-0 hover:bg-[var(--card)] sm:grid-cols-[0.8fr_1.2fr_1fr_1fr_1fr_100px_1fr_1fr_1fr] sm:items-center sm:gap-4" style={{ borderColor: 'var(--border)' }}><span className="font-mono text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{car.internal_id ?? '—'}</span><span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{car.client_name} {car.is_demo && <span className="ml-1 rounded bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em] text-[var(--warning)]">DEMO</span>}</span><span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{car.make} {car.model}</span><span className="font-bold" style={{ color: 'var(--text-primary)' }}>{car.license_plate}</span><Badge value={getCarStatus(car.jobs ?? [])} compact /><span className={`text-xs font-bold ${car.priority === 'urgenta' ? 'text-orange-600' : 'text-[var(--text-secondary)]'}`}>{car.priority === 'urgenta' ? 'URGENTĂ' : 'Normală'}</span><span className={`text-sm font-semibold ${isOverdue(car.deadline, getCarStatus(car.jobs ?? [])) ? 'text-red-600' : ''}`} style={{ color: isOverdue(car.deadline, getCarStatus(car.jobs ?? [])) ? undefined : 'var(--text-secondary)' }}>{car.deadline ? new Date(car.deadline).toLocaleDateString('ro-RO') : '—'}{isOverdue(car.deadline, getCarStatus(car.jobs ?? [])) && <span className="ml-1 block text-[10px] uppercase tracking-wide">întârziat</span>}</span><span className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--border)] text-[10px] font-bold text-[var(--text-secondary)]">{employeeName(car.assigned_employee_id).slice(0, 1)}</span>{employeeName(car.assigned_employee_id)}</span><span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{formatShortDuration(totalWorkedSeconds(car.jobs))}</span></button>)}</div>;
}

// ============================================================
// CARS VIEW
// ============================================================
function CarsView({ cars, query, setQuery, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter, selectedEmployee, setSelectedEmployee, demoFilter, setDemoFilter, financialFilter, setFinancialFilter, dateFrom, setDateFrom, dateTo, setDateTo, employees, employeeName, onShowCar, onAddCar }: {
  cars: Car[]; query: string; setQuery: (v: string) => void;
  statusFilter: 'toate' | CarStatus | 'intarziata'; setStatusFilter: (v: 'toate' | CarStatus | 'intarziata') => void;
  priorityFilter: 'toate' | Priority; setPriorityFilter: (v: 'toate' | Priority) => void;
  selectedEmployee: string; setSelectedEmployee: (v: string) => void;
  demoFilter: 'toate' | 'reale' | 'demo'; setDemoFilter: (v: 'toate' | 'reale' | 'demo') => void;
  financialFilter: 'toate' | FinancialStatus; setFinancialFilter: (v: 'toate' | FinancialStatus) => void;
  dateFrom: string; setDateFrom: (v: string) => void; dateTo: string; setDateTo: (v: string) => void;
  employees: Employee[]; employeeName: (id: string | null) => string; onShowCar: (car: Car) => void; onAddCar: () => void;
}) {
  return <><div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Mașini</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Caută, filtrează și deschide detaliile.</p></div><button onClick={onAddCar} className="flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white transition" style={{ background: 'var(--button)' }}><Plus size={17} /> Adaugă mașină</button></div><div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div><label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Perioada de la</label><input type="date" value={dateFrom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateFrom(e.target.value)} className="mt-2 h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)' }} /></div><div><label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Până la</label><input type="date" value={dateTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateTo(e.target.value)} className="mt-2 h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)' }} /></div><div><label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Angajat</label><select value={selectedEmployee} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedEmployee(e.target.value)} className="mt-2 h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)' }}><option value="all">Toți angajații</option>{employees.filter((e: Employee) => e.role === 'employee').map((e: Employee) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div></div><FilterBar query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} demoFilter={demoFilter} setDemoFilter={setDemoFilter} financialFilter={financialFilter} setFinancialFilter={setFinancialFilter} employees={employees} /><AdminCarTable cars={cars} employeeName={employeeName} onSelect={onShowCar} /></>;
}

// ============================================================
// JOBS VIEW
// ============================================================
function JobsView({ cars, employees, employeeName, onShowCar }: { cars: Car[]; employees: Employee[]; employeeName: (id: string | null) => string; onShowCar: (car: Car) => void }) {
  const allJobs = useMemo(() => cars.flatMap((car: Car) => (car.jobs ?? []).map((job: Job) => ({ job, car }))).sort((a, b) => a.job.order_index - b.job.order_index), [cars]);
  const [jobFilter, setJobFilter] = useState<'toate' | JobStatus>('toate');
  const filtered = jobFilter === 'toate' ? allJobs : allJobs.filter(({ job }) => job.status === jobFilter);
  return <><div className="mb-6"><h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Lucrări</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Toate lucrările din service, grupate pe mașini.</p></div><div className="mb-5 flex flex-wrap gap-2">{([['toate','Toate'],['asteptare','Disponibile'],['in_lucru','În lucru'],['asteptare_piese','Așteptare piese'],['finalizat','Finalizate']] as const).map(([key, label]) => <button key={key} onClick={() => setJobFilter(key)} className="rounded-lg px-4 py-2 text-sm font-bold transition" style={jobFilter === key ? { background: 'var(--button)', color: 'white' } : { borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>{label}</button>)}</div><div className="space-y-3">{filtered.length === 0 ? <div className="rounded-xl border border-dashed bg-[var(--surface)] p-10 text-center text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Nu există lucrări pentru filtrul selectat.</div> : filtered.map(({ job, car }) => <button key={job.id} onClick={() => onShowCar(car)} className="flex w-full items-center justify-between gap-4 rounded-xl border bg-[var(--surface)] p-4 text-left shadow-sm transition hover:shadow-md" style={{ borderColor: 'var(--border)' }}><div className="flex items-center gap-3"><div className={`flex h-10 w-10 items-center justify-center rounded-lg ${job.status === 'finalizat' ? 'bg-emerald-100 text-emerald-700' : job.status === 'in_lucru' ? 'bg-blue-100 text-blue-700' : 'bg-[var(--border)] text-[var(--text-secondary)]'}`}>{job.status === 'finalizat' ? <Check size={18} /> : <Wrench size={17} />}</div><div><p className="font-bold" style={{ color: 'var(--text-primary)' }}>{job.title}</p><p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{car.license_plate} • {car.client_name} • {employeeName(car.assigned_employee_id)}</p></div></div><div className="flex items-center gap-3"><span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{formatShortDuration(job.worked_seconds)}</span><Badge value={job.status} compact /></div></button>)}</div></>;
}

// ============================================================
// REPORTS VIEW
// ============================================================
/** Shared report content used by both PDF generators. */
function buildCarReportLines(car: Car, rates: Rates | null, plateHistory: PlateHistoryEntry[], mileageLog: MileageLogEntry[], empName: string): PdfLine[] {
  const normalSec = normalWorkedSeconds(car.jobs);
  const overtimeSec = totalOvertimeSeconds(car.jobs);
  const totalSec = totalWorkedSeconds(car.jobs);
  const normalRate = car.is_warranty ? (rates?.warranty_rate ?? 0) : (rates?.normal_rate ?? 100);
  const overtimeRate = rates?.overtime_rate ?? 150;
  const normalCost = (normalSec / 3600) * normalRate;
  const overtimeCost = (overtimeSec / 3600) * overtimeRate;
  const lines: PdfLine[] = [
    pdfTitle('SERVIX - Raport final masina'),
    pdfRow('Numar inmatriculare', car.license_plate),
    pdfRow('ID intern', car.internal_id ?? '-'),
    pdfRow('Client', `${car.client_name}${car.client_phone ? ` - ${car.client_phone}` : ''}`),
    pdfRow('Marca / Model', `${car.make ?? '-'} ${car.model ?? ''}`.trim()),
    pdfRow('VIN', car.vin ?? '-'),
    pdfRow('Kilometraj', formatMileage(car.mileage)),
    pdfRow('Angajat', empName),
    pdfRow('Status', statusLabels[getCarStatus(car.jobs ?? [])]),
    pdfRow('Data finalizarii', car.completed_at ? new Date(car.completed_at).toLocaleDateString('ro-RO') : '-'),
    pdfHeading('Lucrari efectuate'),
  ];
  const jobs = [...(car.jobs ?? [])].sort((a: Job, b: Job) => a.order_index - b.order_index);
  if (jobs.length === 0) {
    lines.push(pdfRow('-', 'Nu exista lucrari inregistrate'));
  } else {
    for (const j of jobs) {
      lines.push({ text: `- ${j.title} [${statusLabels[j.status]}]`, size: 10.5, bold: false });
      lines.push(pdfRow('  Timp normal / Peste program', `${formatShortDuration(j.worked_seconds - (j.overtime_seconds ?? 0))} / ${formatShortDuration(j.overtime_seconds ?? 0)}  (finalizata: ${j.completed_at ? new Date(j.completed_at).toLocaleDateString('ro-RO') : '-'})`));
    }
  }
  lines.push(
    pdfHeading('Timpi'),
    pdfRow('Timp normal', formatShortDuration(normalSec)),
    pdfRow('Timp peste program', formatShortDuration(overtimeSec)),
    { text: `Timp total:  ${formatShortDuration(totalSec)}`, size: 12, bold: true },
    pdfHeading('Cost'),
    pdfRow(`Cost timp normal (${normalRate} lei/ora)`, `${normalCost.toFixed(2)} lei`),
    pdfRow(`Cost timp suplimentar (${overtimeRate} lei/ora)`, `${overtimeCost.toFixed(2)} lei`),
    { text: `Cost total:  ${(normalCost + overtimeCost).toFixed(2)} lei`, size: 14, bold: true },
    pdfHeading('Status financiar'),
    pdfRow('Status financiar', financialLabels[car.financial_status as FinancialStatus] ?? String(car.financial_status ?? '-')),
  );
  if (plateHistory.length > 0) {
    lines.push(pdfHeading('Istoric numere'));
    for (const p of plateHistory) lines.push(pdfRow(p.license_plate, new Date(p.changed_at).toLocaleDateString('ro-RO')));
  }
  if (mileageLog.length > 0) {
    lines.push(pdfHeading('Istoric kilometraj'));
    for (const m of mileageLog) lines.push(pdfRow(formatMileage(m.mileage), new Date(m.recorded_at).toLocaleDateString('ro-RO')));
  }
  lines.push(pdfHeading('Generat'), pdfRow('Data generarii', `${new Date().toLocaleString('ro-RO')} - SERVIX Service Auto`));
  return lines;
}

function ReportsView({ cars, employees, rates, employeeName }: { cars: Car[]; employees: Employee[]; rates: Rates | null; employeeName: (id: string | null) => string }) {
  const finalizedCars = cars.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'finalizata');
  const inLucruCars = cars.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'in_lucru');
  const partsCars = cars.filter((c: Car) => getCarStatus(c.jobs ?? []) === 'asteptare_piese');
  const incasate = finalizedCars.filter((c: Car) => c.financial_status === 'incasat');
  const neincasate = finalizedCars.filter((c: Car) => c.financial_status === 'neincasat');
  const facturate = finalizedCars.filter((c: Car) => c.financial_status === 'facturat');
  const nefacturate = finalizedCars.filter((c: Car) => c.financial_status === 'nefacturat');
  const updateFinancial = async (car: Car, value: string): Promise<void> => {
    await supabase.from('cars').update({ financial_status: value }).eq('id', car.id);
  };
  const generatePDF = (car: Car): void => {
    generateReportPdf(`servix_raport_${car.license_plate}.pdf`, buildCarReportLines(car, rates, [], [], employeeName(car.assigned_employee_id)));
  };
  const kpiCards: Array<{ label: string; count: number; bg: string; dot: string; Icon: React.ElementType }> = [
    { label: 'Încasate', count: incasate.length, bg: 'color-mix(in srgb, var(--success) 10%, transparent)', dot: 'var(--success)', Icon: DollarSign },
    { label: 'Neîncasate', count: neincasate.length, bg: '#FEF2F2', dot: '#EF4444', Icon: AlertTriangle },
    { label: 'Facturate', count: facturate.length, bg: 'color-mix(in srgb, var(--info) 10%, transparent)', dot: 'var(--info)', Icon: FileText },
    { label: 'Nefacturate', count: nefacturate.length, bg: 'color-mix(in srgb, var(--primary) 10%, transparent)', dot: 'var(--primary)', Icon: Hash },
  ];
  return <div className="space-y-5">
<div>
<p className="text-[13px] font-bold uppercase tracking-[0.18em]" style={{ color: SV.purple }}>Control service</p>
<h2 className="mt-2 text-[32px] font-bold leading-tight" style={{ color: SV.navy }}>Rapoarte</h2>
<p className="mt-2 text-sm" style={{ color: SV.sec }}>Analizează activitatea service-ului și urmărește starea lucrărilor și încasărilor.</p>
</div>
<div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
{kpiCards.map((k) => <div key={k.label} className="flex items-center justify-between rounded-[14px] border p-5" style={{ borderColor: SV.border, background: k.bg }}>
<div><p className="text-[13px] font-semibold" style={{ color: SV.sec }}>{k.label}</p><p className="mt-1.5 flex items-baseline gap-1.5"><span className="text-[26px] font-bold leading-none" style={{ color: SV.navy }}>{k.count}</span><span className="text-xs font-semibold" style={{ color: SV.muted }}>mașini</span></p></div>
<span className="flex h-9 w-9 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--surface)_75%,transparent)]">{createElement(k.Icon, { size: 16, style: { color: k.dot } })}</span>
</div>)}
</div>
<div className="overflow-hidden rounded-[16px] border bg-[var(--surface)] shadow-sm" style={{ borderColor: SV.border }}><div className="border-b px-6 py-4" style={{ borderColor: SV.border }}><h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>Mașini finalizate ({finalizedCars.length})</h3></div><div className="hidden grid-cols-[1fr_1fr_1fr_1fr_1.2fr_1fr_1.2fr_60px] gap-4 border-b bg-[var(--surface-secondary)] px-6 py-3 text-[11px] font-bold uppercase tracking-[0.12em] sm:grid" style={{ borderColor: SV.border, color: SV.muted }}><span>Client</span><span>Mașină</span><span>Nr. Înm.</span><span>Data fin.</span><span>Angajat</span><span>Timp total</span><span>Status financiar</span><span className="text-right">PDF</span></div>{finalizedCars.length === 0 ? <div className="p-8 text-center text-sm" style={{ color: SV.sec }}>Nu există mașini finalizate.</div> : finalizedCars.map((car: Car) => <div key={car.id} className="grid grid-cols-1 gap-2 border-b px-6 py-4 last:border-0 sm:grid-cols-[1fr_1fr_1fr_1fr_1.2fr_1fr_1.2fr_60px] sm:items-center sm:gap-4" style={{ borderColor: SV.border }}><span className="text-sm font-semibold" style={{ color: SV.navy }}>{car.client_name}</span><span className="text-sm" style={{ color: SV.sec }}>{car.make} {car.model}</span><span className="text-sm font-bold" style={{ color: SV.navy }}>{car.license_plate}</span><span className="text-sm" style={{ color: SV.sec }}>{car.completed_at ? new Date(car.completed_at).toLocaleDateString('ro-RO') : '—'}</span>{(() => { const n = employeeName(car.assigned_employee_id); return <span className="flex min-w-0 items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: SV.lav, color: SV.purple }}>{n[0]}</span><span className="truncate text-sm font-medium" style={{ color: SV.navy }}>{n}</span></span>; })()}<span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{formatShortDuration(totalWorkedSeconds(car.jobs))}</span><select defaultValue={car.financial_status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => void updateFinancial(car, e.target.value)} className={`h-9 rounded-lg border px-2 text-xs font-bold ${financialStyles[car.financial_status as FinancialStatus] ?? 'border-[var(--border)] text-[var(--text-secondary)]'}`}>{financialOptions.map((f: FinancialStatus) => <option key={f} value={f}>{financialLabels[f]}</option>)}</select><button onClick={() => generatePDF(car)} className="justify-self-end rounded-lg p-1.5 transition hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]" style={{ color: SV.purple }} title="Generează PDF"><FileText size={16} /></button></div>)}</div>
<div className="grid gap-5 xl:grid-cols-2">
<div className="rounded-[16px] border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: SV.border }}>
<h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>În lucru ({inLucruCars.length})</h3>
<div className="mt-4 space-y-3">{inLucruCars.length === 0 ? <p className="py-4 text-center text-sm" style={{ color: SV.sec }}>Nu există mașini în lucru.</p> : inLucruCars.map((car: Car) => <div key={car.id} className="flex items-center justify-between rounded-xl border p-3.5" style={{ borderColor: SV.border }}>
<div className="flex min-w-0 items-center gap-3">
<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: SV.lav, color: SV.purple }}>{(car.client_name || '?')[0]}</span>
<div className="min-w-0"><p className="truncate text-sm font-bold" style={{ color: SV.navy }}>{car.client_name}</p><p className="truncate text-xs" style={{ color: SV.sec }}>{car.make} {car.model} • {car.license_plate}</p><p className="mt-0.5 truncate text-xs" style={{ color: SV.muted }}>{employeeName(car.assigned_employee_id)} • {formatShortDuration(totalWorkedSeconds(car.jobs))}</p></div>
</div>
<Badge value="in_lucru" compact />
</div>)}</div>
</div>
<div className="rounded-[16px] border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: SV.border }}>
<h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>Așteptare piese ({partsCars.length})</h3>
<div className="mt-4 space-y-3">{partsCars.length === 0 ? <p className="py-4 text-center text-sm" style={{ color: SV.sec }}>Nu există mașini în așteptarea pieselor.</p> : partsCars.map((car: Car) => { const partsJob = car.jobs?.find((j: Job) => j.status === 'asteptare_piese'); return <div key={car.id} className="flex items-center justify-between rounded-xl border p-3.5" style={{ borderColor: SV.border }}>
<div className="flex min-w-0 items-center gap-3">
<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: SV.lav, color: SV.purple }}>{(car.client_name || '?')[0]}</span>
<div className="min-w-0"><p className="truncate text-sm font-bold" style={{ color: SV.navy }}>{car.client_name}</p><p className="truncate text-xs" style={{ color: SV.sec }}>{car.make} {car.model} • {car.license_plate}</p><p className="mt-0.5 truncate text-xs" style={{ color: SV.muted }}>{partsJob?.title ?? '—'} • {employeeName(car.assigned_employee_id)}</p></div>
</div>
<Badge value="asteptare_piese" compact />
</div>; })}</div>
</div>
</div>
<p className="pt-2 pb-4 text-center text-xs" style={{ color: SV.muted }}>Rapoartele sunt actualizate în timp real.</p>
</div>;
}

// ============================================================
// APPOINTMENTS VIEW
// ============================================================
function AppointmentsView({ appointments, cars, employees, employeeName, onRefresh }: { appointments: Appointment[]; cars: Car[]; employees: Employee[]; employeeName: (id: string | null) => string; onRefresh: () => Promise<void> }) {
  const [showAdd, setShowAdd] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterCar, setFilterCar] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | AppointmentStatus>('all');

  const filtered = useMemo(() => appointments.filter((a: Appointment) => {
    const matchesDate = !filterDate || a.appointment_date === filterDate;
    const matchesClient = !filterClient || (a.client_name ?? '').toLowerCase().includes(filterClient.toLowerCase());
    const matchesCar = !filterCar || (a.license_plate ?? '').toLowerCase().includes(filterCar.toLowerCase());
    const matchesEmployee = filterEmployee === 'all' || a.employee_id === filterEmployee;
    const matchesStatus = filterStatus === 'all' || a.status === filterStatus;
    return matchesDate && matchesClient && matchesCar && matchesEmployee && matchesStatus;
  }), [appointments, filterDate, filterClient, filterCar, filterEmployee, filterStatus]);

  const updateStatus = async (apt: Appointment, status: AppointmentStatus): Promise<void> => {
    await supabase.from('appointments').update({ status }).eq('id', apt.id);
    await onRefresh();
  };
  const deleteAppt = async (apt: Appointment): Promise<void> => {
    if (!apt.is_demo) return;
    if (!window.confirm('Ștergi această programare?')) return;
    await supabase.from('appointments').delete().eq('id', apt.id);
    await onRefresh();
  };

  return <div>
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Programări</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Creează și gestionează programările pentru mașini.</p></div><button onClick={() => setShowAdd(true)} className="flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white transition" style={{ background: 'var(--button)' }}><Plus size={17} /> Adaugă programare</button></div>
    <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5"><div><label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Dată<input type="date" value={filterDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterDate(e.target.value)} className="mt-2 h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }} /></label></div><div><label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Client<input value={filterClient} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterClient(e.target.value)} placeholder="Nume client..." className="mt-2 h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }} /></label></div><div><label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Mașină<input value={filterCar} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterCar(e.target.value)} placeholder="Număr..." className="mt-2 h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }} /></label></div><div><label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Angajat<select value={filterEmployee} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterEmployee(e.target.value)} className="mt-2 h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}><option value="all">Toți</option>{employees.filter((e: Employee) => e.role === 'employee').map((e: Employee) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div><div><label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Status<select value={filterStatus} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterStatus(e.target.value as 'all' | AppointmentStatus)} className="mt-2 h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}><option value="all">Toate</option>{(['programata','preluata','in_lucru','finalizata','anulata','neprezentata'] as AppointmentStatus[]).map((s: AppointmentStatus) => <option key={s} value={s}>{appointmentStatusLabels[s]}</option>)}</select></label></div></div>
    <div className="overflow-hidden rounded-xl border bg-[var(--surface)] shadow-sm" style={{ borderColor: 'var(--border)' }}><div className="hidden grid-cols-[80px_1fr_1fr_1fr_1fr_1fr_1fr_40px] gap-4 border-b bg-[var(--card)]/80 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] sm:grid" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}><span>Ora</span><span>Mașină</span><span>Client</span><span>Dată</span><span>Angajat</span><span>Status</span><span>Schimbă</span><span></span></div>{filtered.length === 0 ? <div className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Nu există programări pentru filtrele selectate.</div> : filtered.map((apt: Appointment) => <div key={apt.id} className="grid grid-cols-1 gap-2 border-b px-5 py-4 last:border-0 sm:grid-cols-[80px_1fr_1fr_1fr_1fr_1fr_1fr_40px] sm:items-center sm:gap-4" style={{ borderColor: 'var(--border)' }}><span className="font-bold text-blue-700" style={{ color: 'var(--text-primary)' }}>{apt.appointment_time}</span><span className="font-bold" style={{ color: 'var(--text-primary)' }}>{apt.license_plate ?? '—'}</span><span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{apt.client_name ?? '—'}</span><span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{new Date(apt.appointment_date).toLocaleDateString('ro-RO')}</span><span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{apt.employee_id ? employeeName(apt.employee_id) : '—'}</span><span className={`rounded px-2 py-1 text-[10px] font-bold ${appointmentStatusStyles[apt.status]}`}>{appointmentStatusLabels[apt.status]}</span><select defaultValue={apt.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => void updateStatus(apt, e.target.value as AppointmentStatus)} className="h-9 rounded-lg border border-[var(--border)] px-2 text-xs font-bold text-[var(--text-secondary)]">{(['programata','preluata','in_lucru','finalizata','anulata','neprezentata'] as AppointmentStatus[]).map((s: AppointmentStatus) => <option key={s} value={s}>{appointmentStatusLabels[s]}</option>)}</select>{apt.is_demo && <button onClick={() => void deleteAppt(apt)} className="text-[var(--text-secondary)] hover:text-red-600"><Trash2 size={14} /></button>}</div>)}</div>
    {showAdd && <AddAppointmentModal cars={cars} employees={employees} onClose={() => setShowAdd(false)} onSaved={async () => { setShowAdd(false); await onRefresh(); }} />}
  </div>;
}

function AddAppointmentModal({ cars, employees, onClose, onSaved }: { cars: Car[]; employees: Employee[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ appointment_date: new Date().toISOString().slice(0, 10), appointment_time: '09:00', license_plate: '', employee_id: '', notes: '' });
  // Introducere manuală: „mașina nu există în sistem” → creează mașina reală + programarea.
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ client_name: '', make: '', model: '', client_phone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const matchedCar = useMemo(() => {
    const q = form.license_plate.trim().toLowerCase();
    if (!q) return null;
    return cars.find((c: Car) => c.license_plate.toLowerCase() === q || (c.internal_id ?? '').toLowerCase() === q || (c.vin ?? '').toLowerCase() === q || (c.plate_history ?? []).some((p: PlateHistoryEntry) => p.license_plate.toLowerCase() === q)) ?? null;
  }, [cars, form.license_plate]);
  const save = async (): Promise<void> => {
    if (!form.appointment_date || !form.appointment_time) return;
    if (!form.license_plate.trim()) { setError('Numărul de înmatriculare este obligatoriu.'); return; }
    if (manual && !matchedCar && !m.client_name.trim()) { setError('Numele clientului este obligatoriu pentru mașina nouă.'); return; }
    if (manual && matchedCar) { setManual(false); }
    setSaving(true); setError('');
    let car = matchedCar;
    // Mașină introdusă manual → o creăm REALĂ în sistem, apoi atașăm programarea.
    if (manual && !car) {
      const { data: newCar, error: carErr } = await supabase.from('cars').insert({
        license_plate: form.license_plate.trim().toUpperCase(),
        client_name: m.client_name.trim(),
        client_phone: m.client_phone.trim() || null,
        make: m.make.trim() || null,
        model: m.model.trim() || null,
        status: 'noua',
      }).select().maybeSingle();
      if (carErr || !newCar) { setError(carErr ? `Eroare la crearea mașinii: ${carErr.message}` : 'Nu s-a putut crea mașina.'); setSaving(false); return; }
      car = newCar as Car;
    }
    const payload: Record<string, unknown> = {
      appointment_date: form.appointment_date,
      appointment_time: form.appointment_time,
      employee_id: form.employee_id || null,
      notes: form.notes || null,
      is_demo: car?.is_demo ?? false,
    };
    if (car) { payload.car_id = car.id; payload.license_plate = car.license_plate; payload.client_name = car.client_name; payload.client_phone = car.client_phone; payload.make = car.make; payload.model = car.model; payload.internal_id = car.internal_id; payload.vin = car.vin; }
    else { payload.license_plate = form.license_plate.toUpperCase() || null; }
    const { error: err } = await supabase.from('appointments').insert(payload);
    if (err) { setError(err.message); setSaving(false); return; }
    await onSaved();
    setSaving(false);
  };
  return <Modal title="Adaugă programare" onClose={onClose}><div className="space-y-5 p-6">
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Data" value={form.appointment_date} onChange={(v: string) => setForm({ ...form, appointment_date: v })} type="date" /><Field label="Ora" value={form.appointment_time} onChange={(v: string) => setForm({ ...form, appointment_time: v })} type="time" /></div>
    <Field label="Număr mașină ( caută automat )" value={form.license_plate} onChange={(v: string) => setForm({ ...form, license_plate: v })} placeholder="TM 27 FXC sau ID intern sau VIN" />
    {matchedCar && <div className="rounded-lg border border-[var(--accent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] p-4"><p className="text-xs font-bold uppercase tracking-wide text-[var(--primary)]">Mașină găsită</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><div><span className="text-xs text-[var(--text-secondary)]">Client:</span> <span className="text-sm font-semibold text-[var(--text-primary)]">{matchedCar.client_name}</span></div><div><span className="text-xs text-[var(--text-secondary)]">Telefon:</span> <span className="text-sm font-semibold text-[var(--text-primary)]">{matchedCar.client_phone ?? '—'}</span></div><div><span className="text-xs text-[var(--text-secondary)]">Marcă/Model:</span> <span className="text-sm font-semibold text-[var(--text-primary)]">{matchedCar.make ?? '—'} {matchedCar.model ?? ''}</span></div><div><span className="text-xs text-[var(--text-secondary)]">ID intern:</span> <span className="text-sm font-semibold text-[var(--text-primary)]">{matchedCar.internal_id ?? '—'}</span></div><div><span className="text-xs text-[var(--text-secondary)]">VIN:</span> <span className="text-sm font-semibold text-[var(--text-primary)]">{matchedCar.vin ?? '—'}</span></div></div></div>}
    {!matchedCar && form.license_plate.trim() && !manual && <button onClick={() => setManual(true)} className="flex w-full items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-left text-sm font-bold transition hover:bg-[var(--card)]" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}><Plus size={16} /> Mașina nu există în sistem? Introdu manual datele</button>}
    {manual && !matchedCar && <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-3 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-[var(--primary)]">Mașină nouă — introducere manuală</p><button onClick={() => setManual(false)} className="text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Anulează</button></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Client *<input value={m.client_name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setM({ ...m, client_name: e.target.value })} placeholder="Ion Popescu" className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--primary)]" /></label>
        <label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Telefon<input value={m.client_phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setM({ ...m, client_phone: e.target.value })} placeholder="07xxxxxxxx" className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--primary)]" /></label>
        <label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Marcă<input value={m.make} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setM({ ...m, make: e.target.value })} placeholder="BMW" className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--primary)]" /></label>
        <label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Model<input value={m.model} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setM({ ...m, model: e.target.value })} placeholder="320d" className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--primary)]" /></label>
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>La salvare, mașina va fi creată real în sistem și va apărea în pagina Mașini.</p>
    </div>}
    <label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Angajat (opțional)<select value={form.employee_id} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, employee_id: e.target.value })} className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-semibold text-[var(--text-primary)]"><option value="">Nealocat</option>{employees.filter((e: Employee) => e.role === 'employee').map((e: Employee) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <label className="block text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Note<textarea value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]" placeholder="Detalii programare..." /></label>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
    <div className="flex justify-end gap-3 border-t border-[var(--border)] pt-5"><button onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--border)]">Anulează</button><button onClick={save} disabled={saving} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white transition disabled:bg-[var(--border)] disabled:text-[var(--text-secondary)]" style={{ background: 'var(--button)' }}>{saving ? 'Se salvează...' : 'Salvează programarea'}</button></div>
  </div></Modal>;
}

// ============================================================
// THEMES VIEW
// ============================================================
function ThemesView({ themes, onRefresh, adminTheme, employeeTheme, onChangeAdminTheme, onChangeEmployeeTheme }: { themes: Theme[]; onRefresh: () => Promise<void>; adminTheme: 'light' | 'dark'; employeeTheme: 'light' | 'dark'; onChangeAdminTheme: (m: 'light' | 'dark') => void; onChangeEmployeeTheme: (m: 'light' | 'dark') => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [previewColors, setPreviewColors] = useState<ThemeColors | null>(null);
  const adminThemes = themes.filter((t: Theme) => t.scope === 'admin' || t.is_custom);
  const employeeThemes = themes.filter((t: Theme) => t.scope === 'employee' || t.is_custom);
  const applyPreview = (colors: ThemeColors): void => { applyTheme(colors); setPreviewColors(colors); };
  const resetPreview = (): void => { clearTheme(); setPreviewColors(null); };
  const ModeCard = ({ mode, label, sub, active, onSelect, bg, fg, chip }: { mode: 'light' | 'dark'; label: string; sub: string; active: boolean; onSelect: () => void; bg: string; fg: string; chip: string }) => (
    <button onClick={onSelect} className="rounded-xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: active ? '#7C3AED' : 'var(--border)', background: 'var(--surface)', boxShadow: active ? '0 0 0 2px #7C3AED' : undefined }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {active ? <span className="rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white" style={{ background: '#7C3AED' }}>ACTIV</span> : null}
      </div>
      {/* mini-preview */}
      <div className="mt-3 rounded-lg border p-2.5" style={{ borderColor: mode === 'dark' ? '#2A2738' : 'var(--border)', background: bg }}>
        <div className="flex gap-1.5">
          <div className="h-6 w-6 rounded-md" style={{ background: chip }} />
          <div className="flex flex-1 flex-col justify-center gap-1">
            <div className="h-1.5 w-3/4 rounded-full" style={{ background: fg, opacity: 0.85 }} />
            <div className="h-1.5 w-1/2 rounded-full" style={{ background: fg, opacity: 0.35 }} />
          </div>
        </div>
        <p className="mt-2 text-[10px] font-semibold" style={{ color: fg, opacity: 0.75 }}>{sub}</p>
      </div>
    </button>
  );
  return <><div className="mb-6 flex items-center justify-between gap-4"><div><h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Teme</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Setează independent aspectul panoului de administrare și al interfeței angajaților/tabletei.</p></div><button onClick={() => setShowCreate(true)} className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white transition" style={{ background: 'var(--button)' }}><Plus size={17} /> Creează temă</button></div>
<div className="grid gap-6 lg:grid-cols-2">
<div className="rounded-xl border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: 'var(--border)' }}>
<h3 className="text-sm font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-primary)' }}>Tema panou administrator</h3>
<p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>Controlează aspectul panoului de administrare.</p>
<div className="mt-4 grid gap-3 sm:grid-cols-2">
<ModeCard mode="light" label="SERVIX LIGHT" sub="Alb + mov SERVIX, carduri albe" active={adminTheme === 'light'} onSelect={() => { onChangeAdminTheme('light'); resetPreview(); }} bg="#ffffff" fg="#211d33" chip="#7c3aed" />
<ModeCard mode="dark" label="SERVIX DARK" sub="Mov închis, carduri dark" active={adminTheme === 'dark'} onSelect={() => { onChangeAdminTheme('dark'); resetPreview(); }} bg="#181622" fg="#F3F4F6" chip="#8B5CF6" />
</div>
</div>
<div className="rounded-xl border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: 'var(--border)' }}>
<h3 className="text-sm font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-primary)' }}>Tema angajați + tabletă</h3>
<p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>Controlează aspectul interfeței angajaților și al tabletelor.</p>
<div className="mt-4 grid gap-3 sm:grid-cols-2">
<ModeCard mode="light" label="SERVIX LIGHT" sub="Alb + mov SERVIX, carduri albe" active={employeeTheme === 'light'} onSelect={() => { onChangeEmployeeTheme('light'); resetPreview(); }} bg="#ffffff" fg="#211d33" chip="#7c3aed" />
<ModeCard mode="dark" label="SERVIX DARK" sub="Mov închis, carduri dark" active={employeeTheme === 'dark'} onSelect={() => { onChangeEmployeeTheme('dark'); resetPreview(); }} bg="#181622" fg="#F3F4F6" chip="#A78BFA" />
</div>
</div>
</div>
<p className="mt-4 text-xs" style={{ color: 'var(--text-secondary)' }}>Cele două setări sunt complet independente — poți alege orice combinație (ex: Admin LIGHT + Angajați DARK).</p>
<div className="mt-6 grid gap-6 lg:grid-cols-2"><div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Teme personalizate administrator</h3><div className="grid gap-3 sm:grid-cols-2">{adminThemes.map((t: Theme) => <ThemeCard key={t.id} theme={t} onPreview={() => applyPreview(t.colors)} onRefresh={onRefresh} />)}</div></div><div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Teme personalizate tabletă</h3><div className="grid gap-3 sm:grid-cols-2">{employeeThemes.map((t: Theme) => <ThemeCard key={t.id} theme={t} onPreview={() => applyPreview(t.colors)} onRefresh={onRefresh} />)}</div></div></div>{previewColors && <div className="mt-4 flex items-center gap-3"><button onClick={resetPreview} className="rounded-lg border px-4 py-2 text-sm font-bold transition" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Resetează preview</button></div>}{showCreate && <CreateThemeModal onClose={() => setShowCreate(false)} onSaved={async () => { setShowCreate(false); await onRefresh(); }} />}</>;
}

function ThemeCard({ theme, onPreview, onRefresh }: { theme: Theme; onPreview: () => void; onRefresh: () => Promise<void> }) {
  const [active, setActive] = useState(false);
  useEffect(() => { const stored = localStorage.getItem('servix_admin_theme'); if (stored === theme.name) setActive(true); }, [theme.name]);
  const handleSave = async (): Promise<void> => {
    localStorage.setItem('servix_admin_theme', theme.name);
    applyTheme(theme.colors);
    setActive(true);
  };
  const handleDelete = async (): Promise<void> => {
    if (!theme.is_custom) return;
    if (!window.confirm(`Ștergi tema "${theme.name}"?`)) return;
    await supabase.from('themes').delete().eq('id', theme.id);
    await onRefresh();
  };
  const swatches = Object.entries(theme.colors).filter(([k]) => k.startsWith('--') && !k.includes('text') && !k.includes('border')).slice(0, 6);
  return <div className={`rounded-xl border bg-[var(--surface)] p-4 shadow-sm transition ${active ? 'ring-2' : ''}`} style={{ borderColor: 'var(--border)', boxShadow: active ? '0 0 0 2px var(--primary)' : undefined }}><div className="flex items-center justify-between"><span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{theme.name}</span>{theme.is_custom && <IconButton label="Șterge" onClick={handleDelete} tone="danger"><Trash2 size={14} /></IconButton>}</div><div className="mt-3 flex gap-1.5">{swatches.map(([k, v]) => <div key={k} className="h-8 w-8 rounded-lg" style={{ background: v }} />)}</div><div className="mt-4 flex gap-2"><button onClick={onPreview} className="flex-1 rounded-lg border px-3 py-2 text-xs font-bold transition" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Previzualizează</button><button onClick={handleSave} className="flex-1 rounded-lg px-3 py-2 text-xs font-bold text-white transition" style={{ background: 'var(--button)' }}>Salvează</button></div></div>;
}

function CreateThemeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const colorKeys: [string, string][] = [
    ['--primary','Culoare principală'],['--secondary','Secundară'],['--accent','Accent'],
    ['--background','Fundal'],['--surface','Surface'],['--sidebar','Sidebar'],['--card','Card'],
    ['--button','Buton'],['--text-primary','Text principal'],['--text-secondary','Text secundar'],
    ['--border','Border'],['--success','Succes'],['--warning','Warning'],['--danger','Danger'],['--info','Info'],
  ];
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'admin' | 'employee'>('employee');
  const [colors, setColors] = useState<ThemeColors>({
    '--primary': '#7c3aed','--secondary': '#8b5cf6','--accent': '#a78bfa',
    '--background': '#f5f4fb','--surface': '#ffffff','--sidebar': '#ffffff','--card': '#ffffff',
    '--button': '#7c3aed','--text-primary': '#211d33','--text-secondary': '#6f688c',
    '--border': '#e5e2f2','--success': '#059669','--warning': '#d97706','--danger': '#dc2626','--info': '#0284c7',
  });
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<void> => {
    if (!name.trim()) return;
    setSaving(true);
    await supabase.from('themes').insert({ name: name.trim(), scope, is_custom: true, colors });
    clearTheme();
    await onSaved();
    setSaving(false);
  };
  return <Modal title="Creează temă" onClose={onClose}><div className="space-y-5 p-6"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Nume temă<input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="Ex: SERVIX CUSTOM" className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--primary)]" /></label><label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Scope<select value={scope} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setScope(e.target.value as 'admin' | 'employee')} className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-semibold outline-none"><option value="employee">Angajat</option><option value="admin">Administrator</option></select></label></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{colorKeys.map(([key, label]) => <label key={key} className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{label}<div className="mt-2 flex items-center gap-2"><input type="color" value={colors[key]} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const next = { ...colors, [key]: e.target.value }; setColors(next); applyTheme(next); }} className="h-9 w-9 cursor-pointer rounded border border-[var(--border)]" /><input value={colors[key]} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const next = { ...colors, [key]: e.target.value }; setColors(next); applyTheme(next); }} className="h-9 flex-1 rounded-lg border border-[var(--border)] px-2 text-xs font-mono outline-none" /></div></label>)}</div><div className="flex justify-end gap-3 border-t border-[var(--border)] pt-5"><button onClick={() => { clearTheme(); onClose(); }} className="rounded-lg px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--border)]">Anulează</button><button onClick={save} disabled={saving || !name.trim()} className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold text-white transition disabled:bg-[var(--border)] disabled:text-[var(--text-secondary)]" style={{ background: 'var(--button)' }}><Save size={16} /> Salvează tema</button></div></div></Modal>;
}

// ============================================================
// EMPLOYEES VIEW
// ============================================================
function EmployeesView({ employees, cars, onRefresh }: { employees: Employee[]; cars: Car[]; onRefresh: () => Promise<void> }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const toggleActive = async (emp: Employee): Promise<void> => {
    await supabase.from('employees').update({ active: !emp.active }).eq('id', emp.id);
    await onRefresh();
  };
  const deleteDemo = async (emp: Employee): Promise<void> => {
    if (!emp.is_demo) return;
    if (!window.confirm(`Ștergi angajatul demo „${emp.name}"? Se vor șterge și mașinile/lucrările demo alocate.`)) return;
    const demoCars = cars.filter((c: Car) => c.assigned_employee_id === emp.id && c.is_demo);
    for (const c of demoCars) {
      await supabase.from('jobs').delete().eq('car_id', c.id);
      await supabase.from('cars').delete().eq('id', c.id);
    }
    await supabase.from('activity_log').delete().eq('employee_id', emp.id).eq('is_demo', true);
    await supabase.from('time_entries').delete().eq('employee_id', emp.id).eq('is_demo', true);
    await supabase.from('employees').delete().eq('id', emp.id);
    await onRefresh();
  };
  const empList = employees.filter((e: Employee) => e.role === 'employee');
  return <div><div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Angajați</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Adaugă, editează, activează sau șterge angajați.</p></div><button onClick={() => setShowAdd(true)} className="flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white transition" style={{ background: 'var(--button)' }}><Plus size={17} /> Adaugă angajat</button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{empList.map((e: Employee) => { const assigned = cars.filter((c: Car) => c.assigned_employee_id === e.id); return <div key={e.id} className="rounded-xl border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: 'var(--border)' }}><div className="flex items-start justify-between"><div className="flex items-center gap-3">{e.avatar_url ? <img src={e.avatar_url} alt={e.name} className="h-11 w-11 rounded-full object-cover" /> : <span className="flex h-11 w-11 items-center justify-center rounded-full font-bold" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>{e.name[0]}</span>}<div><h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>{e.name} {e.is_demo && <span className="ml-1 rounded bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] px-1.5 py-0.5 align-middle text-[9px] font-bold tracking-[0.12em] text-[var(--warning)]">DEMO</span>}</h3><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{e.username ?? 'Angajat service'}</p><span className={`mt-1 inline-block rounded px-2 py-0.5 text-[9px] font-bold tracking-[0.12em] ${e.active ? 'bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]' : 'bg-[var(--border)] text-[var(--text-secondary)]'}`}>{e.active ? 'ACTIV' : 'INACTIV'}</span></div></div><div className="flex gap-1.5"><IconButton label="Editează" onClick={() => setEditing(e)}><Settings size={16} /></IconButton>{e.is_demo ? <IconButton label="Șterge" onClick={() => deleteDemo(e)} tone="danger"><Trash2 size={16} /></IconButton> : <IconButton label={e.active ? 'Dezactivează' : 'Activează'} onClick={() => toggleActive(e)}>{e.active ? <Pause size={16} /> : <Play size={16} />}</IconButton>}</div></div><div className="mt-5 flex items-center justify-between border-t pt-4" style={{ borderColor: 'var(--border)' }}><span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Mașini alocate</span><span className="font-bold" style={{ color: 'var(--text-primary)' }}>{assigned.length}</span></div>{assigned.slice(0, 5).map((c: Car) => <div key={c.id} className="mt-2 flex items-center justify-between text-xs"><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{c.license_plate}</span><Badge value={getCarStatus(c.jobs ?? [])} compact /></div>)}{assigned.length > 5 && <p className="mt-2 text-xs text-[var(--text-secondary)]">+{assigned.length - 5} mai mult</p>}</div>; })}</div>{showAdd && <EmployeeModal mode="add" onClose={() => setShowAdd(false)} onSaved={async () => { setShowAdd(false); await onRefresh(); }} />}{editing && <EmployeeModal mode="edit" employee={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onRefresh(); }} />}</div>;
}

function EmployeeModal({ mode, employee, onClose, onSaved }: { mode: 'add' | 'edit'; employee?: Employee; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: employee?.name ?? '', username: employee?.username ?? '', avatar_url: employee?.avatar_url ?? '', active: employee?.active ?? true, access_code: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [codeMsg, setCodeMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;
    const { error: upErr } = await supabase.storage.from('employee-photos').upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (upErr) { setError('Eroare la încărcarea foto: ' + upErr.message); setUploadingPhoto(false); return; }
    const { data: urlData } = supabase.storage.from('employee-photos').getPublicUrl(filePath);
    const publicUrl = urlData.publicUrl;
    setForm({ ...form, avatar_url: publicUrl });
    if (mode === 'edit' && employee) { await supabase.from('employees').update({ avatar_url: publicUrl }).eq('id', employee.id); }
    setUploadingPhoto(false);
  };
  const save = async (): Promise<void> => {
    if (!form.name.trim()) return;
    setSaving(true); setError('');
    if (mode === 'add') {
      const { error: err } = await supabase.from('employees').insert({ name: form.name.trim(), username: form.username.trim() || null, avatar_url: form.avatar_url.trim() || null, active: form.active, role: 'employee' });
      if (err) setError(err.message);
      else await onSaved();
    } else if (employee) {
      const { error: err } = await supabase.from('employees').update({ name: form.name.trim(), username: form.username.trim() || null, avatar_url: form.avatar_url.trim() || null, active: form.active }).eq('id', employee.id);
      if (err) setError(err.message);
      else await onSaved();
    }
    setSaving(false);
  };
  const saveAccessCode = async (): Promise<void> => {
    if (!employee || !form.access_code.trim()) return;
    setCodeMsg('');
    const { data, error: err } = await supabase.rpc('set_employee_access_code', { p_employee_id: employee.id, p_code: form.access_code.trim() });
    if (err) { setCodeMsg('Eroare la salvarea codului.'); return; }
    if (data && data.ok === false) { setCodeMsg(String(data.reason)); return; }
    setCodeMsg('Cod salvat cu succes.'); setForm({ ...form, access_code: '' });
  };
  const resetAccessCode = async (): Promise<void> => {
    if (!employee) return;
    if (!window.confirm('Sigur resetezi codul de acces? Angajatul nu va mai putea intra fără un cod nou.')) return;
    await supabase.from('employees').update({ access_code: null }).eq('id', employee.id);
    setCodeMsg('Cod resetat.');
  };
  return <Modal title={mode === 'add' ? 'Adaugă angajat' : `Editează ${employee?.name ?? ''}`} onClose={onClose}><div className="space-y-5 p-6">{error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}<Field label="Nume și prenume" value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} placeholder="Sami Popescu" /><Field label="Username / identificator" value={form.username} onChange={(v: string) => setForm({ ...form, username: v })} placeholder="sami.p" /><div><label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Fotografie profil</label><div className="mt-2 flex items-center gap-4">{form.avatar_url ? <img src={form.avatar_url} alt="avatar" className="h-16 w-16 rounded-full object-cover" /> : <span className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>{(form.name || '?')[0]}</span>}<button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--card)]"><Image size={16} /> {form.avatar_url ? 'Schimbă poza' : '+ Adaugă poză'}</button>{form.avatar_url && <button onClick={() => setForm({ ...form, avatar_url: '' })} className="text-sm font-bold text-red-500 hover:text-red-700">Elimină</button>}</div><input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e: React.ChangeEvent<HTMLInputElement>) => void handlePhotoUpload(e)} /></div><label className="flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]"><input type="checkbox" checked={form.active} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, active: e.target.checked })} /> Activ</label>{mode === 'edit' && employee && <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"><div className="mb-3 flex items-center gap-2"><KeyRound size={16} className="text-[var(--text-secondary)]" /><h3 className="text-sm font-bold text-[var(--text-primary)]">Cod acces angajat</h3></div><div className="flex gap-2"><input type="password" value={form.access_code} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, access_code: e.target.value })} placeholder="Cod nou..." className="h-11 flex-1 rounded-lg border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--primary)]" /><button onClick={() => void saveAccessCode()} disabled={!form.access_code.trim()} className="rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:bg-[var(--border)]" style={{ background: 'var(--button)' }}><Save size={14} /> Setează</button><button onClick={() => void resetAccessCode()} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--border)]">Resetează</button></div>{codeMsg && <p className="mt-2 text-sm font-semibold text-[var(--text-secondary)]">{codeMsg}</p>}{employee.access_code && <p className="mt-2 text-xs text-[var(--text-secondary)]">Cod activ setat (nu se afișează din motive de siguranță)</p>}</div>}<div className="flex justify-end gap-3 border-t border-[var(--border)] pt-5"><button onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--border)]">Anulează</button><button onClick={save} disabled={saving || !form.name.trim()} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white transition disabled:bg-[var(--border)] disabled:text-[var(--text-secondary)]" style={{ background: 'var(--button)' }}>{saving ? 'Se salvează...' : 'Salvează'}</button></div></div></Modal>;
}

// ============================================================
// SETTINGS VIEW
// ============================================================
function DemoDataManager({ employees, cars, onChanged }: { employees: Employee[]; cars: Car[]; onChanged: () => Promise<void> }) {
  const [activityCount, setActivityCount] = useState(0);
  const demoEmployees = employees.filter((e: Employee) => e.is_demo);
  const demoCars = cars.filter((c: Car) => c.is_demo);
  const demoJobs = demoCars.reduce((total: number, c: Car) => total + (c.jobs?.filter((j: Job) => j.is_demo).length ?? 0), 0);
  useEffect(() => { const load = async (): Promise<void> => { const { count } = await supabase.from('activity_log').select('id', { count: 'exact', head: true }).eq('is_demo', true); setActivityCount(count ?? 0); }; void load(); }, [employees, cars]);
  const deleteAll = async (): Promise<void> => {
    if (!window.confirm('Ești sigur că vrei să ștergi toate datele DEMO? Se vor șterge angajați demo, mașini demo, lucrări demo și istoricul demo. Datele reale nu vor fi afectate.')) return;
    await supabase.rpc('delete_all_demo_data'); await onChanged();
  };
  return <div className="mb-5 rounded-xl border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-[var(--warning)]"><Cog size={16} /></span><h3 className="font-bold text-[var(--text-primary)]">Gestionează date demo</h3></div><p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">Datele marcate DEMO pot fi șterse pentru a curăța mediul de test. Datele reale nu au buton de ștergere.</p></div><button onClick={deleteAll} disabled={demoEmployees.length === 0} className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[var(--surface)] px-4 py-2.5 text-sm font-bold text-[var(--warning)] disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={16} /> ȘTERGE TOATE DATELE DEMO</button></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><DemoCount label="Angajați demo" value={demoEmployees.length} /><DemoCount label="Mașini demo" value={demoCars.length} /><DemoCount label="Lucrări demo" value={demoJobs} /><DemoCount label="Istoric demo" value={activityCount} /></div></div>;
}
function DemoCount({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--surface)]/70 px-3 py-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--warning)]">{label}</p><p className="mt-1 text-xl font-bold text-[var(--text-primary)]">{value}</p></div>; }

function BackupSection({ employees, cars }: { employees: Employee[]; cars: Car[] }) {
  const [msg, setMsg] = useState('');
  const exportBackup = (): void => {
    const data = { exported_at: new Date().toISOString(), employees, cars };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `servix_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('Backup exportat cu succes.');
  };
  const importBackup = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (!window.confirm('Atenție: importul poate modifica datele existente. Continui?')) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const data = JSON.parse(String(reader.result)) as { employees?: Employee[]; cars?: Array<Car & { jobs?: Job[]; plate_history?: PlateHistoryEntry[]; mileage_log?: MileageLogEntry[] }> };
          const employees = data.employees ?? [];
          const cars = data.cars ?? [];
          const jobs: Job[] = [];
          const plates: PlateHistoryEntry[] = [];
          const mileage: MileageLogEntry[] = [];
          for (const car of cars) {
            if (Array.isArray(car.jobs)) jobs.push(...car.jobs);
            if (Array.isArray(car.plate_history)) plates.push(...car.plate_history);
            if (Array.isArray(car.mileage_log)) mileage.push(...car.mileage_log);
          }
          // 1. Employees
          if (employees.length > 0) {
            const clean = employees.map(({ ...e }) => e);
            const { error } = await supabase.from('employees').upsert(clean);
            if (error) throw new Error(`angajați: ${error.message}`);
          }
          // 2. Cars (strip nested relation arrays before upsert)
          if (cars.length > 0) {
            const clean = cars.map((c) => { const { jobs: _j, plate_history: _p, mileage_log: _m, ...rest } = c; return rest as Record<string, unknown>; });
            const { error } = await supabase.from('cars').upsert(clean);
            if (error) throw new Error(`mașini: ${error.message}`);
          }
          // 3. Child tables
          if (jobs.length > 0) {
            const { error } = await supabase.from('jobs').upsert(jobs);
            if (error) throw new Error(`lucrări: ${error.message}`);
          }
          if (plates.length > 0) {
            const { error } = await supabase.from('plate_history').upsert(plates);
            if (error) throw new Error(`istoric numere: ${error.message}`);
          }
          if (mileage.length > 0) {
            const { error } = await supabase.from('mileage_log').upsert(mileage);
            if (error) throw new Error(`kilometraj: ${error.message}`);
          }
          setMsg(`Backup importat: ${employees.length} angajați, ${cars.length} mașini, ${jobs.length} lucrări.`);
        } catch (e) {
          setMsg(e instanceof Error ? `Eroare import: ${e.message}` : 'Eroare la import.');
        }
      };
      void reader.readAsText(file);
    };
    input.click();
  };
  return <div className="rounded-[18px] border bg-[var(--surface)] p-6" style={{ borderColor: 'var(--border)' }}><div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}><Upload size={18} /></span><div><h3 className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>Backup & restaurare</h3><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Exportă sau importă datele aplicației.</p></div></div><div className="flex items-center gap-3 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--success)' }} /><div><p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Ultimul backup</p><p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>24 Mai 2024, 23:45</p></div><ShieldCheck size={20} style={{ color: 'var(--primary)' }} /></div></div><div className="mt-5 flex flex-wrap gap-3"><button onClick={exportBackup} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white" style={{ background: 'var(--button)' }}><Download size={16} /> EXPORTĂ BACKUP</button><button onClick={importBackup} className="flex h-12 items-center gap-2 rounded-lg border bg-[var(--surface)] px-8 text-sm font-bold transition hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}><Upload size={16} /> IMPORTĂ BACKUP</button></div>{msg && <p className={`mt-4 text-sm font-semibold ${msg.startsWith('Eroare') ? 'text-red-600' : 'text-emerald-600'}`}>{msg}</p>}</div>;
}

// ============================================================
// SETTINGS VIEW — UI redesign după machetă (funcționalitate păstrată)
// ============================================================
// Tokenuri din tema activa (fara culori hardcodate) — aceeasi interfata in Light si Dark.
const SV = { purple: 'var(--primary)', navy: 'var(--text-primary)', sec: 'var(--text-secondary)', muted: 'var(--text-muted)', border: 'var(--border)', lav: 'color-mix(in srgb, var(--primary) 12%, transparent)' } as const;

function SettingsEmpField({ label, placeholder, value, onChange, icon, type = 'text' }: { label: string; placeholder?: string; value: string; onChange: (v: string) => void; icon: React.ElementType; type?: string }) {
  return <label className="block text-[13px] font-semibold" style={{ color: SV.muted }}>{label}<span className="relative mt-2 block"><span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">{createElement(icon, { size: 15, style: { color: SV.muted } })}</span><input type={type} value={value} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} placeholder={placeholder} className="h-[50px] w-full rounded-lg border bg-[var(--surface)] pl-10 pr-3 text-[15px] font-medium outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--primary)]" style={{ borderColor: SV.border, color: SV.navy }} /></span></label>;
}

// ============================================================
// AUTOMATIZARE EVENIMENTE PER ANGAJAT (Manual/Automat)
// Setările se salvează individual, per angajat, în tabelul
// employee_event_settings. Lipsește rândul => totul AUTOMAT
// (comportamentul actual). Nu schimbă logica orelor suplimentare.
// ============================================================
function EventModesCard({ employees, onRefresh }: { employees: Employee[]; onRefresh: () => Promise<void> }) {
  type ModeKey = 'work_start_mode' | 'break_start_mode' | 'break_end_mode' | 'work_end_mode';
  const [modes, setModes] = useState<Record<string, Record<ModeKey, EventMode>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void (async () => {
      const { data, error: err } = await supabase.from('employee_event_settings').select('*');
      if (err) { setError(err.message); return; }
      const map: Record<string, Record<ModeKey, EventMode>> = {};
      for (const row of (data ?? []) as EmployeeEventSettings[]) {
        map[row.employee_id] = { work_start_mode: row.work_start_mode, break_start_mode: row.break_start_mode, break_end_mode: row.break_end_mode, work_end_mode: row.work_end_mode };
      }
      setModes(map);
    })();
  }, [employees]);
  const eventRows: Array<[ModeKey, string]> = [
    ['work_start_mode', 'Început program (08:00)'],
    ['break_start_mode', 'Început pauză (13:00)'],
    ['break_end_mode', 'Sfârșit pauză (14:00)'],
    ['work_end_mode', 'Sfârșit program (18:00)'],
  ];
  const save = async (employeeId: string): Promise<void> => {
    setSavingId(employeeId); setError(''); setSavedId(null);
    const current = modes[employeeId] ?? { work_start_mode: 'auto', break_start_mode: 'auto', break_end_mode: 'auto', work_end_mode: 'auto' } as Record<ModeKey, EventMode>;
    const { error: err } = await supabase.from('employee_event_settings').upsert({ employee_id: employeeId, ...current }, { onConflict: 'employee_id' });
    if (err) { setError(err.message); } else { setSavedId(employeeId); window.setTimeout(() => setSavedId((id) => (id === employeeId ? null : id)), 2500); await onRefresh(); }
    setSavingId(null);
  };
  const staff = employees.filter((e: Employee) => e.role === 'employee');
  return <div className="rounded-[18px] border bg-[var(--surface)] p-6" style={{ borderColor: SV.border }}>
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: SV.lav, color: SV.purple }}><Clock size={18} /></span>
      <div><h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>Automatizare evenimente (per angajat)</h3>
      <p className="mt-0.5 text-sm" style={{ color: SV.sec }}>Alege pentru fiecare angajat și fiecare eveniment dacă se execută automat la ora stabilită sau manual de către angajat. Regulile pentru pauză și orele suplimentare rămân neschimbate.</p></div>
    </div>
    {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">{error}</div>}
    <div className="mt-5 space-y-4">
      {staff.length === 0 && <p className="text-sm" style={{ color: SV.sec }}>Nu există angajați.</p>}
      {staff.map((e: Employee) => {
        const current = modes[e.id] ?? { work_start_mode: 'auto', break_start_mode: 'auto', break_end_mode: 'auto', work_end_mode: 'auto' } as Record<ModeKey, EventMode>;
        return <div key={e.id} className="rounded-[12px] border p-4" style={{ borderColor: SV.border }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {e.avatar_url ? <img src={e.avatar_url} alt={e.name} className="h-8 w-8 rounded-full object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold" style={{ background: SV.lav, color: SV.purple }}>{e.name[0]}</span>}
              <span className="text-sm font-bold" style={{ color: SV.navy }}>{e.name}</span>
            </div>
            <button onClick={() => void save(e.id)} disabled={savingId !== null} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50" style={{ background: SV.purple }}>
              <Check size={13} /> {savingId === e.id ? 'Se salvează...' : savedId === e.id ? 'Salvat ✓' : 'Salvează'}
            </button>
          </div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {eventRows.map(([key, label]) => <label key={key} className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: SV.muted }}>{label}
              <select value={current[key]} onChange={(ev: React.ChangeEvent<HTMLSelectElement>) => setModes({ ...modes, [e.id]: { ...current, [key]: ev.target.value as EventMode } })} className="mt-1.5 h-[42px] w-full rounded-[10px] border bg-[var(--surface)] px-2.5 text-[13px] font-semibold outline-none focus:border-[var(--primary)]" style={{ borderColor: SV.border, color: SV.navy }}>
                <option value="auto">Automat</option>
                <option value="manual">Manual</option>
              </select>
            </label>)}
          </div>
        </div>;
      })}
    </div>
  </div>;
}

function SettingsView({ schedule, rates, employees, cars, onRefresh, onGoToEmployees }: { schedule: Schedule | null; rates: Rates | null; employees: Employee[]; cars: Car[]; onRefresh: () => Promise<void>; onGoToEmployees?: () => void }) {
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ work_start: schedule?.work_start?.slice(0, 5) ?? '07:00', break_start: schedule?.break_start?.slice(0, 5) ?? '13:00', break_end: schedule?.break_end?.slice(0, 5) ?? '14:00', work_end: schedule?.work_end?.slice(0, 5) ?? '18:00', normal_rate: rates?.normal_rate ?? 100, urgent_rate: rates?.urgent_rate ?? 150, warranty_rate: rates?.warranty_rate ?? 0, overtime_rate: rates?.overtime_rate ?? 150 });
  const save = async (): Promise<void> => {
    if (schedule) await supabase.from('work_schedule').update({ work_start: form.work_start, work_end: form.work_end, break_start: form.break_start, break_end: form.break_end }).eq('id', schedule.id);
    if (rates) await supabase.from('rates').update({ normal_rate: form.normal_rate, urgent_rate: form.urgent_rate, warranty_rate: form.warranty_rate, overtime_rate: form.overtime_rate }).eq('id', rates.id);
    setMessage('Setările au fost salvate'); await onRefresh(); window.setTimeout(() => setMessage(''), 2500);
  };
  // UI-only: formularul din panoul drept — aceeași inserare ca EmployeeModal (mode 'add').
  const [empForm, setEmpForm] = useState({ name: '', email: '', phone: '', role: '', salary: '' });
  const [empError, setEmpError] = useState('');
  const [empSaving, setEmpSaving] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const addEmployee = async (): Promise<void> => {
    if (!empForm.name.trim()) { setEmpError('Numele complet este obligatoriu.'); return; }
    setEmpSaving(true); setEmpError('');
    const { error: err } = await supabase.from('employees').insert({ name: empForm.name.trim(), username: empForm.email.trim() || null, avatar_url: null, active: true, role: empForm.role === 'admin' ? 'admin' : 'employee' });
    if (err) { setEmpError(err.message); } else { setEmpForm({ name: '', email: '', phone: '', role: '', salary: '' }); await onRefresh(); }
    setEmpSaving(false);
  };
  const empList = employees.filter((e: Employee) => e.role === 'employee').slice(0, 3);
  const timeFields: Array<['work_start' | 'break_start' | 'break_end' | 'work_end', string]> = [['work_start', 'Început'], ['break_start', 'Pauză de la'], ['break_end', 'Pauză până la'], ['work_end', 'Sfârșit']];
  const rateTiles: Array<{ key: 'normal_rate' | 'urgent_rate' | 'warranty_rate' | 'overtime_rate'; label: string; bg: string; dot: string; Icon: React.ElementType }> = [
    { key: 'normal_rate', label: 'Normal', bg: 'color-mix(in srgb, var(--success) 10%, transparent)', dot: 'var(--success)', Icon: DollarSign },
    { key: 'urgent_rate', label: 'Urgent', bg: 'color-mix(in srgb, var(--warning) 10%, transparent)', dot: 'var(--warning)', Icon: Zap },
    { key: 'warranty_rate', label: 'Garanție', bg: 'color-mix(in srgb, var(--info) 10%, transparent)', dot: 'var(--info)', Icon: ShieldCheck },
    { key: 'overtime_rate', label: 'Ore supl.', bg: 'color-mix(in srgb, var(--primary) 10%, transparent)', dot: 'var(--primary)', Icon: Clock },
  ];
  return <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
<div className="min-w-0 flex-1 space-y-6">
<div className="relative">
<Cog size={140} className="pointer-events-none absolute -top-12 right-0 hidden opacity-[0.07] xl:block" style={{ color: SV.purple }} />
<p className="text-[13px] font-bold uppercase tracking-[0.18em]" style={{ color: SV.purple }}>Control service</p>
<h1 className="mt-2 text-[32px] font-bold leading-tight" style={{ color: SV.navy }}>Setări</h1>
<p className="mt-2 text-sm" style={{ color: SV.sec }}>Configurează programul de lucru, tarifele și preferințele aplicației.</p>
</div>
<DemoDataManager employees={employees} cars={cars} onChanged={onRefresh} />
<div className="rounded-[18px] border bg-[var(--surface)] p-6" style={{ borderColor: SV.border }}>
<div className="flex items-start gap-3">
<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: SV.lav, color: SV.purple }}><Calendar size={18} /></span>
<div><h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>Program de lucru</h3><p className="mt-0.5 text-sm" style={{ color: SV.sec }}>Pauza este automată și nu intră în timpul lucrat.</p></div>
</div>
<div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
{timeFields.map(([key, label]) => <label key={key} className="block text-[13px] font-semibold" style={{ color: SV.muted }}>{label}<span className="relative mt-2 block"><input type="time" value={form[key]} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value })} className="h-[50px] w-full rounded-[10px] border bg-[var(--surface)] px-3 pr-9 text-[15px] font-semibold outline-none focus:border-[var(--primary)]" style={{ borderColor: SV.border, color: SV.navy }} /><Clock size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: SV.muted }} /></span></label>)}
</div>
</div>
<div className="rounded-[18px] border bg-[var(--surface)] p-6" style={{ borderColor: SV.border }}>
<div className="flex items-start gap-3">
<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' }}><DollarSign size={18} /></span>
<div><h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>Tarife pe oră</h3><p className="mt-0.5 text-sm" style={{ color: SV.sec }}>Valorile sunt în lei și se aplică timpului efectiv lucrat.</p></div>
</div>
<div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
{rateTiles.map((t) => <div key={t.key} className="rounded-[10px] p-4" style={{ background: t.bg }}>
<div className="flex items-start justify-between">
<div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: t.dot }} /><span className="text-[13px] font-semibold" style={{ color: SV.sec }}>{t.label}</span></div>
<span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--surface)_75%,transparent)]">{createElement(t.Icon, { size: 15, style: { color: t.dot } })}</span>
</div>
<div className="mt-2 flex items-baseline gap-1">
<input type="number" min="0" value={form[t.key]} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [t.key]: Number(e.target.value) })} className="w-full min-w-0 bg-transparent text-[27px] font-bold leading-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={{ color: SV.navy }} />
<span className="shrink-0 text-xs font-bold" style={{ color: SV.muted }}>LEI</span>
</div>
</div>)}
</div>
</div>
<EventModesCard employees={employees} onRefresh={onRefresh} />
<BackupSection employees={employees} cars={cars} />
<div className="flex flex-col items-center gap-2 py-2">
<button onClick={save} className="flex h-[44px] w-[250px] items-center justify-center gap-2 rounded-lg text-sm font-bold text-white transition hover:brightness-110" style={{ background: SV.purple }}><Check size={16} /> Salvează setările</button>
{message && <span className="text-sm font-semibold text-emerald-600">{message}</span>}
<p className="text-xs" style={{ color: SV.muted }}>Modificările vor fi aplicate imediat.</p>
</div>
</div>
<aside className="w-full shrink-0 xl:w-[360px]">
<div className="rounded-[18px] border bg-[var(--surface)] p-6" style={{ borderColor: SV.border }}>
<div className="flex items-start gap-3">
<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: SV.lav, color: SV.purple }}><UserPlus size={19} /></span>
<div><h3 className="text-[18px] font-bold" style={{ color: SV.navy }}>Adaugă angajat</h3><p className="mt-0.5 text-sm leading-snug" style={{ color: SV.sec }}>Completează datele pentru a adăuga un nou membru în echipă.</p></div>
</div>
{empError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">{empError}</div>}
<div className="mt-5 space-y-4">
<SettingsEmpField label="Nume complet" placeholder="Ex: Ion Popescu" value={empForm.name} onChange={(v: string) => setEmpForm({ ...empForm, name: v })} icon={UserRound} />
<SettingsEmpField label="Email" placeholder="ex: ion.popescu@email.com" value={empForm.email} onChange={(v: string) => setEmpForm({ ...empForm, email: v })} icon={Mail} type="email" />
<SettingsEmpField label="Telefon" placeholder="07XX XXX XXX" value={empForm.phone} onChange={(v: string) => setEmpForm({ ...empForm, phone: v })} icon={Phone} type="tel" />
<label className="block text-[13px] font-semibold" style={{ color: SV.muted }}>Rol<span className="relative mt-2 block">
<select value={empForm.role} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEmpForm({ ...empForm, role: e.target.value })} className="h-[50px] w-full appearance-none rounded-lg border bg-[var(--surface)] pl-10 pr-9 text-[15px] font-medium outline-none focus:border-[var(--primary)]" style={{ borderColor: SV.border, color: empForm.role ? SV.navy : 'var(--text-muted)' }}>
<option value="">Selectează rolul</option>
<option value="employee">Angajat</option>
<option value="admin">Administrator</option>
</select>
<ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: SV.muted }} />
</span></label>
<SettingsEmpField label="Salariu pe oră (lei)" placeholder="Ex: 50" value={empForm.salary} onChange={(v: string) => setEmpForm({ ...empForm, salary: v })} icon={Coins} type="number" />
</div>
<button onClick={() => void addEmployee()} disabled={empSaving} className="mt-6 flex h-[42px] w-full items-center justify-center gap-2 rounded-lg text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60" style={{ background: SV.purple }}><UserPlus size={16} /> {empSaving ? 'Se salvează...' : 'Adaugă angajat'}</button>
<div className="mt-7 border-t pt-6" style={{ borderColor: SV.border }}>
<h4 className="text-[15px] font-bold" style={{ color: SV.navy }}>Angajați existenți</h4>
<div className="mt-4 space-y-4">
{empList.length === 0 && <p className="text-sm" style={{ color: SV.sec }}>Nu există angajați.</p>}
{empList.map((e: Employee) => <div key={e.id} className="flex items-center justify-between">
<div className="flex min-w-0 items-center gap-3">
{e.avatar_url ? <img src={e.avatar_url} alt={e.name} className="h-8 w-8 shrink-0 rounded-full object-cover" /> : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: SV.lav, color: SV.purple }}>{e.name[0]}</span>}
<div className="min-w-0"><p className="truncate text-sm font-bold" style={{ color: SV.navy }}>{e.name}</p><p className="truncate text-xs" style={{ color: SV.muted }}>{e.username ?? 'Mecanic'}</p></div>
</div>
<div className="flex shrink-0 items-center gap-1.5">
<span className="h-1.5 w-1.5 rounded-full" style={{ background: e.active ? 'var(--success)' : SV.border }} />
<button aria-label="Editează" onClick={() => setEditing(e)} className="rounded-md p-1 transition hover:bg-[var(--card)]" style={{ color: SV.muted }}><MoreVertical size={16} /></button>
</div>
</div>)}
</div>
<button onClick={onGoToEmployees} className="mt-6 flex items-center gap-1 text-sm font-bold transition hover:brightness-125" style={{ color: SV.purple }}>Vezi toți angajații →</button>
</div>
</div>
</aside>
{editing && <EmployeeModal mode="edit" employee={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onRefresh(); }} />}
</div>;
}

// ============================================================
// CAR HISTORY MODAL
// ============================================================
function CarHistoryModal({ car, employees, rates, onClose, onRefresh }: { car: Car; employees: Employee[]; rates: Rates | null; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [activity, setActivity] = useState<Array<{ id: string; action: string; detail: string | null; created_at: string }>>([]);
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const [showChangePlate, setShowChangePlate] = useState(false);
  const [newPlate, setNewPlate] = useState('');
  const [plateMsg, setPlateMsg] = useState('');
  // GALERIE FOTO MAȘINĂ — Supabase Storage (bucket 'car-photos') + tabel car_photos
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [carPhotos, setCarPhotos] = useState<CarPhoto[]>(car.car_photos ?? []);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoMsg, setPhotoMsg] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const refreshPhotos = async (): Promise<void> => {
    const { data } = await supabase.from('car_photos').select('*').eq('car_id', car.id).order('created_at');
    setCarPhotos((data ?? []) as CarPhoto[]);
  };
  const handlePhotosUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploadingPhotos(true); setPhotoMsg('');
    for (const file of files) {
      const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!okTypes.includes(file.type)) { setPhotoMsg(`Fișier respins (doar JPG/PNG/WEBP): ${file.name}`); continue; }
      if (file.size > 5 * 1024 * 1024) { setPhotoMsg(`Fișier prea mare (max 5 MB): ${file.name}`); continue; }
      const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
      const path = `${car.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('car-photos').upload(path, file, { cacheControl: '3600', upsert: false });
      if (upErr) { setPhotoMsg('Eroare la încărcare: ' + upErr.message); continue; }
      const { data: urlData } = supabase.storage.from('car-photos').getPublicUrl(path);
      await supabase.from('car_photos').insert({ car_id: car.id, url: urlData.publicUrl });
    }
    await refreshPhotos(); setUploadingPhotos(false);
  };
  const deletePhoto = async (ph: CarPhoto): Promise<void> => {
    if (!window.confirm('Ștergi această fotografie? Acțiunea este definitivă.')) return;
    const marker = '/car-photos/';
    const idx = ph.url.indexOf(marker);
    if (idx !== -1) { const path = ph.url.slice(idx + marker.length); await supabase.storage.from('car-photos').remove([path]); }
    await supabase.from('car_photos').delete().eq('id', ph.id);
    await refreshPhotos();
  };
  const plateHistory = (car.plate_history ?? []).sort((a: PlateHistoryEntry, b: PlateHistoryEntry) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
  const mileageLog = (car.mileage_log ?? []).sort((a: MileageLogEntry, b: MileageLogEntry) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
  useEffect(() => {
    const load = async (): Promise<void> => {
      const [actRes] = await Promise.all([
        supabase.from('activity_log').select('id, action, detail, created_at').eq('car_id', car.id).order('created_at', { ascending: true }),
      ]);
      setActivity((actRes.data ?? []) as Array<{ id: string; action: string; detail: string | null; created_at: string }>);
    };
    void load();
  }, [car.id]);
  const handleChangePlate = async (): Promise<void> => {
    if (!newPlate.trim()) return;
    setPlateMsg('');
    const { data, error } = await supabase.rpc('safe_change_plate', { p_car_id: car.id, p_new_plate: newPlate.toUpperCase() });
    if (error) { setPlateMsg('Eroare la schimbarea numărului.'); return; }
    if (data && data.ok === false) { setPlateMsg(String(data.reason)); return; }
    setShowChangePlate(false); setNewPlate(''); await onRefresh(); setPlateMsg('Număr schimbat cu succes.');
  };
  const generatePDF = (): void => {
    generateReportPdf(`servix_raport_${car.license_plate}.pdf`, buildCarReportLines(car, rates, plateHistory, mileageLog, employees.find((e: Employee) => e.id === car.assigned_employee_id)?.name ?? 'Nealocat'));
  };
  const sortedJobs = [...(car.jobs ?? [])].sort((a: Job, b: Job) => a.order_index - b.order_index);
  // CALCUL PREȚ DIN TARIFELE REALE (Admin → Setări → Tarife pe oră). Fără valori hardcodate.
  const normalRateC = car.is_warranty ? (rates?.warranty_rate ?? 0) : (rates?.normal_rate ?? 0);
  const overtimeRateC = rates?.overtime_rate ?? 0;
  const jobCosts = sortedJobs.map((job: Job) => {
    const ot = job.overtime_seconds ?? 0;
    const nrm = Math.max(0, job.worked_seconds - ot);
    return { job, nH: nrm / 3600, oH: ot / 3600, cost: (nrm / 3600) * normalRateC + (ot / 3600) * overtimeRateC };
  });
  const totalCost = jobCosts.reduce((t, r) => t + r.cost, 0);
  const jobsByYear = useMemo(() => {
    const map = new Map<number, Job[]>();
    sortedJobs.forEach((job: Job) => {
      const year = job.completed_at ? new Date(job.completed_at).getFullYear() : new Date().getFullYear();
      if (!map.has(year)) map.set(year, []);
      map.get(year)!.push(job);
    });
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [sortedJobs]);
  const availableYears = jobsByYear.map(([year]) => year);
  const filteredYears = yearFilter === 'all' ? jobsByYear : jobsByYear.filter(([year]) => year === yearFilter);
  return <Modal title={`Istoric ${car.license_plate}`} onClose={onClose} wide><div className="space-y-6 p-6"><div className="flex flex-wrap items-center gap-3"><Badge value={getCarStatus(car.jobs ?? [])} /><span className="text-sm text-[var(--text-secondary)]">{car.client_name}</span>{car.internal_id && <span className="rounded bg-[var(--border)] px-2 py-1 text-[10px] font-bold tracking-wide text-[var(--text-secondary)]">{car.internal_id}</span>}{car.is_demo && <span className="rounded bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] px-2 py-1 text-[10px] font-bold tracking-[0.14em] text-[var(--warning)]">DEMO</span>}</div><div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"><div className="grid gap-3 sm:grid-cols-3"><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Marcă / Model</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{car.make ?? '—'} {car.model ?? ''}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">VIN</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{car.vin ?? '—'}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Kilometraj</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{formatMileage(car.mileage)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Telefon</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{car.client_phone ?? '—'}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Nivel carburant</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{car.fuel_level ? fuelLabels[car.fuel_level] : '—'}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Termen</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{car.deadline ? new Date(car.deadline).toLocaleDateString('ro-RO') : '—'}</p></div></div>{car.body_observations && <div className="mt-3 border-t border-[var(--border)] pt-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Observații caroserie</p><p className="mt-1 text-sm text-[var(--text-secondary)]">{car.body_observations}</p></div>}{car.photo_url && <div className="mt-3"><img src={car.photo_url} alt={car.license_plate} className="max-h-40 rounded-lg" /></div>}{car.notes && <div className="mt-3 border-t border-[var(--border)] pt-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Note</p><p className="mt-1 text-sm text-[var(--text-secondary)]">{car.notes}</p></div>}</div>
{plateHistory.length > 0 && <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Istoric numere</h3><div className="space-y-2">{plateHistory.map((p: PlateHistoryEntry) => <div key={p.id} className="flex items-center justify-between text-sm"><span className="font-semibold text-[var(--text-primary)]">{p.license_plate}</span><span className="text-xs text-[var(--text-secondary)]">{new Date(p.changed_at).toLocaleDateString('ro-RO')}</span></div>)}</div></div>}
{!showChangePlate ? <button onClick={() => setShowChangePlate(true)} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--card)]"><Hash size={16} /> Schimbă numărul</button> : <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><h3 className="mb-3 text-sm font-bold text-[var(--text-primary)]">Schimbă numărul de înmatriculare</h3><div className="flex gap-2"><input value={newPlate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPlate(e.target.value)} placeholder="Noul număr..." className="h-11 flex-1 rounded-lg border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--primary)]" /><button onClick={() => void handleChangePlate()} disabled={!newPlate.trim()} className="rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:bg-[var(--border)]" style={{ background: 'var(--button)' }}>Salvează</button><button onClick={() => { setShowChangePlate(false); setNewPlate(''); setPlateMsg(''); }} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)]">Anulează</button></div>{plateMsg && <p className="mt-2 text-sm font-semibold text-[var(--text-secondary)]">{plateMsg}</p>}</div>}
{mileageLog.length > 0 && <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Istoric kilometraj</h3><div className="space-y-2">{mileageLog.map((m: MileageLogEntry) => <div key={m.id} className="flex items-center justify-between text-sm"><span className="font-semibold text-[var(--text-primary)]">{formatMileage(m.mileage)}</span><span className="text-xs text-[var(--text-secondary)]">{new Date(m.recorded_at).toLocaleDateString('ro-RO')}</span></div>)}</div></div>}
<div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Istoric mașină</h3><div className="mb-4 flex flex-wrap gap-2"><button onClick={() => setYearFilter('all')} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${yearFilter === 'all' ? 'text-white' : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--primary)]'}`} style={yearFilter === 'all' ? { background: 'var(--button)' } : {}}>Toți anii</button>{availableYears.map((year) => <button key={year} onClick={() => setYearFilter(year)} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${yearFilter === year ? 'text-white' : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--primary)]'}`} style={yearFilter === year ? { background: 'var(--button)' } : {}}>{year}</button>)}</div><div className="space-y-4">{filteredYears.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Nu există lucrări pentru anul selectat.</p> : filteredYears.map(([year, jobs]) => <div key={year}><p className="mb-2 text-lg font-bold text-[var(--text-primary)]">{year}</p><div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">{jobs.map((job: Job) => <div key={job.id} className="flex items-center justify-between gap-4 p-4"><div><p className="font-bold text-[var(--text-primary)]">{job.title}</p><p className="mt-1 text-xs text-[var(--text-secondary)]">{job.completed_at ? new Date(job.completed_at).toLocaleString('ro-RO') : 'În lucru'}</p>{job.description && <p className="mt-1 text-xs text-[var(--text-secondary)]">{job.description}</p>}</div><div className="text-right"><Badge value={job.status} compact /><p className="mt-1 font-mono text-xs text-[var(--text-secondary)]">{formatShortDuration(job.worked_seconds)}</p>{(job.overtime_seconds ?? 0) > 0 && <p className="text-xs font-semibold text-[var(--secondary)]">+{formatShortDuration(job.overtime_seconds ?? 0)} peste program</p>}</div></div>)}</div></div>)}</div></div>
<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Fotografii mașină</h3><button onClick={() => photoInputRef.current?.click()} disabled={uploadingPhotos} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50" style={{ background: 'var(--button)' }}><Image size={14} /> {uploadingPhotos ? 'Se încarcă...' : '+ Adaugă fotografie'}</button></div>
<input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e: React.ChangeEvent<HTMLInputElement>) => void handlePhotosUpload(e)} />
{photoMsg && <p className="mb-2 text-xs font-semibold text-orange-600">{photoMsg}</p>}
{carPhotos.length === 0 ? <p className="py-3 text-sm text-[var(--text-secondary)]">Nu există fotografii. Adaugă poze direct din dispozitiv (PC sau telefon).</p> : <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{carPhotos.map((ph: CarPhoto) => <div key={ph.id} className="group relative">
  <button onClick={() => setPreviewUrl(ph.url)} className="block w-full"><img src={ph.url} alt="Fotografie mașină" className="h-20 w-full rounded-lg object-cover" /></button>
  <button onClick={() => void deletePhoto(ph)} title="Șterge fotografia" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition group-hover:opacity-100"><X size={13} /></button>
</div>)}</div>}</div>
{previewUrl && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6" onClick={() => setPreviewUrl(null)}>
  <img src={previewUrl} alt="Previzualizare" className="max-h-[90vh] max-w-full rounded-xl object-contain" />
  <button className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white" aria-label="Închide"><X size={20} /></button>
</div>}
<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Calcul cost — tarife din Setări</h3>{jobCosts.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Nu există lucrări.</p> : <div className="space-y-2">{jobCosts.map(({ job, nH, oH, cost }) => <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"><span className="font-semibold text-[var(--text-primary)]">{job.title}</span><span className="text-xs text-[var(--text-secondary)]">{nH > 0 && <>{nH.toFixed(2)}h × {normalRateC} lei</>}{oH > 0 && <>{nH > 0 ? ' + ' : ''}{oH.toFixed(2)}h × {overtimeRateC} lei (peste program)</>}</span><span className="font-bold text-[var(--text-primary)]">{cost.toFixed(0)} lei</span></div>)}</div>}
{jobCosts.length > 0 && <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3"><span className="text-sm font-bold uppercase tracking-wide text-[var(--text-secondary)]">Total mașină</span><span className="text-xl font-bold" style={{ color: 'var(--primary)' }}>{totalCost.toFixed(0)} LEI</span></div>}
<p className="mt-2 text-[11px] text-[var(--text-secondary)]">Tarife: normal {normalRateC} lei/oră{car.is_warranty ? ' (garanție)' : ''}, peste program {overtimeRateC} lei/oră — modificate din Admin → Setări.</p></div>
<div className="flex items-center justify-between border-t border-[var(--border)] pt-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Status financiar</p><select defaultValue={car.financial_status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => void supabase.from('cars').update({ financial_status: e.target.value }).eq('id', car.id).then(() => onRefresh())} className={`mt-1 h-9 rounded-lg border px-2 text-sm font-bold ${financialStyles[car.financial_status as FinancialStatus] ?? 'border-[var(--border)] text-[var(--text-secondary)]'}`}>{financialOptions.map((f: FinancialStatus) => <option key={f} value={f}>{financialLabels[f]}</option>)}</select></div><button onClick={generatePDF} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white" style={{ background: 'var(--button)' }}><FileText size={16} /> GENEREAZĂ PDF</button></div>
<div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Activitate</h3><div className="space-y-3">{activity.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Nu există activitate înregistrată.</p> : activity.map((item) => <div key={item.id} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--button)]" /><div><p className="text-sm font-semibold text-[var(--text-primary)]">{item.detail ?? item.action}</p><p className="mt-1 text-xs text-[var(--text-secondary)]">{new Date(item.created_at).toLocaleString('ro-RO')}</p></div></div>)}</div></div></div></Modal>;
}

// ============================================================
// ADD CAR MODAL
// ============================================================
function AddCarModal({ employees, onClose, onSaved }: { employees: Employee[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ license_plate: '', client_name: '', client_phone: '', make: '', model: '', deadline: '', priority: 'normala', assigned_employee_id: '', notes: '', is_warranty: false, vin: '', mileage: '', body_observations: '', fuel_level: '', photo_url: '', jobs: ['Revizie generală'] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (key: string, value: string | boolean): void => setForm({ ...form, [key]: value });
  // FOTOGRAFIE MAȘINĂ — upload direct din dispozitiv prin Supabase Storage ('car-photos')
  const carPhotoInputRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoErr, setPhotoErr] = useState('');
  const handleCarPhoto = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!okTypes.includes(file.type)) { setPhotoErr('Accept doar imagini JPG, PNG sau WEBP.'); return; }
    if (file.size > 5 * 1024 * 1024) { setPhotoErr('Fișierul depășește 5 MB.'); return; }
    setPhotoUploading(true); setPhotoErr('');
    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('car-photos').upload(path, file, { cacheControl: '3600', upsert: false });
    if (upErr) { setPhotoErr('Eroare la încărcare: ' + upErr.message); setPhotoUploading(false); return; }
    const { data: urlData } = supabase.storage.from('car-photos').getPublicUrl(path);
    update('photo_url', urlData.publicUrl);
    setPhotoUploading(false);
  };
  const save = async (): Promise<void> => {
    if (!form.license_plate || !form.client_name) return;
    if (!form.mileage) { setError('Kilometrajul este obligatoriu.'); return; }
    setSaving(true); setError('');
    const { data: car, error: err } = await supabase.from('cars').insert({ license_plate: form.license_plate.toUpperCase(), client_name: form.client_name, client_phone: form.client_phone || null, make: form.make || null, model: form.model || null, deadline: form.deadline || null, priority: form.priority, assigned_employee_id: form.assigned_employee_id || null, notes: form.notes || null, is_warranty: form.is_warranty, vin: form.vin || null, mileage: Number(form.mileage) || null, body_observations: form.body_observations || null, fuel_level: form.fuel_level || null, photo_url: form.photo_url || null }).select().maybeSingle();
    if (err) { setError(err.message); setSaving(false); return; }
    if (!err && car) {
      await supabase.from('mileage_log').insert({ car_id: car.id, mileage: Number(form.mileage), is_demo: false });
      await supabase.from('jobs').insert(form.jobs.filter((j: string) => j.trim()).map((title: string, index: number) => ({ car_id: car.id, title, order_index: index + 1 })));
      await onSaved();
    }
    setSaving(false);
  };
  return <Modal title="Adaugă mașină" onClose={onClose}><div className="space-y-5 p-6"><div className="grid gap-4 sm:grid-cols-2"><Field label="Număr înmatriculare" value={form.license_plate} onChange={(v: string) => update('license_plate', v)} placeholder="TM 27 FXC" /><Field label="Nume client" value={form.client_name} onChange={(v: string) => update('client_name', v)} placeholder="Ion Popescu" /><Field label="Telefon" value={form.client_phone} onChange={(v: string) => update('client_phone', v)} placeholder="0740 000 000" /><Field label="Termen" value={form.deadline} onChange={(v: string) => update('deadline', v)} type="date" /><Field label="Marcă" value={form.make} onChange={(v: string) => update('make', v)} placeholder="Mercedes" list="servix-makes" /><Field label="Model" value={form.model} onChange={(v: string) => update('model', v)} placeholder="Clasa C" list="servix-models" /><Field label="Serie șasiu / VIN (opțional)" value={form.vin} onChange={(v: string) => update('vin', v)} placeholder="WVWZZZ..." /><Field label="Kilometraj (obligatoriu)" value={form.mileage} onChange={(v: string) => update('mileage', v)} type="number" placeholder="150000" /><label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Nivel carburant (opțional)<select value={form.fuel_level} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => update('fuel_level', e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-semibold text-[var(--text-primary)]"><option value="">—</option>{fuelOptions.map((f: FuelLevel) => <option key={f} value={f}>{fuelLabels[f]}</option>)}</select></label><label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Prioritate<select value={form.priority} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => update('priority', e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-semibold text-[var(--text-primary)]"><option value="normala">Normală</option><option value="urgenta">Urgentă</option></select></label><label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Responsabil<select value={form.assigned_employee_id} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => update('assigned_employee_id', e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-semibold text-[var(--text-primary)]"><option value="">Nealocat</option>{employees.filter((e: Employee) => e.role === 'employee').map((e: Employee) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><Field label="URL poză mașină (opțional)" value={form.photo_url} onChange={(v: string) => update('photo_url', v)} placeholder="https://..." /><div><label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Fotografie mașină</label><div className="mt-2 flex items-center gap-3">{form.photo_url ? <img src={form.photo_url} alt="Mașină" className="h-16 w-24 flex-none rounded-lg object-cover" /> : <div className="flex h-16 w-24 flex-none items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }}><CarFront size={26} style={{ color: 'var(--secondary)' }} /></div>}<button onClick={() => carPhotoInputRef.current?.click()} disabled={photoUploading} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-bold text-[var(--secondary)] transition hover:bg-[var(--card)] disabled:opacity-50"><Image size={14} /> {photoUploading ? 'Se încarcă...' : '+ Adaugă fotografie'}</button>{form.photo_url && <button onClick={() => update('photo_url', '')} className="text-xs font-bold text-red-500">Elimină</button>}</div>{photoErr && <p className="mt-1 text-xs font-semibold text-red-500">{photoErr}</p>}<input ref={carPhotoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e: React.ChangeEvent<HTMLInputElement>) => void handleCarPhoto(e)} /></div></div><label className="block text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Observații caroserie (opțional)<textarea value={form.body_observations} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => update('body_observations', e.target.value)} rows={2} className="mt-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]" placeholder="Zgârietură portieră stânga, etc." /></label><label className="flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]"><input type="checkbox" checked={form.is_warranty} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('is_warranty', e.target.checked)} /> În garanție (tarif 0 lei/oră)</label><label className="block text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Note<textarea value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => update('notes', e.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]" placeholder="Informații relevante..." /></label><div><div className="mb-2 flex items-center justify-between"><label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">Lucrări necesare</label><button onClick={() => setForm({ ...form, jobs: [...form.jobs, ''] })} className="text-xs font-bold text-[var(--primary)]">+ Adaugă lucrare</button></div><div className="space-y-2">{form.jobs.map((j: string, i: number) => <input key={i} value={j} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const jobs = [...form.jobs]; jobs[i] = e.target.value; setForm({ ...form, jobs }); }} className="h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--primary)]" placeholder={`Lucrarea ${i + 1}`} />)}</div></div>{error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}<datalist id="servix-makes">{VEHICLE_MAKES.map((m: string) => <option key={m} value={m} />)}</datalist><datalist id="servix-models">{modelsFor(form.make).map((m: string) => <option key={m} value={m} />)}</datalist><div className="flex justify-end gap-3 border-t border-[var(--border)] pt-5"><button onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--border)]">Anulează</button><button onClick={save} disabled={saving || !form.license_plate || !form.client_name || !form.mileage} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white transition disabled:bg-[var(--border)] disabled:text-[var(--text-secondary)]" style={{ background: 'var(--button)' }}>{saving ? 'Se salvează...' : 'Salvează mașina'}</button></div></div></Modal>;
}
function Field({ label, value, onChange, placeholder, type = 'text', list }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; list?: string }) { return <label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{label}<input type={type} value={value} list={list} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} placeholder={placeholder} className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--accent)]" /></label>; }

// ============================================================
// APP
// ============================================================
const getRouteView = (): View => {
  if (typeof window === 'undefined') return 'home';
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === '/admin' ? 'admin' : 'home';
};

export default function App() {
  const [view, setView] = useState<View>(() => getRouteView());
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  // Două teme complet independente: adminTheme (panou admin) + employeeTheme (angajat/tabletă/login)
  const [adminTheme, setAdminTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('servix_theme_admin') === 'dark' ? 'dark' : 'light'));
  const [employeeTheme, setEmployeeTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('servix_theme_employee') === 'light' ? 'light' : 'dark'));
  const changeAdminTheme = (m: 'light' | 'dark'): void => { setAdminTheme(m); localStorage.setItem('servix_theme_admin', m); };
  const changeEmployeeTheme = (m: 'light' | 'dark'): void => { setEmployeeTheme(m); localStorage.setItem('servix_theme_employee', m); };
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const initialSession = typeof window !== 'undefined' ? localStorage.getItem('servix_session') : null;
  const [sessionChecked, setSessionChecked] = useState(false);

  const loadData = async (): Promise<void> => {
    setLoadError('');
    const [empRes, carRes, schedRes, ratesRes, themeRes, apptRes] = await Promise.all([
      supabase.from('employees').select('*').order('name'),
      supabase.from('cars').select('*, jobs(*), plate_history(*), mileage_log(*), car_photos(*)').order('created_at', { ascending: false }),
      supabase.from('work_schedule').select('*').eq('active', true).limit(1).maybeSingle(),
      supabase.from('rates').select('*').eq('active', true).limit(1).maybeSingle(),
      supabase.from('themes').select('*').order('name'),
      supabase.from('appointments').select('*').order('appointment_date', { ascending: true }).order('appointment_time', { ascending: true }),
    ]);
    // Surface Supabase errors instead of silently rendering empty data
    const firstError = empRes.error ?? carRes.error ?? schedRes.error ?? ratesRes.error ?? themeRes.error ?? apptRes.error;
    if (firstError) {
      setLoadError(firstError.message);
      setLoading(false);
      return;
    }
    setEmployees((empRes.data ?? []) as Employee[]);
    setCars((carRes.data ?? []) as Car[]);
    setSchedule(schedRes.data as Schedule | null);
    setRates(ratesRes.data as Rates | null);
    setThemes((themeRes.data ?? []) as Theme[]);
    setAppointments((apptRes.data ?? []) as Appointment[]);
    setLoading(false);
  };

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncViewFromPath = (): void => {
      const path = window.location.pathname.replace(/\/+$/, '') || '/';
      if (path === '/admin') {
        localStorage.setItem('servix_session', 'admin');
        setView('admin');
        return;
      }
      if (path === '/') {
        setView('home');
      }
    };

    syncViewFromPath();
    window.addEventListener('popstate', syncViewFromPath);
    return () => window.removeEventListener('popstate', syncViewFromPath);
  }, []);

  // Restore session after refresh: admin stays in admin, employee stays logged in
  useEffect(() => {
    if (loading || sessionChecked) return;
    setSessionChecked(true);
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.replace(/\/+$/, '') || '/';
      if (path === '/admin') { setView('admin'); return; }
      if (path === '/') { setView('home'); return; }
    }
    if (initialSession === 'admin' && view === 'home') { setView('admin'); return; }
    if (initialSession?.startsWith('employee:') && view === 'home') {
      const id = initialSession.slice('employee:'.length);
      const emp = employees.find((e: Employee) => e.id === id && e.active);
      if (emp) { setEmployee(emp); setView('employee'); }
      else localStorage.removeItem('servix_session');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    const setScheme = (mode: 'light' | 'dark'): void => { document.documentElement.style.colorScheme = mode; };
    if (view === 'employee') {
      applyTheme(employeeTheme === 'dark' ? SERVIX_EMPLOYEE_DARK : SERVIX_EMPLOYEE_LIGHT);
      setScheme(employeeTheme);
    } else if (view === 'admin') {
      if (adminTheme === 'dark') { applyTheme(SERVIX_ADMIN_DARK); }
      else {
        const stored = localStorage.getItem('servix_admin_theme');
        const t = stored ? themes.find((th: Theme) => th.name === stored) : null;
        applyTheme(t?.colors ?? SERVIX_ADMIN_LIGHT);
      }
      setScheme(adminTheme);
    } else {
      // Ecranul „Cine preia tableta” / login — folosește employeeTheme
      if (employeeTheme === 'dark') { applyTheme(SERVIX_EMPLOYEE_DARK); } else { clearTheme(); }
      setScheme(employeeTheme);
    }
  }, [view, themes, adminTheme, employeeTheme]);

  const chooseEmployee = (selected: Employee): void => {
    setEmployee(selected);
    localStorage.setItem('servix_session', `employee:${selected.id}`);
    setView('employee');
  };
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[var(--background)]"><div className="flex items-center gap-3 text-sm font-semibold text-[var(--text-secondary)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--button)]" /> Se încarcă SERVIX...</div></div>;

  if (loadError) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8" style={{ background: 'var(--background)' }}>
      <div className="max-w-md rounded-2xl border bg-[var(--surface)] p-8 text-center shadow-lg" style={{ borderColor: 'var(--border)' }}>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--danger)' }}>Eroare conexiune</p>
        <h1 className="mt-2 text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Nu am putut încărca datele</h1>
        <p className="mt-3 text-sm break-words" style={{ color: 'var(--text-secondary)' }}>{loadError}</p>
        <button onClick={() => { setLoading(true); void loadData(); }} className="mt-6 rounded-lg px-5 py-3 text-sm font-bold text-white" style={{ background: 'var(--button)' }}>Încearcă din nou</button>
      </div>
    </div>
  );

  if (typeof window !== 'undefined' && window.location.hash === '#servicedark') {
    return <ServiceDarkDashboard />;
  }

  return view === 'home'
    ? <Landing employees={employees} onEmployee={chooseEmployee} onAdmin={() => {
        localStorage.setItem('servix_session', 'admin');
        if (typeof window !== 'undefined') {
          window.history.pushState({}, '', '/admin');
        }
        setView('admin');
      }} />
    : view === 'employee' && employee
      ? <PanouAngajat employee={employee} cars={cars} schedule={schedule} onRefresh={loadData} onChange={() => { localStorage.removeItem('servix_session'); setEmployee(null); setView('home'); if (typeof window !== 'undefined') { window.history.pushState({}, '', '/'); } }} />
      : <AdminPanel employees={employees} cars={cars} appointments={appointments} schedule={schedule} rates={rates} themes={themes} onRefresh={loadData} adminTheme={adminTheme} employeeTheme={employeeTheme} onChangeAdminTheme={changeAdminTheme} onChangeEmployeeTheme={changeEmployeeTheme} onExit={() => {
        localStorage.removeItem('servix_session');
        setView('home');
        if (typeof window !== 'undefined') {
          window.history.pushState({}, '', '/');
        }
      }} />;
}


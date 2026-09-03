import type { Car, Job, Rates } from '@/types';
import { Modal } from '@/components/Modal';
import { formatShortDuration } from '@/lib/format';
import { computeJobCost } from '@/lib/costs';

// ============================================================
// Corpul panoului de detalii — IDENTIC cu AdminJobDetailsModal.
// Extras ca să fie reutilizat de Admin (cu PDF) și de Panoul
// Angajatului (fără PDF) fără duplicarea logicii/formulelor.
// Formulele de timp/cost sunt cele existente (computeJobCost):
//   normal = worked_seconds; overtime = overtime_seconds;
//   total = normal + overtime. TOTAL FĂRĂ TVA = ROȘU,
//   TOTAL CU TVA = VERDE — exact ca în Admin.
// ============================================================
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--primary)' }}>{title}</p>{children}</div>;
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 py-1"><span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</span><span className="text-right text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{value}</span></div>;
}
// Totaluri evidențiate vizual - TOTAL FĂRĂ TVA = ROȘU, TOTAL CU TVA = VERDE
function TotalRowRed({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 py-1.5"><span className="text-sm font-bold" style={{ color: '#EF4444' }}>{label}</span><span className="text-right text-lg font-bold" style={{ color: '#EF4444' }}>{value}</span></div>;
}
export function JobDetailsBody({ job, car, rates, employeeName }: { job: Job; car: Car; rates: Rates | null; employeeName: (id: string | null) => string }) {
  // FIX: worked_seconds conține DOAR timp normal (nu se scade overtime_seconds)
  const normalSec = job.worked_seconds;
  const overtimeSec = job.overtime_seconds ?? 0;
  const finalizedCost = job.status === 'finalizat' ? computeJobCost(job, car, rates) : null;
  const vatRate = rates?.vat_rate ?? 21;
  const vatAmount = finalizedCost ? (finalizedCost.totalCost * vatRate) / 100 : 0;
  const totalWithVat = finalizedCost ? finalizedCost.totalCost + vatAmount : 0;
  const fmtDateTime = (ts: string | null) => ts ? new Date(ts).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Mașină">
          <Row label="Număr înmatriculare" value={car.license_plate} />
          <Row label="Marcă / Model" value={`${car.make ?? '—'}${car.model ? ` ${car.model}` : ''}`} />
          <Row label="An" value={car.year ?? '—'} />
          <Row label="Proprietar" value={car.client_name} />
          <Row label="Telefon" value={car.client_phone ?? '—'} />
        </Section>
        <Section title="Lucrare">
          <Row label="Denumire" value={job.title} />
          <Row label="Status" value={job.status === 'finalizat' ? 'Finalizat' : job.status === 'in_lucru' ? 'În lucru' : job.status === 'asteptare_piese' ? 'Așteptare piese' : 'Disponibil'} />
          <Row label="Început" value={fmtDateTime(job.started_at)} />
          <Row label="Finalizat" value={fmtDateTime(job.completed_at)} />
        </Section>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Angajați">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>{(employeeName(car.assigned_employee_id) || '?')[0]}</span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{employeeName(car.assigned_employee_id) || '—'}</span>
          </div>
        </Section>
        <Section title="Timp lucrat">
          {/* FIX: worked_seconds = DOAR timp normal, overtime_seconds = DOAR peste program */}
          <Row label="Ore normale" value={formatShortDuration(normalSec)} />
          <Row label="Ore suplimentare" value={formatShortDuration(overtimeSec)} />
          <Row label="Timp total" value={formatShortDuration(normalSec + overtimeSec)} />
          <Row label="worked_seconds (normal)" value={<span className="font-mono">{job.worked_seconds}s</span>} />
          <Row label="overtime_seconds" value={<span className="font-mono">{overtimeSec}s</span>} />
        </Section>
      </div>
      {finalizedCost && <Section title="Calcul cost">
        <Row label="Tarif orar normal" value={`${finalizedCost.normalRate.toFixed(2)} lei/oră`} />
        <Row label="Ore normale" value={formatShortDuration(finalizedCost.normalSec)} />
        <Row label="Cost ore normale" value={`${finalizedCost.normalCost.toFixed(2)} lei`} />
        <Row label="Tarif orar suplimentar" value={`${finalizedCost.overtimeRate.toFixed(2)} lei/oră`} />
        <Row label="Ore suplimentare" value={formatShortDuration(finalizedCost.overtimeSec)} />
        <Row label="Cost ore suplimentare" value={`${finalizedCost.overtimeCost.toFixed(2)} lei`} />
        <div className="my-2 border-t" style={{ borderColor: 'var(--border)' }} />
        <Row label="TVA" value={`${vatRate.toFixed(2)}%`} />
        <Row label="Valoare TVA" value={`${vatAmount.toFixed(2)} lei`} />
        <div className="my-2 border-t" style={{ borderColor: 'var(--border)' }} />
        <TotalRowRed label="TOTAL FĂRĂ TVA" value={`${finalizedCost.totalCost.toFixed(2)} lei`} />
        <TotalRowGreen label="TOTAL CU TVA" value={`${totalWithVat.toFixed(2)} lei`} />
      </Section>}
      {job.description && <Section title="Descriere lucrare"><p className="text-sm" style={{ color: 'var(--text-primary)' }}>{job.description}</p></Section>}
      {car.notes && <Section title="Observații mașină"><p className="text-sm" style={{ color: 'var(--text-primary)' }}>{car.notes}</p></Section>}
    </>
  );
}
function TotalRowGreen({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 py-1.5"><span className="text-sm font-bold" style={{ color: '#22C55E' }}>{label}</span><span className="text-right text-lg font-bold" style={{ color: '#22C55E' }}>{value}</span></div>;
}

/**
 * Panou detalii pentru ANGAJAT: aceleași informații și aspect ca în Admin,
 * dar FĂRĂ buton „Generează raport PDF" și fără navigare admin.
 */
export function EmployeeJobDetailsModal({ job, car, rates, employeeName, onClose }: { job: Job; car: Car; rates: Rates | null; employeeName: (id: string | null) => string; onClose: () => void }) {
  return <Modal title={`Detalii lucrare — ${car.license_plate}`} onClose={onClose} wide>
    <div className="space-y-4 p-6">
      <JobDetailsBody job={job} car={car} rates={rates} employeeName={employeeName} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
        <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-bold transition hover:bg-[var(--surface-secondary)]" style={{ color: 'var(--text-secondary)' }}>Închide</button>
      </div>
    </div>
  </Modal>;
}

import type { Car, Job, Rates } from '@/types';

// Mutat VERBATIM din App.tsx — NU se creează formule paralele.
// FIX: worked_seconds conține DOAR timp normal (nu se scade overtime_seconds)
export function computeJobCost(job: Job, car: Car, rates: Rates | null): { normalSec: number; overtimeSec: number; normalRate: number; overtimeRate: number; normalCost: number; overtimeCost: number; totalSec: number; totalCost: number } {
  const normalSec = job.worked_seconds;
  const overtimeSec = job.overtime_seconds ?? 0;
  const normalRate = car.is_warranty ? (rates?.warranty_rate ?? 0) : (rates?.normal_rate ?? 100);
  const overtimeRate = rates?.overtime_rate ?? 150;
  const normalCost = (normalSec / 3600) * normalRate;
  const overtimeCost = (overtimeSec / 3600) * overtimeRate;
  // FIX: totalSec = timp normal + timp peste program (nu doar worked_seconds)
  return { normalSec, overtimeSec, normalRate, overtimeRate, normalCost, overtimeCost, totalSec: normalSec + overtimeSec, totalCost: normalCost + overtimeCost };
}

import { useState } from 'react';
import { Clock, SlidersHorizontal, ChevronDown, Calendar, X, AlertTriangle, Package, Check, BarChart3 } from 'lucide-react';

// ===== Service Dark — Administrator Dashboard (reproducere machetă) =====
const C = {
  bg: '#08091A', card: '#111329', card2: '#151733', border: '#272A4B',
  text: '#F1F1FA', sub: '#A8ABC8', purple: '#7137F5', purpleBright: '#8B5CF6',
  purpleSoft: '#A78BFA',
  red: '#FF4545', orange: '#FF9800', green: '#2ED66F', blue: '#3B82F6',
};

type TAppt = { time: string; plate: string; client: string; car: string; status: string };
type TStatus = 'overdue' | 'parts' | 'finished' | 'progress';
type TSrc = { label: string; value: number };

const INIT_APPOINTMENTS: TAppt[] = [
  { time: '09:00', plate: 'TM 99 DEMO', client: 'Ion Popescu', car: 'Dacia Duster', status: 'PROGRAMATĂ' },
  { time: '10:30', plate: 'TM 88 DEMO', client: 'Mihai Ionescu', car: 'BMW 320d', status: 'PROGRAMATĂ' },
  { time: '14:00', plate: 'TM 77 DEMO', client: 'Vlad Georgescu', car: 'Audi A4', status: 'PROGRAMATĂ' },
];

const CHART_DATA: TSrc[] = [
  { label: '01 aug', value: 8 }, { label: '05 aug', value: 19 }, { label: '10 aug', value: 10 },
  { label: '15 aug', value: 20 }, { label: '20 aug', value: 7 }, { label: '25 aug', value: 21 }, { label: '30 aug', value: 28 },
];

const FIN_DIST = [
  { label: 'Manoperă', pct: 45, color: '#8B5CF6' },
  { label: 'Piese', pct: 35, color: '#FF9800' },
  { label: 'Diagnoză', pct: 10, color: '#2ED66F' },
  { label: 'Altele', pct: 10, color: '#3B82F6' },
];

export default function ServiceDarkDashboard() {
  const [apptList] = useState<TAppt[]>(INIT_APPOINTMENTS);
  const [employee, setEmployee] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState<{ employee: string; from: string; to: string }>({ employee: 'all', from: '', to: '' });
  const [activeStatus, setActiveStatus] = useState<TStatus | null>(null);
  // hover pe punctele graficului — luna curentă + data selectată
  const [hoverPt, setHoverPt] = useState<TSrc | null>(null);

  const useToday = !applied.from && !applied.to;
  const periodLabel = useToday
    ? 'ASTĂZI'
    : `${applied.from ? new Date(applied.from + 'T00:00:00').toLocaleDateString('ro-RO') : '...'} – ${applied.to ? new Date(applied.to + 'T00:00:00').toLocaleDateString('ro-RO') : '...'}`;

  const statusCards: Array<{ key: TStatus; title: string; value: number; accent: string; iconBg: string; Icon: React.ElementType; items: string[] }> = [
    { key: 'overdue', title: 'ÎN URMĂ CU TERMEN', value: 3, accent: C.red, iconBg: 'rgba(255,69,69,0.18)', Icon: AlertTriangle, items: ['TM 01 DEMO — Client A', 'TM 02 DEMO — Client B', 'TM 03 DEMO — Client C'] },
    { key: 'parts', title: 'PE AȘTEPTARE PIESE', value: 4, accent: C.orange, iconBg: 'rgba(255,152,0,0.18)', Icon: Package, items: ['TM 11 DEMO — Client D', 'TM 12 DEMO — Client E', 'TM 13 DEMO — Client F', 'TM 14 DEMO — Client G'] },
    { key: 'finished', title: 'FINALIZATE ASTĂZI', value: 0, accent: C.green, iconBg: 'rgba(46,214,111,0.18)', Icon: Check, items: [] },
    { key: 'progress', title: 'ÎN LUCRU', value: 8, accent: C.blue, iconBg: 'rgba(59,130,246,0.18)', Icon: Clock, items: ['TM 20 DEMO — Client H', 'TM 21 DEMO — Client I', 'TM 22 DEMO — Client J', 'TM 23 DEMO — Client K', 'TM 24 DEMO — Client L', 'TM 25 DEMO — Client M', 'TM 26 DEMO — Client N', 'TM 27 DEMO — Client O'] },
  ];

  const totalWorks = CHART_DATA.reduce((s, d) => s + d.value, 0);

  const applyFilters = (): void => setApplied({ employee, from, to });
  const resetFilters = (): void => { setEmployee('all'); setFrom(''); setTo(''); setApplied({ employee: 'all', from: '', to: '' }); };

  return (
    <div className="min-h-screen w-full" style={{ background: 'radial-gradient(circle at top left, #0B0C20, #070817 72%)', fontFamily: 'Inter, sans-serif' }}>
      <div className="mx-auto px-5 py-4 lg:px-[83px]" style={{ maxWidth: 1616 }}>
        <div className="space-y-[25px]">
{/* ===== ZONA PROGRAMĂRI — 3 carduri ===== */}
          <div className="grid gap-[14px] lg:grid-cols-3">
            {apptList.map((a) => (
              <div key={a.plate + a.time} className="flex items-center gap-[18px] rounded-[16px] p-[28px]" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 4px 20px rgba(20,25,60,0.25)' }}>
                <span className="flex h-[56px] w-[56px] flex-none items-center justify-center rounded-[12px]" style={{ background: 'rgba(113,55,245,0.20)' }}>
                  <Clock size={27} color={C.purpleSoft} strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[19px] font-bold" style={{ color: C.text }}>{a.time} · {a.plate}</div>
                  <div className="truncate text-[15px] font-medium" style={{ color: C.sub }}>{a.client} • {a.car}</div>
                </div>
                <span className="flex-none rounded-[9px] px-[15px] py-[10px] text-[12px] font-bold uppercase tracking-[0.06em]" style={{ background: 'rgba(113,55,245,0.16)', color: C.purpleBright }}>{a.status}</span>
              </div>
            ))}
          </div>

          {/* ===== FILTRARE ===== */}
          <div className="rounded-[17px]" style={{ background: 'linear-gradient(135deg, #151733, #111329)', border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-[16px] px-[28px] pt-[28px]">
              <span className="flex h-[56px] w-[56px] flex-none items-center justify-center rounded-[13px]" style={{ background: 'rgba(113,55,245,0.24)', boxShadow: '0 0 24px rgba(113,55,245,0.30)' }}>
                <SlidersHorizontal size={27} color={C.purpleBright} strokeWidth={1.8} />
              </span>
              <div>
                <div className="text-[24px] font-bold" style={{ color: C.text }}>Filtrare</div>
                <div className="text-[15px] font-medium" style={{ color: C.sub }}>Filtrează activitatea pe angajat și perioadă.</div>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-[14px] px-[28px] py-[24px]">
              <div className="min-w-[200px] flex-1 lg:w-[354px] lg:flex-none">
                <div className="mb-[8px] text-[13px] font-semibold uppercase tracking-wide" style={{ color: C.sub }}>Angajat</div>
                <div className="relative">
                  <select value={employee} onChange={(e) => setEmployee(e.target.value)} className="h-[62px] w-full appearance-none rounded-[11px] border bg-transparent pl-[20px] pr-[44px] text-[15px] font-medium outline-none" style={{ borderColor: C.border, color: C.text }}>
                    <option value="all" style={{ background: C.card2, color: C.text }}>Toți angajații</option>
                    <option value="ion" style={{ background: C.card2, color: C.text }}>Ion Popescu</option>
                    <option value="mihai" style={{ background: C.card2, color: C.text }}>Mihai Ionescu</option>
                    <option value="vlad" style={{ background: C.card2, color: C.text }}>Vlad Georgescu</option>
                  </select>
                  <ChevronDown size={19} className="pointer-events-none absolute right-[18px] top-1/2 -translate-y-1/2" color={C.sub} />
                </div>
              </div>

              <div className="min-w-[200px] flex-1 lg:w-[354px] lg:flex-none">
                <div className="mb-[8px] text-[13px] font-semibold uppercase tracking-wide" style={{ color: C.sub }}>De la</div>
                <div className="relative">
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-[62px] w-full rounded-[11px] border bg-transparent pl-[48px] pr-[18px] text-[15px] font-medium outline-none [color-scheme:dark]" style={{ borderColor: C.border, color: C.text }} />
                  <Calendar size={19} className="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2" color={C.sub} />
                </div>
              </div>

              <div className="min-w-[200px] flex-1 lg:w-[363px] lg:flex-none">
                <div className="mb-[8px] text-[13px] font-semibold uppercase tracking-wide" style={{ color: C.sub }}>Până la</div>
                <div className="relative">
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-[62px] w-full rounded-[11px] border bg-transparent pl-[48px] pr-[18px] text-[15px] font-medium outline-none [color-scheme:dark]" style={{ borderColor: C.border, color: C.text }} />
                  <Calendar size={19} className="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2" color={C.sub} />
                </div>
              </div>

              <button onClick={applyFilters} className="flex h-[62px] min-w-[200px] flex-1 items-center justify-center gap-[10px] rounded-[11px] px-5 text-[16px] font-bold text-white transition-all duration-150 hover:brightness-110 lg:w-[256px] lg:flex-none" style={{ background: 'linear-gradient(135deg,#8B5CF6,#7137F5)', boxShadow: '0 0 22px rgba(113,55,245,0.35)' }}>
                <SlidersHorizontal size={19} /> Aplică filtrele
              </button>

              <button onClick={resetFilters} aria-label="Resetează filtre" className="flex h-[62px] w-[68px] items-center justify-center rounded-[11px] border transition-colors duration-150 hover:border-[#3A3E6B]" style={{ borderColor: C.border, background: C.card }}>
                <X size={20} color={C.purpleSoft} />
              </button>
            </div>

            <div className="px-[28px] pb-[26px]">
              <span className="text-[14px] font-medium" style={{ color: C.sub }}>Perioadă activă: </span>
              <span className="text-[14px] font-bold" style={{ color: C.purpleBright }}>{periodLabel}</span>
            </div>
          </div>
{/* ===== 4 CARDURI STATUS ===== */}
          <div className="grid gap-[14px] sm:grid-cols-2 xl:grid-cols-4">
            {statusCards.map((sc) => {
              const isActive = activeStatus === sc.key;
              const { Icon } = sc;
              return (
                <button key={sc.key} onClick={() => setActiveStatus(isActive ? null : sc.key)} className="group rounded-[16px] p-[27px] text-left transition-all duration-150 hover:-translate-y-[2px]" style={{ background: C.card, border: `1px solid ${isActive ? sc.accent : C.border}`, boxShadow: isActive ? `0 0 26px ${sc.accent}22` : '0 4px 20px rgba(20,25,60,0.22)', minHeight: 176 }}>
                  <div className="flex items-start justify-between">
                    <span className="text-[13px] font-bold tracking-[0.04em]" style={{ color: C.sub }}>{sc.title}</span>
                    <span className="flex h-[40px] w-[40px] flex-none items-center justify-center rounded-full" style={{ background: sc.iconBg }}>
                      <Icon size={20} color={sc.accent} strokeWidth={1.9} />
                    </span>
                  </div>
                  <div className="mt-[14px] flex items-baseline gap-[8px]">
                    <span className="text-[34px] font-extrabold leading-none" style={{ color: C.text }}>{sc.value}</span>
                    <span className="text-[15px] font-medium" style={{ color: C.sub }}>mașini</span>
                  </div>
                  <div className="mt-[10px] text-[15px] font-bold" style={{ color: sc.accent }}>{isActive ? 'Ascunde ↑' : 'Vezi detalii →'}</div>
                </button>
              );
            })}
          </div>

          {/* Detalii status activ */}
          {activeStatus && (
            <div className="rounded-[16px] p-[22px]" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-between">
                <div className="text-[16px] font-bold" style={{ color: C.text }}>Mașini — {statusCards.find((s) => s.key === activeStatus)?.title} ({statusCards.find((s) => s.key === activeStatus)?.value ?? 0})</div>
                <button onClick={() => setActiveStatus(null)} className="rounded-[9px] border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:border-[#3A3E6B]" style={{ borderColor: C.border, color: C.sub }}>Ascunde</button>
              </div>
              <div className="mt-[16px] space-y-[10px]">
                {(statusCards.find((s) => s.key === activeStatus)?.items ?? []).length === 0 ? (
                  <div className="py-6 text-center text-[14px]" style={{ color: C.sub }}>Nu există mașini pentru acest status în perioada selectată.</div>
                ) : (
                  statusCards.find((s) => s.key === activeStatus)?.items.map((it) => (
                    <div key={it} className="flex items-center justify-between rounded-[11px] border px-[18px] py-[14px]" style={{ borderColor: C.border, background: C.card2 }}>
                      <span className="text-[15px] font-semibold" style={{ color: C.text }}>{it}</span>
                      <span className="text-[12px] font-bold uppercase tracking-[0.05em]" style={{ color: statusCards.find((s) => s.key === activeStatus)?.accent }}>{statusCards.find((s) => s.key === activeStatus)?.title}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ===== ANALYTICS: grafic lună + distribuție financiară ===== */}
          <div className="grid gap-[14px] xl:grid-cols-[55fr_45fr]">
            <ChartCard />
            <DonutCard />
          </div>
</div>
      </div>
    </div>
  );
}

/* ================= Line chart: Lucrări în această lună ================= */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : pts.length - 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function ChartCard() {
  const [hov, setHov] = useState<TSrc | null>(null);
  const W = 640, H = 240, padL = 40, padR = 16, padT = 18, padB = 40;
  const maxY = 30;
  const rawX = CHART_DATA.map((_, i) => padL + (i / (CHART_DATA.length - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);
  const pts = CHART_DATA.map((d, i) => [rawX[i], y(d.value)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1][0]},${H - padB} L ${pts[0][0]},${H - padB} Z`;
  const total = CHART_DATA.reduce((s, d) => s + d.value, 0);
  return (
    <div className="rounded-[16px] p-[26px]" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 4px 20px rgba(20,25,60,0.22)' }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[20px] font-bold" style={{ color: C.text }}>Lucrări în această lună</div>
          <div className="text-[15px] font-medium" style={{ color: C.sub }}>august 2026</div>
        </div>
        <div className="text-right">
          <div className="text-[34px] font-extrabold leading-none" style={{ color: C.purpleBright }}>{total}</div>
          <div className="mt-[4px] text-[12px] font-bold uppercase tracking-[0.1em]" style={{ color: C.sub }}>Total lucrări</div>
        </div>
      </div>
      <div className="relative mt-[16px]">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[260px] w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 10, 20, 30].map((g) => {
            const gy = y(g);
            return <g key={g}><line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="#272A4B" strokeWidth="1" strokeDasharray="4 6" /><text x={padL - 8} y={gy + 4} textAnchor="end" fontSize="11" fill="#A8ABC8">{g}</text></g>;
          })}
          {CHART_DATA.map((d, i) => <text key={'x' + i} x={rawX[i]} y={H - padB + 20} textAnchor="middle" fontSize="11" fill="#A8ABC8">{d.label}</text>)}
          <path d={area} fill="url(#areaGrad)" />
          <path d={line} fill="none" stroke="#8B5CF6" strokeWidth="2.6" strokeLinecap="round" />
          {CHART_DATA.map((d, i) => (
            <g key={'p' + i}>
              <circle cx={rawX[i]} cy={y(d.value)} r="9" fill="transparent" onMouseEnter={() => setHov(d)} onMouseLeave={() => setHov(null)} />
              <circle cx={rawX[i]} cy={y(d.value)} r="4.5" fill="#111329" stroke="#8B5CF6" strokeWidth="2.4" />
            </g>
          ))}
          {hov && <> <circle cx={rawX[CHART_DATA.indexOf(hov)]} cy={y(hov.value)} r="5.5" fill="#8B5CF6" /><text x={rawX[CHART_DATA.indexOf(hov)]} y={y(hov.value) - 12} textAnchor="middle" fontSize="12" fontWeight="700" fill="#F1F1FA">{hov.value}</text></>}
        </svg>
      </div>
    </div>
  );
}

/* ================= Donut: Distribuție financiară ================= */
function DonutCard() {
  const R = 70, CX = 90, CY = 90, SW = 26;
  const circ = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex flex-col rounded-[16px] p-[26px]" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 4px 20px rgba(20,25,60,0.22)' }}>
      <div>
        <div className="text-[20px] font-bold" style={{ color: C.text }}>Distribuție financiară</div>
        <div className="text-[15px] font-medium" style={{ color: C.sub }}>Mașini finalizate</div>
      </div>
      <div className="mt-[14px] flex items-center gap-[22px]">
        <svg viewBox="0 0 180 180" className="h-[180px] w-[180px] shrink-0">
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#272A4B" strokeWidth={SW} />
          {FIN_DIST.map((seg) => {
            const len = (seg.pct / 100) * circ;
            const el = <circle key={seg.label} cx={CX} cy={CY} r={R} fill="none" stroke={seg.color} strokeWidth={SW} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc} transform={`rotate(-90 ${CX} ${CY})`} strokeLinecap="butt" />;
            acc += len;
            return el;
          })}
          <text x={CX} y={CY - 2} textAnchor="middle" fontSize="24" fontWeight="800" fill="#F1F1FA">100%</text>
          <text x={CX} y={CY + 18} textAnchor="middle" fontSize="11" fontWeight="600" fill="#A8ABC8">TOTAL</text>
        </svg>
        <div className="min-w-0 flex-1 space-y-[14px]">
          {FIN_DIST.map((seg) => (
            <div key={seg.label} className="flex items-center justify-between gap-[10px]">
              <span className="flex min-w-0 items-center gap-[10px]"><span className="h-[11px] w-[11px] shrink-0 rounded-[3px]" style={{ background: seg.color }} /><span className="truncate text-[15px] font-semibold" style={{ color: C.text }}>{seg.label}</span></span>
              <span className="shrink-0 text-[15px] font-bold" style={{ color: C.sub }}>{seg.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
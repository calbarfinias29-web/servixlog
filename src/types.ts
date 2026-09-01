export type Role = 'admin' | 'employee';
export type CarStatus = 'noua' | 'in_lucru' | 'asteptare_piese' | 'in_garantie' | 'finalizata';
export type JobStatus = 'asteptare' | 'in_lucru' | 'asteptare_piese' | 'finalizat';
export type Priority = 'normala' | 'urgenta';
export type FinancialStatus = 'incasat' | 'neincasat' | 'facturat' | 'nefacturat';
export type AppointmentStatus = 'programata' | 'preluata' | 'in_lucru' | 'finalizata' | 'anulata' | 'neprezentata';
export type FuelLevel = 'rezerva' | '1/4' | '1/2' | '3/4' | 'plin';

export interface Employee {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  is_demo: boolean;
  username: string | null;
  avatar_url: string | null;
  access_code: string | null;
}

export interface Job {
  id: string;
  car_id: string;
  title: string;
  description: string | null;
  status: JobStatus;
  worked_seconds: number;
  overtime_seconds: number;
  is_overtime: boolean;
  started_at: string | null;
  completed_at: string | null;
  order_index: number;
  is_demo: boolean;
}

export interface PlateHistoryEntry {
  id: string;
  car_id: string;
  license_plate: string;
  changed_at: string;
  changed_by: string | null;
  is_demo: boolean;
}

export interface MileageLogEntry {
  id: string;
  car_id: string;
  mileage: number;
  recorded_at: string;
  recorded_by: string | null;
  is_demo: boolean;
}

export interface CarPhoto {
  id: string;
  car_id: string;
  url: string;
  is_demo: boolean;
  created_at: string;
}

export interface Car {
  id: string;
  internal_id: string | null;
  license_plate: string;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  mileage: number | null;
  body_observations: string | null;
  photo_url: string | null;
  fuel_level: FuelLevel | null;
  status: CarStatus;
  priority: Priority;
  assigned_employee_id: string | null;
  deadline: string | null;
  is_warranty: boolean;
  notes: string | null;
  overtime_seconds: number;
  payment_status: string;
  invoice_status: string;
  financial_status: FinancialStatus;
  created_at: string;
  completed_at: string | null;
  is_demo: boolean;
  jobs?: Job[];
  plate_history?: PlateHistoryEntry[];
  mileage_log?: MileageLogEntry[];
  car_photos?: CarPhoto[];
}

export interface Schedule {
  id: string;
  work_start: string;
  work_end: string;
  break_start: string;
  break_end: string;
}

export type EventMode = 'auto' | 'manual';

export interface EmployeeEventSettings {
  employee_id: string;
  work_start_mode: EventMode;
  break_start_mode: EventMode;
  break_end_mode: EventMode;
  work_end_mode: EventMode;
}

export interface Rates {
  id: string;
  normal_rate: number;
  urgent_rate: number;
  warranty_rate: number;
  overtime_rate: number;
  vat_rate: number;
}

export interface ThemeColors {
  '--primary': string;
  '--secondary': string;
  '--accent': string;
  '--background': string;
  '--surface': string;
  '--sidebar': string;
  '--card': string;
  '--button': string;
  '--text-primary': string;
  '--text-secondary': string;
  '--border': string;
  '--success': string;
  '--warning': string;
  '--danger': string;
  '--info': string;
  [key: string]: string;
}

export interface Theme {
  id: string;
  name: string;
  scope: 'admin' | 'employee';
  is_builtin: boolean;
  is_custom: boolean;
  colors: ThemeColors;
}

export interface Appointment {
  id: string;
  car_id: string | null;
  license_plate: string | null;
  client_name: string | null;
  client_phone: string | null;
  make: string | null;
  model: string | null;
  internal_id: string | null;
  vin: string | null;
  appointment_date: string;
  appointment_time: string;
  employee_id: string | null;
  status: AppointmentStatus;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
}

export type View = 'home' | 'employee' | 'admin';

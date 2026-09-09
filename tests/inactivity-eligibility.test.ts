import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eligibleInactivityEmployeeIds } from '../src/lib/employeeInactivity';
import type { Car, Employee, Schedule } from '../src/types';

const schedule = {
  id: 'schedule-test', work_start: '08:00', work_end: '18:00', break_start: '13:00', break_end: '14:00',
  monday_active: true, tuesday_active: true, wednesday_active: true, thursday_active: true, friday_active: true,
  saturday_active: false, sunday_active: false,
} as Schedule;
const sami = { id: 'sami', name: 'Sami', role: 'employee', active: true } as Employee;
const inactive = { id: 'inactive', name: 'Inactive', role: 'employee', active: false } as Employee;
const assignedCar = { id: 'car-1', assigned_employee_id: 'sami' } as Car;

const date = (hour: number, minute = 0): Date => new Date(Date.UTC(2026, 8, 4, hour - 3, minute));

test('eligible state uses active employee, schedule, break and assigned-car state', () => {
  assert.deepEqual(eligibleInactivityEmployeeIds([sami, inactive], [], schedule, date(10)), ['sami']);
  assert.deepEqual(eligibleInactivityEmployeeIds([sami], [assignedCar], schedule, date(10)), []);
  assert.deepEqual(eligibleInactivityEmployeeIds([sami], [], schedule, date(13, 30)), []);
  assert.deepEqual(eligibleInactivityEmployeeIds([sami], [], schedule, date(19)), []);
});

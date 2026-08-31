-- ============================================================
-- Demo data: multi-year history, varied statuses, full data
-- Updates existing demo cars with mileage, VIN, body obs, fuel,
-- and adds historical jobs across multiple years
-- ============================================================

-- Update existing demo cars with full data
UPDATE cars SET mileage = 185420, vin = 'UU1BSD7123456789', body_observations = 'Zgârietură portieră stânga', fuel_level = '1/2', internal_id = 'CAR-000020'
WHERE license_plate = 'TM 99 DEMO' AND client_name = 'Ion Popescu';

UPDATE cars SET mileage = 92300, vin = 'WBA320d4567890', body_observations = NULL, fuel_level = '3/4', internal_id = 'CAR-000021'
WHERE license_plate = 'TM 88 DEMO' AND client_name = 'Mihai Ionescu';

UPDATE cars SET mileage = 67100, vin = 'WAUA4A41234567', body_observations = 'Bara față zgâriată', fuel_level = 'plin', internal_id = 'CAR-000022'
WHERE license_plate = 'TM 77 DEMO' AND client_name = 'Vlad Georgescu';

UPDATE cars SET mileage = 142800, vin = 'WVWPassat7890', body_observations = NULL, fuel_level = '1/4', internal_id = 'CAR-000023'
WHERE license_plate = 'TM 66 DEMO' and client_name = 'Andrei Stan';

UPDATE cars SET mileage = 78500, vin = 'WF0Focus4567', body_observations = 'Lovitură aripă dreapta', fuel_level = '1/2', internal_id = 'CAR-000024'
WHERE license_plate = 'TM 55 DEMO' and client_name = 'Daniel Marin';

UPDATE cars SET mileage = 103200, vin = 'TMSkoda123456', body_observations = NULL, fuel_level = 'rezerva', internal_id = 'CAR-000025'
WHERE license_plate = 'TM 44 DEMO' and client_name = 'Cristian Pavel';

UPDATE cars SET mileage = 56000, vin = 'WDDCClass9012', body_observations = 'Parbriz fisurat', fuel_level = '1/2', internal_id = 'CAR-000026'
WHERE license_plate = 'TM 33 DEMO' and client_name = 'Robert Dumitru';

UPDATE cars SET mileage = 121000, vin = 'GMAstra345678', body_observations = NULL, fuel_level = '1/4', internal_id = 'CAR-000027'
WHERE license_plate = 'TM 22 DEMO' and client_name = 'Marius Ene';

-- Add mileage log entries (multi-year)
INSERT INTO mileage_log (car_id, mileage, recorded_at, is_demo)
SELECT c.id, 150000, '2024-03-15'::timestamptz, true FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND c.client_name = 'Ion Popescu'
ON CONFLICT DO NOTHING;

INSERT INTO mileage_log (car_id, mileage, recorded_at, is_demo)
SELECT c.id, 170000, '2025-06-20'::timestamptz, true FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND c.client_name = 'Ion Popescu'
ON CONFLICT DO NOTHING;

INSERT INTO mileage_log (car_id, mileage, recorded_at, is_demo)
SELECT c.id, 185420, '2026-08-24'::timestamptz, true FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND c.client_name = 'Ion Popescu'
ON CONFLICT DO NOTHING;

INSERT INTO mileage_log (car_id, mileage, recorded_at, is_demo)
SELECT c.id, 80000, '2024-05-10'::timestamptz, true FROM cars c WHERE c.license_plate = 'TM 88 DEMO' AND c.client_name = 'Mihai Ionescu'
ON CONFLICT DO NOTHING;

INSERT INTO mileage_log (car_id, mileage, recorded_at, is_demo)
SELECT c.id, 92300, '2026-08-20'::timestamptz, true FROM cars c WHERE c.license_plate = 'TM 88 DEMO' AND c.client_name = 'Mihai Ionescu'
ON CONFLICT DO NOTHING;

-- Add historical finalized jobs (2023, 2024, 2025) for TM 99 DEMO
INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Revizie generală 2023', 'finalizat', 1, 7200, '2023-04-10'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND c.client_name = 'Ion Popescu'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Revizie generală 2023')
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Schimb frâne 2024', 'finalizat', 2, 5400, '2024-03-15'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND c.client_name = 'Ion Popescu'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Schimb frâne 2024')
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Revizie generală 2025', 'finalizat', 3, 9000, '2025-06-20'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND c.client_name = 'Ion Popescu'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Revizie generală 2025')
ON CONFLICT DO NOTHING;

-- Historical jobs for TM 88 DEMO
INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Diagnosticare 2024', 'finalizat', 1, 3600, '2024-05-10'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 88 DEMO' AND c.client_name = 'Mihai Ionescu'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Diagnosticare 2024')
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Schimb ulei 2025', 'finalizat', 2, 1800, '2025-09-15'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 88 DEMO' AND c.client_name = 'Mihai Ionescu'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Schimb ulei 2025')
ON CONFLICT DO NOTHING;

-- Historical jobs for TM 77 DEMO
INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Revizie 2024', 'finalizat', 1, 5400, '2024-07-20'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 77 DEMO' AND c.client_name = 'Vlad Georgescu'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Revizie 2024')
ON CONFLICT DO NOTHING;

-- Historical jobs for TM 66 DEMO
INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Schimb ambreiaj 2023', 'finalizat', 1, 10800, '2023-11-05'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 66 DEMO' AND c.client_name = 'Andrei Stan'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Schimb ambreiaj 2023')
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Revizie 2025', 'finalizat', 2, 7200, '2025-02-15'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 66 DEMO' AND c.client_name = 'Andrei Stan'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Revizie 2025')
ON CONFLICT DO NOTHING;

-- Historical jobs for TM 55 DEMO
INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Reparație caroserie 2024', 'finalizat', 1, 14400, '2024-08-10'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 55 DEMO' AND c.client_name = 'Daniel Marin'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Reparație caroserie 2024')
ON CONFLICT DO NOTHING;

-- Historical jobs for TM 44 DEMO
INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Schimb filtre 2024', 'finalizat', 1, 2700, '2024-09-12'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 44 DEMO' AND c.client_name = 'Cristian Pavel'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Schimb filtre 2024')
ON CONFLICT DO NOTHING;

-- Historical jobs for TM 33 DEMO
INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Înlocuire parbriz 2025', 'finalizat', 1, 6300, '2025-04-18'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 33 DEMO' AND c.client_name = 'Robert Dumitru'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Înlocuire parbriz 2025')
ON CONFLICT DO NOTHING;

-- Historical jobs for TM 22 DEMO
INSERT INTO jobs (car_id, title, status, order_index, worked_seconds, completed_at, is_demo)
SELECT c.id, 'Revizie 2024', 'finalizat', 1, 4500, '2024-10-22'::timestamptz, true
FROM cars c WHERE c.license_plate = 'TM 22 DEMO' AND c.client_name = 'Marius Ene'
AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Revizie 2024')
ON CONFLICT DO NOTHING;

-- Set some demo cars as finalized with payment/invoice status
UPDATE cars SET completed_at = '2026-08-15'::timestamptz, payment_status = 'incasat', invoice_status = 'facturat'
WHERE license_plate = 'TM 55 DEMO' AND client_name = 'Daniel Marin';

-- Set TM 33 DEMO as finalized but unpaid
UPDATE cars SET completed_at = '2026-08-18'::timestamptz, payment_status = 'neincasat', invoice_status = 'facturat'
WHERE license_plate = 'TM 33 DEMO' AND client_name = 'Robert Dumitru';

-- Set TM 44 DEMO as finalized, unpaid, uninvoiced
UPDATE cars SET completed_at = '2026-08-20'::timestamptz, payment_status = 'neincasat', invoice_status = 'nefacturat'
WHERE license_plate = 'TM 44 DEMO' AND client_name = 'Cristian Pavel';

-- Mark all historical finalized jobs as finalizat and set their cars' status
-- TM 55 DEMO: all jobs finalized -> car is finalizata
UPDATE jobs SET status = 'finalizat', completed_at = '2024-08-10'::timestamptz
WHERE car_id = (SELECT id FROM cars WHERE license_plate = 'TM 55 DEMO' AND client_name = 'Daniel Marin')
  AND title = 'Reparație caroserie 2024';

UPDATE jobs SET status = 'finalizat', completed_at = '2025-04-18'::timestamptz
WHERE car_id = (SELECT id FROM cars WHERE license_plate = 'TM 33 DEMO' AND client_name = 'Robert Dumitru')
  AND title = 'Înlocuire parbriz 2025';

UPDATE jobs SET status = 'finalizat', completed_at = '2024-09-12'::timestamptz
WHERE car_id = (SELECT id FROM cars WHERE license_plate = 'TM 44 DEMO' AND client_name = 'Cristian Pavel')
  AND title = 'Schimb filtre 2024';

-- Set access codes for demo employees
UPDATE employees SET access_code = '1234' WHERE name = 'Sami' AND is_demo = true;
UPDATE employees SET access_code = '1234' WHERE name = 'Ghiță' AND is_demo = true;
UPDATE employees SET access_code = '1234' WHERE name = 'Gogu' AND is_demo = true;
/*
# SERVIX - Protect demo marker from client writes

## Overview
Prevents browser/API clients from changing the `is_demo` marker. This closes the
only route that could otherwise turn a real row into a deletable demo row.

## Security changes
- Revoke INSERT and UPDATE privileges on `is_demo` from anon and authenticated
  for employees, cars, jobs, time_entries, and activity_log.
- Existing real rows remain `is_demo = false`.
- Existing RLS DELETE policies continue to allow deletion only when `is_demo = true`.
- The migration owner can still seed demo rows and future trusted server migrations
  can manage demo data.

## Important notes
1. Normal app inserts omit `is_demo`, so the database default keeps them real.
2. Normal app updates cannot alter the demo marker.
3. A direct API request cannot relabel a real row and then delete it.
*/

REVOKE INSERT (is_demo), UPDATE (is_demo) ON employees FROM anon, authenticated;
REVOKE INSERT (is_demo), UPDATE (is_demo) ON cars FROM anon, authenticated;
REVOKE INSERT (is_demo), UPDATE (is_demo) ON jobs FROM anon, authenticated;
REVOKE INSERT (is_demo), UPDATE (is_demo) ON time_entries FROM anon, authenticated;
REVOKE INSERT (is_demo), UPDATE (is_demo) ON activity_log FROM anon, authenticated;

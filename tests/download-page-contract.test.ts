import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const page = readFileSync(new URL('../src/pages/DescarcarePage.tsx', import.meta.url), 'utf8');

test('download page exposes the three real product installers through configurable URLs', () => {
  assert.match(page, /SERVIX Admin/);
  assert.match(page, /SERVIX Angajat/);
  assert.match(page, /SERVIX Companion/);
  assert.match(page, /VITE_SERVIX_ADMIN_DOWNLOAD_URL/);
  assert.match(page, /VITE_SERVIX_ANGAJAT_DOWNLOAD_URL/);
  assert.match(page, /VITE_SERVIX_COMPANION_DOWNLOAD_URL/);
  assert.match(page, /SERVIX_VERSION/);
  assert.match(page, /release de test/);
  assert.doesNotMatch(page, /DOWNLOAD_URL_FALLBACK|VITE_SERVIX_DOWNLOAD_URL/);
  assert.doesNotMatch(page, /oficial|semnat și verificat/);
});

test('download page has no invented or local installer URLs', () => {
  assert.doesNotMatch(page, /file:\/\//);
  assert.doesNotMatch(page, /github\.com|release\/download/);
  assert.match(page, /disabled=\{!product\.url\}/);
  assert.doesNotMatch(page, /Linkurile publice vor fi activate/);
});
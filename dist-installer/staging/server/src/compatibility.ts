import { SERVIX_API_VERSION, SERVIX_MIN_CLIENT_VERSION, SERVIX_VERSION } from '../../src/version.ts';

export type CompatibilityStatus = 'compatible' | 'client_too_old' | 'server_too_old' | 'api_incompatible';

export interface VersionInfo {
  appVersion: string;
  serverVersion: string;
  apiVersion: string;
  minClientVersion: string;
}

export interface CompatibilityResult {
  status: CompatibilityStatus;
  compatible: boolean;
  message: string;
}

export const LOCAL_VERSION: VersionInfo = {
  appVersion: SERVIX_VERSION,
  serverVersion: SERVIX_VERSION,
  apiVersion: SERVIX_API_VERSION,
  minClientVersion: SERVIX_MIN_CLIENT_VERSION,
};

function parseVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(left: string, right: string): number | null {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

/** Reports compatibility only; request gating is deliberately deferred to a later phase. */
export function checkClientCompatibility(clientVersion: string, clientApiVersion: string): CompatibilityResult {
  if (clientApiVersion !== LOCAL_VERSION.apiVersion) {
    return { status: 'api_incompatible', compatible: false, message: 'Versiunea API client nu este compatibilă cu serverul Local.' };
  }
  const current = compareVersions(clientVersion, LOCAL_VERSION.appVersion);
  const minimum = compareVersions(clientVersion, LOCAL_VERSION.minClientVersion);
  if (current === null || minimum === null) {
    return { status: 'api_incompatible', compatible: false, message: 'Versiunea clientului trebuie să folosească Semantic Versioning.' };
  }
  if (minimum < 0) {
    return { status: 'client_too_old', compatible: false, message: 'Clientul este prea vechi pentru acest server Local.' };
  }
  if (current > 0) {
    return { status: 'server_too_old', compatible: false, message: 'Serverul Local este prea vechi pentru acest client.' };
  }
  return { status: 'compatible', compatible: true, message: 'Clientul este compatibil cu serverul Local.' };
}

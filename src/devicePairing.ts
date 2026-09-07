export interface PairingConfiguration {
  serviceId: string;
  serverAddress: string | null;
  apiVersion: string;
}

export interface DevicePairingEnvelope extends PairingConfiguration {
  protocol: 'servix-pairing/v1';
  deviceId: string;
  credential: string;
}

/** One canonical string used by both QR and Code 128 barcode renderers. */
export function createPairingPayload(configuration: PairingConfiguration, deviceId: string, credential: string): string {
  return JSON.stringify({
    protocol: 'servix-pairing/v1',
    serviceId: configuration.serviceId,
    serverAddress: configuration.serverAddress,
    apiVersion: configuration.apiVersion,
    deviceId,
    credential,
  } satisfies DevicePairingEnvelope);
}

export function parsePairingPayload(payload: string): DevicePairingEnvelope | null {
  try {
    const value = JSON.parse(payload) as Partial<DevicePairingEnvelope>;
    if (value.protocol !== 'servix-pairing/v1' || typeof value.serviceId !== 'string' || typeof value.deviceId !== 'string' || typeof value.credential !== 'string' || typeof value.apiVersion !== 'string') return null;
    if (value.serverAddress !== null && typeof value.serverAddress !== 'string') return null;
    return value as DevicePairingEnvelope;
  } catch {
    return null;
  }
}

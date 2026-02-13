import type { WhatsAppConfig } from '../types';

export function detectAuthMethod(config: any): 'baileys' | 'cloudapi' {
  // Explicit method specified
  if (config.authMethod) return config.authMethod;

  // Auto-detect from fields
  if (config.authDir || config.sessionPath || config.authState) {
    return 'baileys';
  }

  if (config.accessToken && config.phoneNumberId) {
    return 'cloudapi';
  }

  throw new Error(
    'Cannot detect auth method. Provide either:\n' +
    '  - authDir (for Baileys QR code)\n' +
    '  - accessToken + phoneNumberId (for Cloud API)'
  );
}

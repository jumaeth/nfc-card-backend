import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as reachable by a privileged user whose session is NOT yet
 * passkey-authenticated. Needed for the bootstrap/discovery endpoints (e.g.
 * `/access`, which tells the client it must set up a passkey). Without this a
 * privileged password session could never learn it needs a passkey.
 */
export const SKIP_PASSKEY_GATE = 'skipPasskeyGate';
export const SkipPasskeyGate = () => SetMetadata(SKIP_PASSKEY_GATE, true);

/** WIFI page content (see pages/dto/create-page.dto.ts). */
export interface WifiContent {
  ssid?: string;
  password?: string;
  encryption?: 'WPA' | 'WEP' | 'nopass';
  hidden?: boolean;
  guestAccess?: GuestAccess;
}

/**
 * Who gets the password. "open": everyone who opens the page. "email": guests
 * leave their email first. "verify": guests confirm their email with a code.
 */
export type GuestAccessMode = 'open' | 'email' | 'verify';

export interface GuestAccess {
  mode?: GuestAccessMode;
  /** Offer an (unticked) opt-in to marketing emails from the business. */
  marketing?: boolean;
  /** The business's own privacy policy, linked from the privacy note. */
  privacyUrl?: string;
  /** Where guests ask for their data to be deleted. */
  contactEmail?: string;
}

export function accessMode(
  content: WifiContent | null | undefined,
): GuestAccessMode {
  const mode = content?.guestAccess?.mode;
  return mode === 'email' || mode === 'verify' ? mode : 'open';
}

/**
 * Page content as the public page may see it. With guest access on, the
 * password is only handed out after the email step, never with the page.
 */
export function publicWifiContent(content: WifiContent): WifiContent {
  if (accessMode(content) === 'open') return content;
  const rest = { ...content };
  delete rest.password;
  return rest;
}

import { createHash } from 'node:crypto';
import type { WifiContent } from './wifi-content.js';

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Stable UUID derived from a seed, so reinstalling the profile for the same
 * page replaces the old one instead of adding a duplicate.
 */
function stableUuid(seed: string): string {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
}

const ENCRYPTION: Record<NonNullable<WifiContent['encryption']>, string> = {
  WPA: 'WPA',
  WEP: 'WEP',
  nopass: 'None',
};

/**
 * An Apple configuration profile (.mobileconfig) that adds the network to an
 * iPhone or iPad, so guests join without typing the password. Unsigned: iOS
 * labels it "Not Verified" but installs it normally.
 */
export function buildWifiProfile(input: {
  pageId: string;
  businessName: string;
  wifi: WifiContent;
}): string {
  const ssid = input.wifi.ssid ?? '';
  const encryption = ENCRYPTION[input.wifi.encryption ?? 'WPA'] ?? 'WPA';
  const password = encryption === 'None' ? '' : (input.wifi.password ?? '');
  const id = `ch.taplino.wifi.${input.pageId}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.apple.wifi.managed</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>${xml(id)}.network</string>
      <key>PayloadUUID</key><string>${stableUuid(`${id}.network`)}</string>
      <key>PayloadDisplayName</key><string>${xml(ssid)}</string>
      <key>SSID_STR</key><string>${xml(ssid)}</string>
      <key>HIDDEN_NETWORK</key><${input.wifi.hidden ? 'true' : 'false'}/>
      <key>AutoJoin</key><true/>
      <key>EncryptionType</key><string>${encryption}</string>${
        password
          ? `\n      <key>Password</key><string>${xml(password)}</string>`
          : ''
      }
    </dict>
  </array>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>${xml(id)}</string>
  <key>PayloadUUID</key><string>${stableUuid(id)}</string>
  <key>PayloadDisplayName</key><string>${xml(`Wi-Fi ${ssid}`)}</string>
  <key>PayloadOrganization</key><string>${xml(input.businessName)}</string>
  <key>PayloadDescription</key><string>${xml(`Joins the Wi-Fi network ${ssid} of ${input.businessName}.`)}</string>
  <key>PayloadRemovalDisallowed</key><false/>
</dict>
</plist>
`;
}

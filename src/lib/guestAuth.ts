import crypto from 'crypto';
import { prisma } from './db';

const GUEST_EMAIL_DOMAIN = 'guest.charis.local';

function formatUuidFromHex(hex: string): string {
  const chars = hex.slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}-${chars.slice(16, 20).join('')}-${chars.slice(20, 32).join('')}`;
}

function normalizeFingerprint(fingerprint: string | null | undefined): string {
  return (fingerprint || '').trim() || 'shared-device';
}

export function deriveGuestUserId(fingerprint: string | null | undefined): string {
  const normalized = normalizeFingerprint(fingerprint);
  const hex = crypto.createHash('sha256').update(`charis-guest:${normalized}`).digest('hex');
  return formatUuidFromHex(hex);
}

export function deriveGuestEmail(fingerprint: string | null | undefined): string {
  const normalized = normalizeFingerprint(fingerprint);
  const id = crypto.createHash('sha1').update(`charis-guest-email:${normalized}`).digest('hex').slice(0, 16);
  return `guest+${id}@${GUEST_EMAIL_DOMAIN}`;
}

export async function ensureGuestUser(fingerprint: string | null | undefined) {
  const id = deriveGuestUserId(fingerprint);
  const email = deriveGuestEmail(fingerprint);

  return prisma.user.upsert({
    where: { id },
    update: {
      email,
      isActive: true
    },
    create: {
      id,
      email,
      passwordHash: 'bypass',
      name: 'Guest User',
      role: 'user',
      trustScore: 100,
      isActive: true
    }
  });
}

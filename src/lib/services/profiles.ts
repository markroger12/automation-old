import type { BrowserProfile, ProfileKind } from '@prisma/client';
import { prisma } from '../db';
import { newProfileDirectoryName } from '../paths';

export async function createBrowserProfile(name: string, kind: ProfileKind): Promise<BrowserProfile> {
  return prisma.browserProfile.create({
    data: { name, kind, directory: newProfileDirectoryName(name) },
  });
}

export async function markProfileSession(
  profileId: string,
  status: 'ACTIVE' | 'LOGIN_REQUIRED' | 'ERROR' | 'UNKNOWN',
  detail: string,
): Promise<void> {
  await prisma.browserProfile
    .update({
      where: { id: profileId },
      data: {
        sessionStatus: status,
        sessionDetail: detail.slice(0, 500),
        lastCheckedAt: new Date(),
        ...(status === 'ACTIVE' ? { lastLoginAt: new Date() } : {}),
      },
    })
    .catch(() => undefined);
}

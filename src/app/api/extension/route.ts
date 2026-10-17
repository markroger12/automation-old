import { route } from '@/lib/api';
import { generateExtensionKey, getExtensionStatus } from '@/lib/services/chatgpt-extension';

export const GET = route(async () => {
  return { status: await getExtensionStatus() };
});

/** Creates a new connection key for the Chrome extension. It is returned once and only its hash is stored. */
export const POST = route(async () => {
  return { key: await generateExtensionKey(), status: await getExtensionStatus() };
});

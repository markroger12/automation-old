import { route } from '@/lib/api';
import { enqueueControlJob } from '@/lib/queue';

/**
 * Opens the automation Chrome (its own folder, kept drawing behind other windows) with ChatGPT and the Extensions
 * page, for the one-time setup. The worker opens it, like every other browser window.
 */
export const POST = route(async () => {
  return { jobId: await enqueueControlJob({ action: 'open-chatgpt-chrome', profileId: '' }) };
});

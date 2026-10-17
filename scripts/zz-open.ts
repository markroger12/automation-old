import { enqueueControlJob } from '@/lib/queue';
(async () => { await enqueueControlJob({ action: 'open-chatgpt-chrome', profileId: '' } as any); console.log('enqueued'); process.exit(0); })();

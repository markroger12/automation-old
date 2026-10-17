import { parseBody, route } from '@/lib/api';
import { writeLog } from '@/lib/logger';
import { getSettings, updateSettings } from '@/lib/settings';
import { DEFAULT_SETTINGS, settingsUpdateSchema } from '@/lib/settings-schema';

export const GET = route(async () => {
  return { settings: await getSettings(), defaults: DEFAULT_SETTINGS };
});

export const PUT = route(async (req) => {
  const patch = await parseBody(req, settingsUpdateSchema);
  const merged = { ...(await getSettings()), ...patch };
  if (merged.minKeywordOccurrences > merged.maxKeywordOccurrences) {
    return Response.json({ error: 'Minimum keyword occurrences cannot exceed the maximum' }, { status: 400 });
  }
  const settings = await updateSettings(patch);
  await writeLog({ category: 'SYSTEM', message: 'Settings updated', data: { changed: Object.keys(patch) } });
  return { settings };
});

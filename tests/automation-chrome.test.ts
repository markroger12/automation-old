// The ChatGPT extension's own Chrome: started with its own folder and switches that keep a covered window drawing.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTOMATION_CHROME_SWITCHES, automationChromeArgs } from '@/worker/extension-chrome';

describe('automation Chrome', () => {
  it('starts with its own folder and keeps covered windows drawing', () => {
    const dir = path.join('data', 'chatgpt-chrome');
    expect(automationChromeArgs(dir, ['https://chatgpt.com/'])).toEqual([`--user-data-dir=${dir}`, ...AUTOMATION_CHROME_SWITCHES, 'https://chatgpt.com/']);
    expect(AUTOMATION_CHROME_SWITCHES).toContain('--disable-features=CalculateNativeWinOcclusion');
    expect(AUTOMATION_CHROME_SWITCHES).toContain('--disable-backgrounding-occluded-windows');
    // Without pages it starts in the background; the extension opens its own ChatGPT tabs.
    expect(automationChromeArgs(dir, []).at(-1)).toBe('--no-startup-window');
  });
});

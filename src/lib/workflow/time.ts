// Times in the workflow are the times you see in Pakistan, and a post is entered into WordPress in the time zone the
// website itself uses. Both are worked out here with the time zones the computer already knows — no extra library.

/** The workflow's own clock: the times in the settings are Pakistan time. */
export const WORKFLOW_TIMEZONE = 'Asia/Karachi';

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = FORMATTERS.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTERS.set(timeZone, found);
  }
  return found;
}

/** True for a name the computer knows, like "Europe/Berlin". */
export function isTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The clock on the wall in that part of the world at that moment. */
export function wallClockIn(date: Date, timeZone: string): WallClock & { second: number } {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Midnight comes back as "24" in some versions.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** How far that time zone is ahead of UTC at that moment, in milliseconds. */
function offsetOf(date: Date, timeZone: string): number {
  const clock = wallClockIn(date, timeZone);
  return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) - date.getTime();
}

/** The real moment at which that wall clock shows this time in that part of the world. */
export function fromWallClock(clock: WallClock, timeZone: string): Date {
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, 0);
  // Twice, because the offset itself can change at the moment we are aiming for (summer time).
  const first = new Date(asUtc - offsetOf(new Date(asUtc), timeZone));
  return new Date(asUtc - offsetOf(first, timeZone));
}

/** "2026-09-24 04:30" as the website's own clock shows it — what goes into the WordPress date fields. */
export function localStamp(date: Date, timeZone: string): string {
  const clock = wallClockIn(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)} ${pad(clock.hour)}:${pad(clock.minute)}`;
}

/**
 * Reads the publish times. Both ways of writing a time are understood, so "4:30 PM", "4 pm" and "16:30" all mean the
 * same moment. They are kept as "16:30" and shown again as "4:30 PM".
 */
export function parseTimes(values: unknown): { hour: number; minute: number }[] {
  const list = Array.isArray(values) ? values : [];
  const times: { hour: number; minute: number }[] = [];
  for (const entry of list) {
    const text = String(entry).trim().toLowerCase().replace(/\s+/g, ' ');
    const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
    if (!match) continue;
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? '0');
    const half = match[3];
    if (half) {
      if (hour < 1 || hour > 12) continue;
      hour = (hour % 12) + (half === 'pm' ? 12 : 0);
    }
    if (hour > 23 || minute > 59) continue;
    if (times.some((time) => time.hour === hour && time.minute === minute)) continue;
    times.push({ hour, minute });
  }
  return times.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
}

/** How a time is stored: "16:30". */
export const formatTime = (time: { hour: number; minute: number }) => `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;

/** How a time is shown and typed: "4:30 PM". */
export function formatTime12(time: { hour: number; minute: number }): string {
  const half = time.hour < 12 ? 'AM' : 'PM';
  const hour = time.hour % 12 === 0 ? 12 : time.hour % 12;
  return `${hour}:${String(time.minute).padStart(2, '0')} ${half}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A whole moment as it is shown on the page: "24 Sep, 4:30 AM". */
export function localStamp12(date: Date, timeZone: string): string {
  const clock = wallClockIn(date, timeZone);
  return `${clock.day} ${MONTHS[clock.month - 1]}, ${formatTime12(clock)}`;
}

/**
 * The next moments at which an article goes live. `days` holds the weekdays it runs (0 = Sunday, empty = every day),
 * counted in the workflow's own time zone.
 */
export function nextPublishSlots(options: { times: unknown; days?: unknown; from?: Date; count: number; timeZone?: string }): Date[] {
  const timeZone = options.timeZone ?? WORKFLOW_TIMEZONE;
  const times = parseTimes(options.times);
  if (!times.length || options.count <= 0) return [];
  const days = (Array.isArray(options.days) ? options.days : []).map(Number).filter((day) => day >= 0 && day <= 6);
  const from = options.from ?? new Date();
  const slots: Date[] = [];
  const today = wallClockIn(from, timeZone);

  for (let ahead = 0; ahead < 370 && slots.length < options.count; ahead++) {
    // Midday keeps the date right whatever the offset does.
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead, 12));
    const clock = wallClockIn(day, timeZone);
    if (days.length) {
      const weekday = new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay();
      if (!days.includes(weekday)) continue;
    }
    for (const time of times) {
      const moment = fromWallClock({ year: clock.year, month: clock.month, day: clock.day, ...time }, timeZone);
      if (moment.getTime() <= from.getTime()) continue;
      slots.push(moment);
      if (slots.length >= options.count) break;
    }
  }
  return slots;
}

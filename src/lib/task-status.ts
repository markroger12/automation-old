// Shared (client + server) task status metadata.
// Kept independent from @prisma/client so it can be imported by client components.

export const TASK_STATUSES = [
  'QUEUED',
  'OPENING_CHATGPT',
  'GENERATING_TITLES',
  'AWAITING_TITLE_APPROVAL',
  'RESEARCHING',
  'WRITING_ARTICLE',
  'OPTIMIZING',
  'GENERATING_FAQS',
  'GENERATING_BIO_TABLE',
  'SEO_CHECKING',
  'AWAITING_ARTICLE_APPROVAL',
  'OPENING_WORDPRESS',
  'CREATING_DRAFT',
  'RUNNING_RANKMATH',
  'DRAFT_CREATED',
  'NEEDS_REVIEW',
  'LOGIN_REQUIRED',
  'FAILED',
  'CANCELLED',
] as const;

export type TaskStatusValue = (typeof TASK_STATUSES)[number];

export type StatusTone = 'gray' | 'blue' | 'indigo' | 'amber' | 'green' | 'red' | 'violet';
export type StatusGroup = 'queued' | 'running' | 'waiting' | 'done' | 'failed';

interface StatusMeta {
  label: string;
  tone: StatusTone;
  group: StatusGroup;
}

export const STATUS_META: Record<TaskStatusValue, StatusMeta> = {
  QUEUED: { label: 'Queued', tone: 'gray', group: 'queued' },
  OPENING_CHATGPT: { label: 'Opening ChatGPT', tone: 'blue', group: 'running' },
  GENERATING_TITLES: { label: 'Generating Titles', tone: 'blue', group: 'running' },
  AWAITING_TITLE_APPROVAL: { label: 'Awaiting Title Approval', tone: 'amber', group: 'waiting' },
  RESEARCHING: { label: 'Researching', tone: 'blue', group: 'running' },
  WRITING_ARTICLE: { label: 'Writing Article', tone: 'blue', group: 'running' },
  OPTIMIZING: { label: 'Optimizing', tone: 'blue', group: 'running' },
  GENERATING_FAQS: { label: 'Generating FAQs', tone: 'blue', group: 'running' },
  GENERATING_BIO_TABLE: { label: 'Generating Bio Table', tone: 'blue', group: 'running' },
  SEO_CHECKING: { label: 'SEO Checking', tone: 'indigo', group: 'running' },
  AWAITING_ARTICLE_APPROVAL: { label: 'Awaiting Article Approval', tone: 'amber', group: 'waiting' },
  OPENING_WORDPRESS: { label: 'Opening WordPress', tone: 'violet', group: 'running' },
  CREATING_DRAFT: { label: 'Creating Draft', tone: 'violet', group: 'running' },
  RUNNING_RANKMATH: { label: 'Running Rank Math Check', tone: 'violet', group: 'running' },
  DRAFT_CREATED: { label: 'Draft Created', tone: 'green', group: 'done' },
  NEEDS_REVIEW: { label: 'Needs Review', tone: 'amber', group: 'done' },
  LOGIN_REQUIRED: { label: 'Login Required', tone: 'amber', group: 'waiting' },
  FAILED: { label: 'Failed', tone: 'red', group: 'failed' },
  CANCELLED: { label: 'Cancelled', tone: 'gray', group: 'failed' },
};

export const RUNNING_STATUSES = TASK_STATUSES.filter((s) => STATUS_META[s].group === 'running');
export const WAITING_STATUSES = TASK_STATUSES.filter((s) => STATUS_META[s].group === 'waiting');

/** Statuses in which a job is (or should be) in the queue / worker. */
export const IN_FLIGHT_STATUSES: TaskStatusValue[] = ['QUEUED', ...RUNNING_STATUSES];

export function isInFlight(status: string): boolean {
  return (IN_FLIGHT_STATUSES as string[]).includes(status);
}

export function statusLabel(status: string): string {
  return STATUS_META[status as TaskStatusValue]?.label ?? status;
}

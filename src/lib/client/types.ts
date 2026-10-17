// Response shapes used by dashboard pages (dates arrive as ISO strings).

export type ProfileKind = 'CHATGPT' | 'WORDPRESS' | 'GENERIC';

export interface TaskListItem {
  id: string;
  moduleKey: string;
  keyword: string;
  selectedTitle: string | null;
  status: string;
  progress: number;
  currentStage: string | null;
  statusMessage: string | null;
  loginRequiredFor: string | null;
  categoryName: string | null;
  wordCount: number | null;
  seoScore: number | null;
  rankMathScore: number | null;
  wpEditUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  website: { id: string; name: string } | null;
}

export interface TaskListResponse {
  total: number;
  page: number;
  pageSize: number;
  tasks: TaskListItem[];
}

export interface ProfileItem {
  id: string;
  name: string;
  kind: ProfileKind;
  sessionStatus: string;
  sessionDetail: string | null;
  lastCheckedAt: string | null;
  lastLoginAt?: string | null;
  websites: { id: string; name: string }[];
}

export interface CategoryItem {
  id: string;
  name: string;
  websiteId: string;
}

export interface WebsiteItem {
  id: string;
  name: string;
  url: string;
  adminUrl: string;
  profileId: string | null;
  defaultCategoryId: string | null;
  defaultAuthor: string | null;
  editorType: 'AUTO' | 'GUTENBERG' | 'CLASSIC';
  isActive: boolean;
  /** Images for this website's celebrity articles and for its Tigram articles (off for a site whose pictures come from somewhere else). */
  celebrityImages: boolean;
  tigramImages: boolean;
  /** Workflow: this website may schedule and publish by itself, the time zone WordPress uses, and its Search Console property. */
  canPublish: boolean;
  siteTimezone: string | null;
  searchConsoleProperty: string | null;
  /** Image template: the uploaded logo file, the colour of the line and the corner the logo sits in. */
  logoFile: string | null;
  accentColour: string | null;
  logoPosition: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left' | null;
  /** Featured image: two pictures with the line between them, or a single picture. */
  featuredStyle: 'split' | 'single' | null;
  /** The design made in the Image Template editor. */
  imageTemplate: { featured?: unknown; body?: unknown } | null;
  /** Text before the link to the previous article (empty = no internal link). */
  internalLinkLine: string;
  categories: CategoryItem[];
  profile: Omit<ProfileItem, 'websites'> | null;
  _count: { tasks: number };
}

export interface StageItem {
  id: string;
  key: string;
  label: string;
  position: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  attempts: number;
  prompt: string | null;
  output: string | null;
  outputHtml: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface BioRow {
  attribute: string;
  details: string;
}

export interface TaskDetail extends Omit<TaskListItem, 'website'> {
  exampleTitle: string | null;
  secondaryKeywords: string[];
  targetCountry: string | null;
  language: string | null;
  websiteId: string | null;
  categoryId: string | null;
  reviewReasons: string[];
  titleOptions: string[];
  recommendedTitle: string | null;
  titleApprovedAt: string | null;
  articleApprovedAt: string | null;
  bodyHtml: string | null;
  contentHtml: string | null;
  faqs: FaqItem[] | null;
  quickBio: BioRow[] | null;
  seoTitle: string | null;
  metaDescription: string | null;
  slug: string | null;
  focusKeyword: string | null;
  tags: string[];
  keywordCount: number | null;
  keywordDensity: number | null;
  h2Count: number | null;
  h3Count: number | null;
  chatgptConversationUrl: string | null;
  wpPostId: string | null;
  wpDraftSavedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  website: { id: string; name: string; url: string; profileId: string | null } | null;
  category: { id: string; name: string } | null;
  stages: StageItem[];
  _count: { responses: number; logs: number };
}

export interface SeoCheckItem {
  id: string;
  label: string;
  group: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  weight: number;
}

export interface SeoReportItem {
  id: string;
  source: 'INTERNAL' | 'RANKMATH';
  score: number | null;
  checks: SeoCheckItem[] | { status: string; message: string }[];
  metrics: Record<string, number> | null;
  createdAt: string;
}

export interface TaskDetailResponse {
  task: TaskDetail;
  internalReport: SeoReportItem | null;
  rankMathReport: SeoReportItem | null;
}

export interface LogItem {
  id: string;
  taskId: string | null;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  category: string;
  stage: string | null;
  message: string;
  data: unknown;
  screenshotPath: string | null;
  createdAt: string;
  task?: { keyword: string } | null;
}

export interface ConversationItem {
  id: string;
  stageKey: string;
  attempt: number;
  prompt: string;
  responseText: string;
  conversationUrl: string | null;
  reusedExisting: boolean;
  durationMs: number | null;
  createdAt: string;
}

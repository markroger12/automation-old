import type { Page } from 'playwright';
import type { Prisma, TaskStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createLogger, writeLog } from '@/lib/logger';
import type { ArticleJobMode } from '@/lib/queue';
import { renderPrompt, type PromptVariables } from '@/lib/prompts/render';
import type { ExtensionAttachment, ExtensionImageRequest } from '@/lib/chatgpt-extension';
import type { AppSettings } from '@/lib/settings-schema';
import { languageInstruction } from '@/lib/content-locale';
import { getPromptContent } from '@/lib/services/prompts';
import type { BrowserLease, BrowserManager } from '../browser/browser-manager';
import { captureScreenshot } from '../browser/screenshots';
import { askChatGPTViaExtension, type ChatGPTAnswer } from '../chatgpt/extension-bridge';
import { ConfigurationError, ConversationLostError } from '../errors';
import type { PostEditor } from '../wordpress/editor';
import { hideAssistantOverlays } from '../wordpress/overlays';
import { installPublishGuard } from '../wordpress/publish-guard';
import { WordPressClient, normalizeAdminUrl } from '../wordpress/wordpress-client';
import type { PipelineDefinition, PipelineStage } from './types';

const taskInclude = { website: { include: { profile: true } }, category: true } satisfies Prisma.ArticleTaskInclude;
export type TaskWithRelations = Prisma.ArticleTaskGetPayload<{ include: typeof taskInclude }>;

/**
 * Per-job state: the task record, the WordPress browser tab (ChatGPT runs through the Chrome extension),
 * prompt rendering and persistence helpers used by pipeline stages.
 */
export class PipelineContext {
  task!: TaskWithRelations;
  attempt = 1;
  currentStage: PipelineStage | null = null;
  /** True when the original ChatGPT conversation is gone and earlier outputs must be re-supplied. */
  contextLost = false;
  /** Open WordPress editor shared between the draft and Rank Math stages. */
  editor: PostEditor | null = null;
  readonly logger;

  private conversationChecked = false;
  private wpLease: BrowserLease | null = null;
  private wpPage: Page | null = null;
  private wpClient: WordPressClient | null = null;
  private readonly sentThisJob = new Set<string>();
  private cancelCache: { at: number; value: boolean } = { at: 0, value: false };

  constructor(
    readonly taskId: string,
    readonly mode: ArticleJobMode,
    readonly browser: BrowserManager,
    readonly settings: AppSettings,
    readonly pipeline: PipelineDefinition,
  ) {
    this.logger = createLogger({ taskId, category: 'SYSTEM' });
  }

  log(category: 'CHATGPT' | 'WORDPRESS' | 'RANKMATH' | 'SEO' | 'BROWSER' | 'SYSTEM') {
    return this.logger.child({ category, stage: this.currentStage?.key ?? null });
  }

  async reload(): Promise<TaskWithRelations> {
    this.task = await prisma.articleTask.findUniqueOrThrow({ where: { id: this.taskId }, include: taskInclude });
    return this.task;
  }

  async update(data: Prisma.ArticleTaskUpdateInput): Promise<TaskWithRelations> {
    this.task = await prisma.articleTask.update({ where: { id: this.taskId }, data, include: taskInclude });
    return this.task;
  }

  async setStatus(status: TaskStatus, statusMessage?: string | null): Promise<void> {
    await this.update({ status, ...(statusMessage !== undefined ? { statusMessage } : {}) });
  }

  async isCancelRequested(fresh = false): Promise<boolean> {
    if (!fresh && Date.now() - this.cancelCache.at < 5000) return this.cancelCache.value;
    const row = await prisma.articleTask.findUnique({ where: { id: this.taskId }, select: { cancelRequested: true } });
    this.cancelCache = { at: Date.now(), value: Boolean(row?.cancelRequested ?? true) };
    return this.cancelCache.value;
  }

  async stageOutput(key: string): Promise<string | null> {
    const row = await prisma.articleStage.findUnique({
      where: { taskId_key: { taskId: this.taskId, key } },
      select: { output: true },
    });
    return row?.output ?? null;
  }

  /**
   * The prompt with its variables filled in and, unless `language` is false, the article-language line after it.
   * A prompt that asks for pictures gets no language line: there is nothing to write, and the user did not want it
   * under the image search prompt (27 September 2026).
   */
  async renderPrompt(promptKey: string, extra?: PromptVariables, options: { language?: boolean } = {}): Promise<string> {
    const template = await getPromptContent(this.task.moduleKey, promptKey);
    const vars = await this.pipeline.variables(this, extra);
    const rendered = renderPrompt(template, vars);
    if (options.language === false) return rendered;
    const instruction = languageInstruction(this.task.language ?? this.settings.defaultLanguage, this.task.targetCountry ?? this.settings.targetCountry);
    return instruction ? `${rendered}\n\n${instruction}` : rendered;
  }

  // ───────────────────────────── ChatGPT ─────────────────────────────

  private async completedChatStageCount(): Promise<number> {
    return prisma.articleStage.count({
      where: {
        taskId: this.taskId,
        status: 'COMPLETED',
        key: { in: this.pipeline.stages.filter((s) => s.kind === 'chatgpt').map((s) => s.key) },
      },
    });
  }

  /**
   * Renders a prompt, sends it in the task's single ChatGPT conversation and stores the result.
   * Safe to retry: a prompt already sent by an earlier attempt is recovered, not duplicated.
   * Goes through the ChatGPT Worker Chrome extension.
   */
  async askChatGPT(
    stageKey: string,
    promptKey: string,
    extra?: PromptVariables,
    /**
     * fresh: always send the prompt, never take an answer already in the conversation.
     * newChat: send it in a new chat and leave the task's own conversation as it is (a prompt that needs no context).
     */
    options: { images?: ExtensionImageRequest; fresh?: boolean; attachments?: ExtensionAttachment[]; newChat?: boolean } = {},
  ): Promise<{ prompt: string; answer: ChatGPTAnswer }> {
    const prompt = await this.renderPrompt(promptKey, extra, { language: !options.images });
    if (!this.conversationChecked) {
      // A task with finished ChatGPT stages but no saved conversation needs its earlier outputs as context.
      if (!this.task.chatgptConversationUrl) this.contextLost = (await this.completedChatStageCount()) > 0;
      this.conversationChecked = true;
    }

    // A regeneration must send a fresh prompt the first time; everything else may recover an existing answer.
    const allowReuse = !options.fresh && (this.mode === 'run' || this.attempt > 1 || this.sentThisJob.has(stageKey));
    this.sentThisJob.add(stageKey);

    let toSend = prompt;
    let answer: ChatGPTAnswer | null = null;
    for (let round = 1; !answer; round++) {
      toSend = prompt;
      if (this.contextLost && this.pipeline.contextPrimer && !options.newChat) {
        const primer = await this.pipeline.contextPrimer(this, stageKey);
        if (primer) {
          toSend = `${primer}\n\n---\n\n${prompt}`;
          this.log('CHATGPT').warn('Original conversation unavailable — including earlier outputs as context');
        }
      }

      await prisma.articleStage.update({ where: { taskId_key: { taskId: this.taskId, key: stageKey } }, data: { prompt: toSend } });
      this.log('CHATGPT').info(`Sending ${stageKey} prompt through the ChatGPT Chrome extension`, { prompt: toSend });

      try {
        answer = await askChatGPTViaExtension({
          taskId: this.taskId,
          stageKey,
          keyword: this.task.keyword,
          prompt: toSend,
          conversationUrl: options.newChat ? null : this.task.chatgptConversationUrl,
          allowReuse,
          chatgptUrl: this.settings.chatgptUrl,
          navigationTimeoutMs: this.settings.browserTimeoutSec * 1000,
          generationTimeoutMs: this.settings.generationTimeoutSec * 1000,
          images: options.images,
          attachments: options.attachments,
          logger: this.log('CHATGPT'),
          shouldAbort: () => this.isCancelRequested(),
          onWaiting: (message) => this.update({ statusMessage: message }),
          onConversationUrl: options.newChat ? undefined : (url) => this.update({ chatgptConversationUrl: url }),
        });
      } catch (err) {
        if (!(err instanceof ConversationLostError) || round > 1) throw err;
        this.log('CHATGPT').warn('Saved ChatGPT conversation could not be reopened; starting a new conversation', {
          url: this.task.chatgptConversationUrl,
        });
        await this.update({ chatgptConversationUrl: null });
        this.contextLost = (await this.completedChatStageCount()) > 0;
      }
    }
    this.contextLost = false;

    if (!options.newChat && answer.conversationUrl && answer.conversationUrl !== this.task.chatgptConversationUrl) {
      await this.update({ chatgptConversationUrl: answer.conversationUrl });
    }
    await prisma.chatGPTResponse.create({
      data: {
        taskId: this.taskId,
        stageKey,
        attempt: this.attempt,
        prompt: toSend,
        responseText: answer.text,
        responseHtml: answer.html,
        conversationUrl: answer.conversationUrl,
        reusedExisting: answer.reusedExisting,
        durationMs: answer.durationMs,
      },
    });
    this.log('CHATGPT').info(
      `ChatGPT ${stageKey} response received (${answer.text.length} chars, ${Math.round(answer.durationMs / 1000)}s${
        answer.reusedExisting ? ', recovered existing answer' : ''
      })`,
      { response: answer.text },
    );
    return { prompt: toSend, answer };
  }

  // ──────────────────────────── WordPress ────────────────────────────

  async wordpress(): Promise<WordPressClient> {
    if (this.wpClient && this.wpPage && !this.wpPage.isClosed()) return this.wpClient;
    const website = this.task.website;
    if (!website) throw new ConfigurationError('No website is selected for this article.');
    if (!website.profile) {
      throw new ConfigurationError(`Website "${website.name}" has no browser profile. Edit the website and assign or create one.`);
    }
    if (!this.wpLease) this.wpLease = await this.acquireWhenLoginWindowClosed(website.profile);
    this.wpPage = await this.wpLease.newPage();
    const logger = this.log('WORDPRESS');
    await installPublishGuard(this.wpPage, logger);
    await hideAssistantOverlays(this.wpPage);
    this.wpClient = new WordPressClient(
      this.wpPage,
      { name: website.name, adminUrl: normalizeAdminUrl(website.url, website.adminUrl), editorType: website.editorType },
      {
        timeoutMs: this.settings.browserTimeoutSec * 1000,
        logger,
        selectorOverrides: { wordpress: this.settings.selectorOverrides.wordpress, rankmath: this.settings.selectorOverrides.rankmath },
      },
    );
    return this.wpClient;
  }

  /** If the user still has the login window open for this profile, wait (up to 15 minutes) until it is closed. */
  private async acquireWhenLoginWindowClosed(profile: { id: string; directory: string; name: string }): Promise<BrowserLease> {
    if (this.browser.isManualWindowOpen(profile.id)) {
      this.log('BROWSER').info(`Waiting for the "${profile.name}" login window to be closed before continuing`);
      await this.update({ statusMessage: `Waiting for you to close the "${profile.name}" login window` });
    }
    return this.browser.acquire(profile, { waitForManualWindowMs: 15 * 60_000 });
  }

  // ──────────────────────────── Recovery ────────────────────────────

  /** Prepare browser state for another attempt of the current stage. */
  async recoverForRetry(): Promise<void> {
    if (this.currentStage?.kind === 'wordpress') {
      this.editor = null;
      if (this.wpPage && !this.wpPage.isClosed()) await this.wpPage.close().catch(() => undefined);
      this.wpPage = null;
      this.wpClient = null;
    }
  }

  async screenshot(label: string): Promise<string | null> {
    if (!this.settings.captureScreenshots) return null;
    // ChatGPT runs in the user's own Chrome, so only WordPress stages have a page to capture.
    return captureScreenshot(this.currentStage?.kind === 'wordpress' ? this.wpPage : null, this.taskId, label);
  }

  async logWithScreenshot(
    level: 'WARN' | 'ERROR',
    category: 'CHATGPT' | 'WORDPRESS' | 'RANKMATH' | 'SYSTEM',
    message: string,
    label: string,
    data?: unknown,
  ): Promise<void> {
    const screenshotPath = await this.screenshot(label);
    await writeLog({ taskId: this.taskId, level, category, stage: this.currentStage?.key, message, data, screenshotPath });
  }

  async dispose(): Promise<void> {
    await this.wpLease?.release().catch(() => undefined);
    this.wpLease = null;
  }
}

import type { ArticleTask, Prisma, TaskStatus } from '@prisma/client';
import type { PromptVariables } from '@/lib/prompts/render';
import type { StageKind } from '@/modules/types';
import type { PipelineContext } from './context';

export type StageResult =
  | {
      outcome: 'completed';
      prompt?: string | null;
      output?: string | null;
      outputHtml?: string | null;
      data?: Prisma.InputJsonValue;
    }
  | { outcome: 'paused'; status: TaskStatus; message: string };

export interface PipelineStage {
  key: string;
  label: string;
  kind: StageKind;
  /** Task status shown while this stage runs */
  status: TaskStatus;
  /** Task progress (0-100) once this stage completes */
  progress: number;
  run(ctx: PipelineContext): Promise<StageResult>;
}

/** Worker-side definition of a module's workflow. */
export interface PipelineDefinition {
  moduleKey: string;
  stages: PipelineStage[];
  /** Stage keys to reset and re-run when the user regenerates `stageKey`. */
  regenerationPlan(stageKey: string, task: ArticleTask): string[];
  /** Variables available to this module's prompt templates. */
  variables(ctx: PipelineContext, extra?: PromptVariables): Promise<PromptVariables>;
  /** Context to prepend when the original ChatGPT conversation could not be reopened. */
  contextPrimer?(ctx: PipelineContext, stageKey: string): Promise<string | null>;
  /** Called after every stage completed in a normal run. */
  finalize(ctx: PipelineContext): Promise<void>;
  /** Called after a regeneration job. */
  afterRegeneration(ctx: PipelineContext, stageKey: string): Promise<void>;
}

// Worker-only registry: moduleKey → pipeline definition.
// Register new module pipelines here (see docs/ADDING_MODULES.md).
import type { PipelineDefinition } from '@/automation/pipeline/types';
import { celebrityPipeline } from './celebrity-writer/pipeline';
import { celebrityWriter2Pipeline } from './celebrity-writer-2/pipeline';
import { tigramPipeline } from './tigram-writer/pipeline';

export const PIPELINES: Record<string, PipelineDefinition> = {
  [celebrityPipeline.moduleKey]: celebrityPipeline,
  [celebrityWriter2Pipeline.moduleKey]: celebrityWriter2Pipeline,
  [tigramPipeline.moduleKey]: tigramPipeline,
};

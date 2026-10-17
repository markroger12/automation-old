// Module contracts. A "module" is a dashboard tool (e.g. Celebrity Article Writer).
// Manifests are client-safe (no server imports); pipelines are registered separately
// for the worker in `src/modules/pipelines.server.ts`.

export type ModuleIconName =
  | 'star'
  | 'pen'
  | 'map-pin'
  | 'package'
  | 'newspaper'
  | 'search'
  | 'link'
  | 'shield'
  | 'layers';

export type ModuleStatus = 'active' | 'coming-soon';

export type StageKind = 'chatgpt' | 'local' | 'gate' | 'wordpress';

export interface StageDescriptor {
  key: string;
  label: string;
  kind: StageKind;
  /** Shown in "Regenerate Stage" menus */
  regenerable?: boolean;
  /** Prompt template used by this stage (chatgpt stages) */
  promptKey?: string;
}

export interface PromptDefinition {
  key: string;
  name: string;
  description: string;
  defaultContent: string;
}

export interface PromptVariableDoc {
  name: string;
  description: string;
  sample: string;
}

export interface ModuleManifest {
  key: string;
  name: string;
  description: string;
  icon: ModuleIconName;
  href: string;
  status: ModuleStatus;
  group: 'Writers' | 'SEO Tools';
  stages: StageDescriptor[];
  prompts: PromptDefinition[];
  variables: PromptVariableDoc[];
}

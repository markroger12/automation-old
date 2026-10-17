// Prompt template rendering (shared by worker and Prompt Manager preview).
//
// Supported syntax:
//   {{variable}}                      -> replaced with the value (empty string when missing)
//   {{#if variable}} ... {{/if}}      -> block kept only when the variable is non-empty
//   {{#unless variable}} ... {{/unless}}

export type PromptVariables = Record<string, string | number | null | undefined>;

const VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function valueOf(vars: PromptVariables, name: string): string {
  const v = vars[name];
  return v === null || v === undefined ? '' : String(v);
}

export function renderPrompt(template: string, vars: PromptVariables): string {
  let out = template;
  // Resolve conditionals first (non-nested, repeated until stable).
  for (let i = 0; i < 10; i++) {
    const before = out;
    out = out.replace(/\{\{#if\s+([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, name: string, body: string) =>
      valueOf(vars, name).trim() ? body : '',
    );
    out = out.replace(
      /\{\{#unless\s+([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/unless\}\}/g,
      (_m, name: string, body: string) => (valueOf(vars, name).trim() ? '' : body),
    );
    if (out === before) break;
  }
  out = out.replace(VAR_PATTERN, (_m, name: string) => valueOf(vars, name));
  // Collapse the blank lines left behind by removed conditional blocks.
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function extractVariables(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*(?:#if\s+|#unless\s+)?([a-zA-Z0-9_]+)\s*\}\}/g)) {
    names.add(match[1]);
  }
  return Array.from(names);
}

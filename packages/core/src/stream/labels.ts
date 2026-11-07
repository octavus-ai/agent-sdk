import type { UIOperationPart, UIToolCallPart, UIWorkerPart } from './types';

/**
 * What identifies a visible part, independent of how it is labeled: the tool's
 * name, the worker's slug, or the operation's block type and name. An app with
 * its own label registry keys on this.
 */
export type PartIdentity =
  | { kind: 'tool'; toolName: string }
  | { kind: 'worker'; workerSlug: string }
  | { kind: 'operation'; operationType: string; name: string };

/**
 * Supplies a label for an identity the app knows, or `undefined` to fall back
 * to the label derived from the identity itself.
 */
export type PartLabelResolver = (identity: PartIdentity) => string | undefined;

/** A part that carries an identity and may carry an authored title. */
export type LabeledPart =
  | Pick<UIToolCallPart, 'type' | 'toolName' | 'title'>
  | Pick<UIWorkerPart, 'type' | 'workerSlug' | 'title'>
  | Pick<UIOperationPart, 'type' | 'operationType' | 'name' | 'title'>;

/** The identity of a tool-call, worker, or operation part. */
export function getPartIdentity(part: LabeledPart): PartIdentity {
  switch (part.type) {
    case 'tool-call':
      return { kind: 'tool', toolName: part.toolName };
    case 'worker':
      return { kind: 'worker', workerSlug: part.workerSlug };
    case 'operation':
      return { kind: 'operation', operationType: part.operationType, name: part.name };
  }
}

/**
 * The label a part shows in every visible display mode: its authored `title`,
 * else what the app's resolver returns for its identity, else a label derived
 * from the identity (the tool name, the worker slug, or the block name).
 */
export function getPartLabel(part: LabeledPart, resolve?: PartLabelResolver): string {
  const title = part.title?.trim();
  if (title) return title;
  const identity = getPartIdentity(part);
  const resolved = resolve?.(identity)?.trim();
  if (resolved) return resolved;
  return formatIdentityLabel(identity);
}

/**
 * A readable label derived from an identity alone. A namespaced tool
 * (`browser-extension__navigate`) reads as "Browser extension: navigate"; a
 * worker slug reads as its words; an operation reads as its block name.
 */
export function formatIdentityLabel(identity: PartIdentity): string {
  switch (identity.kind) {
    case 'tool': {
      const name = identity.toolName.replace(/^mcp__/, '');
      const separator = name.indexOf('__');
      if (separator > 0) {
        const namespace = humanize(name.slice(0, separator));
        const tool = humanize(name.slice(separator + 2));
        return `${capitalize(namespace)}: ${tool}`;
      }
      return capitalize(humanize(name));
    }
    case 'worker':
      return capitalize(humanize(identity.workerSlug));
    case 'operation':
      return identity.name.trim() || capitalize(humanize(identity.operationType));
  }
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

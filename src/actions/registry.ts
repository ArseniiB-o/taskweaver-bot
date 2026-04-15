import type { Action } from './types.js';
import { audioActions } from './audio.js';
import { videoActions } from './video.js';
import { imageActions } from './image.js';
import { documentActions } from './document.js';
import { archiveActions } from './archive.js';
import { codeActions } from './code.js';
import { textActions } from './text.js';
import { webActions } from './web.js';
import { dataActions } from './data.js';
import { fileActions } from './file.js';
import { securityActions } from './security.js';

const allActions: Action[] = [
  ...audioActions,
  ...videoActions,
  ...imageActions,
  ...documentActions,
  ...archiveActions,
  ...codeActions,
  ...textActions,
  ...webActions,
  ...dataActions,
  ...fileActions,
  ...securityActions,
];

const actionMap = new Map<string, Action>();
for (const action of allActions) {
  actionMap.set(action.id, action);
}

export function getAction(id: string): Action | undefined {
  return actionMap.get(id);
}

export function getAllActions(): Action[] {
  return allActions;
}

export function getActionsByCategory(category: string): Action[] {
  return allActions.filter(a => a.category === category);
}

export function getCategories(): string[] {
  return [...new Set(allActions.map(a => a.category))];
}

export function buildActionCatalog(): string {
  const lines: string[] = ['AVAILABLE ACTIONS:'];
  const grouped = new Map<string, Action[]>();

  for (const action of allActions) {
    const list = grouped.get(action.category) || [];
    list.push(action);
    grouped.set(action.category, list);
  }

  for (const [category, actions] of grouped) {
    lines.push(`\n## ${category.toUpperCase()}`);
    for (const a of actions) {
      const params = a.params
        .map(p => {
          const req = p.required ? '' : '?';
          const en = p.enum ? ` [${p.enum.join('|')}]` : '';
          return `${p.name}${req}: ${p.type}${en}`;
        })
        .join(', ');
      lines.push(`- ${a.id}(${params}) — ${a.description}`);
    }
  }

  lines.push(`\nTotal: ${allActions.length} actions`);
  return lines.join('\n');
}

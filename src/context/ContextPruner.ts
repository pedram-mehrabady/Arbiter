import { AssembledContext, ServiceResult } from '../types/index';
import { estimateTokenCount } from '../providers/LLMProvider';

const PRUNE_THRESHOLD = 70_000;
const HEAD_KEEP_TOKENS = 500;
const TAIL_KEEP_TOKENS = 200;
const PRUNE_MARKER = '[PRUNED: {n} tokens]';

// Never prune these sections — they are always mandatory for AFTA evidence integrity
const NEVER_PRUNE_HEADERS = ['# SYSTEM', '# TASK', '# FILE: task.md', '# FILE: MASTER-DIRECTIVES.md'];

export class ContextPruner {
  // Returns the context unchanged if under threshold.
  // When over threshold: sorts prior-phase sections by age+size, replaces body
  // with head (first ~500 tokens) + tail (last ~200 tokens) + prune marker.
  prune(context: AssembledContext): ServiceResult<AssembledContext> {
    if (context.tokenEstimate <= PRUNE_THRESHOLD) {
      return { ok: true, value: context };
    }

    const sections = this.splitIntoSections(context.prompt);
    const prunable = sections.filter(s => !this.isProtected(s.header));
    const protected_ = sections.filter(s => this.isProtected(s.header));

    // Sort prunable sections by size descending — prune largest first
    prunable.sort((a, b) => b.body.length - a.body.length);

    let totalSaved = 0;
    const prunedSections = prunable.map(section => {
      const sectionTokens = estimateTokenCount(section.body);
      if (sectionTokens < 200) return section;

      const headChars = HEAD_KEEP_TOKENS * 4;
      const tailChars = TAIL_KEEP_TOKENS * 4;
      const tokensToSave = sectionTokens - HEAD_KEEP_TOKENS - TAIL_KEEP_TOKENS;

      if (tokensToSave <= 0) return section;

      const head = section.body.slice(0, headChars);
      const tail = section.body.slice(-tailChars);
      const marker = PRUNE_MARKER.replace('{n}', String(tokensToSave));

      totalSaved += tokensToSave;
      return { header: section.header, body: `${head}\n\n${marker}\n\n${tail}` };
    });

    // Only apply pruning if it actually helps
    if (totalSaved === 0) {
      return { ok: true, value: context };
    }

    const allSections = [...protected_, ...prunedSections];
    const prompt = allSections.map(s => `${s.header}\n\n${s.body}`).join('\n\n' + '─'.repeat(60) + '\n\n');
    const newTokenEstimate = estimateTokenCount(prompt);

    return {
      ok: true,
      value: {
        ...context,
        prompt,
        tokenEstimate: newTokenEstimate,
        pruned: true,
        prunedTokensSaved: totalSaved,
      },
    };
  }

  private splitIntoSections(prompt: string): Array<{ header: string; body: string }> {
    const parts = prompt.split(/\n\n─{60}\n\n/);
    return parts.map(part => {
      const firstNewline = part.indexOf('\n');
      if (firstNewline === -1) return { header: part, body: '' };
      return {
        header: part.slice(0, firstNewline).trim(),
        body: part.slice(firstNewline + 1).trim(),
      };
    });
  }

  private isProtected(header: string): boolean {
    return NEVER_PRUNE_HEADERS.some(h => header.startsWith(h));
  }
}

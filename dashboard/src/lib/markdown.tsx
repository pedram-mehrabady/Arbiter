import { createElement, type ReactNode } from 'react';

// Inline formatting: **bold**, *italic*, `code`
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on the three inline tokens, keeping delimiters
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index));
    const tok = m[0];
    const key = `${keyBase}-i${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={key} className="md-code">{tok.slice(1, -1)}</code>);
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    lastIndex = m.index + tok.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

// Minimal, safe (JSX-only) markdown → React. Handles headings, lists,
// checkboxes, hr, fenced code, blockquotes, and paragraphs.
export function renderMarkdown(md: string): ReactNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let listBuf: { text: string; checked: boolean | null }[] = [];
  let codeBuf: string[] = [];
  let inCode = false;
  let key = 0;

  const flushList = () => {
    if (listBuf.length === 0) return;
    const items = listBuf;
    listBuf = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="md-ul">
        {items.map((it, idx) => (
          <li key={idx} className={it.checked === null ? 'md-li' : 'md-li-task'}>
            {it.checked !== null && (
              <span className="md-check">{it.checked ? '☑' : '☐'}</span>
            )}
            {renderInline(it.text, `li-${key}-${idx}`)}
          </li>
        ))}
      </ul>,
    );
  };

  for (const raw of lines) {
    const line = raw;

    if (line.trim().startsWith('```')) {
      if (inCode) {
        blocks.push(<pre key={`code-${key++}`} className="md-pre"><code>{codeBuf.join('\n')}</code></pre>);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    // Headings
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      const level = Math.min(h[1].length, 6);
      blocks.push(
        createElement(
          `h${level}`,
          { key: `h-${key++}`, className: `md-h md-h${level}` },
          renderInline(h[2], `h-${key}`),
        ),
      );
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList();
      blocks.push(<hr key={`hr-${key++}`} className="md-hr" />);
      continue;
    }

    // Blockquote
    const bq = /^\s*>\s?(.*)$/.exec(line);
    if (bq) {
      flushList();
      blocks.push(<blockquote key={`bq-${key++}`} className="md-bq">{renderInline(bq[1], `bq-${key}`)}</blockquote>);
      continue;
    }

    // List items (-, *, + with optional [ ]/[x] checkbox)
    const li = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (li) {
      const taskM = /^\[([ xX])\]\s+(.*)$/.exec(li[1]);
      if (taskM) listBuf.push({ text: taskM[2], checked: taskM[1].toLowerCase() === 'x' });
      else listBuf.push({ text: li[1], checked: null });
      continue;
    }

    // Blank line → paragraph break
    if (line.trim() === '') { flushList(); continue; }

    // Paragraph
    flushList();
    blocks.push(<p key={`p-${key++}`} className="md-p">{renderInline(line, `p-${key}`)}</p>);
  }

  flushList();
  if (inCode && codeBuf.length) blocks.push(<pre key={`code-${key++}`} className="md-pre"><code>{codeBuf.join('\n')}</code></pre>);

  return <>{blocks}</>;
}

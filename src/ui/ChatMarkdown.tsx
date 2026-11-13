import { useLayoutEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { alignNumericColumns } from '../markdown-table';
import { codeLanguage } from '../mermaid-diagram';
import { MermaidDiagram } from './MermaidDiagram';

/** Chat text as Markdown. GitHub-flavoured, so tables become real tables; wide tables scroll inside the message. */
export function ChatMarkdown({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) alignNumericColumns(ref.current);
  }, [text]);
  return (
    <div className="msg-text" ref={ref}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node: _node, ...props }) => <div className="md-table" tabIndex={0} role="region" aria-label="Table"><table {...props} /></div>,
          // A ```mermaid block becomes a drawn diagram; every other code block stays as it was.
          pre: ({ node: _node, children, ...props }) => {
            const child = Array.isArray(children) ? children[0] : children;
            const el = child as { props?: { className?: string; children?: unknown } } | null;
            if (codeLanguage(el?.props?.className) === 'mermaid') {
              return <MermaidDiagram source={String(el?.props?.children ?? '').replace(/\n$/, '')} />;
            }
            return <pre {...props}>{children}</pre>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

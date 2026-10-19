import { useLayoutEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { alignNumericColumns } from '../markdown-table';

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
        components={{ table: ({ node: _node, ...props }) => <div className="md-table" tabIndex={0} role="region" aria-label="Table"><table {...props} /></div> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

import Markdown from 'react-markdown';
import { cn } from '@/lib/utils';

/** Display untrusted clinical text as a restricted Markdown tree. Raw HTML,
 * remote media and active links are intentionally not rendered. */
export function ClinicalMarkdown({ text, className }: { text: string; className?: string }) {
  return <div className={cn('space-y-2 text-sm leading-relaxed break-words text-foreground/90', className)}>
    <Markdown skipHtml disallowedElements={['img', 'iframe', 'video', 'audio', 'style', 'script']}
      components={{
        p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
        h1: ({ children }) => <h3 className="font-semibold text-base">{children}</h3>,
        h2: ({ children }) => <h3 className="font-semibold">{children}</h3>,
        h3: ({ children }) => <h4 className="font-semibold">{children}</h4>,
        a: ({ children }) => <span>{children}</span>,
        pre: ({ children }) => <pre className="whitespace-pre-wrap rounded-md bg-muted p-3">{children}</pre>,
        blockquote: ({ children }) => <blockquote className="border-l-2 pl-3">{children}</blockquote>,
      }}>
      {text}
    </Markdown>
  </div>;
}

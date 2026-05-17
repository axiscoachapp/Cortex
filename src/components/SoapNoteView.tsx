import { cn } from '@/lib/utils';

interface SoapSection {
  letter: string;
  title: string;
  content: string;
}

function parseSoapSections(text: string): SoapSection[] | null {
  // Match **S (Subjetivo):** or **S:** style headers
  const regex = /\*\*([A-Z])\s*(?:\([^)]+\))?\*\*[:\s]*([\s\S]*?)(?=\n\s*\n?\*\*[A-Z]|$)/g;
  const sections: SoapSection[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const fullTitle = match[0].match(/\*\*([^*]+)\*\*/)?.[1]?.trim() ?? match[1];
    sections.push({ letter: match[1], title: fullTitle, content: match[2].trim() });
  }
  return sections.length >= 2 ? sections : null;
}

const sectionStyles: Record<string, string> = {
  S: 'bg-blue-50 border-blue-200/60',
  O: 'bg-slate-50 border-slate-200/60',
  A: 'bg-amber-50 border-amber-200/60',
  P: 'bg-green-50 border-green-200/60',
};

const labelStyles: Record<string, string> = {
  S: 'text-blue-700',
  O: 'text-slate-600',
  A: 'text-amber-700',
  P: 'text-green-700',
};

export function SoapNoteView({ text }: { text: string }) {
  const sections = parseSoapSections(text);

  if (!sections) {
    return (
      <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
        {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={i}>{part.slice(2, -2)}</strong>
            : part,
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {sections.map(({ letter, title, content }) => (
        <div
          key={letter}
          className={cn('rounded-lg border px-3.5 py-3', sectionStyles[letter] ?? 'bg-muted/30 border-border')}
        >
          <p className={cn('text-[10px] font-bold uppercase tracking-wider mb-1.5', labelStyles[letter] ?? 'text-foreground/60')}>
            {title}
          </p>
          {content
            ? <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">{content}</p>
            : <p className="text-sm italic text-muted-foreground/60">Não relatado na consulta.</p>
          }
        </div>
      ))}
    </div>
  );
}

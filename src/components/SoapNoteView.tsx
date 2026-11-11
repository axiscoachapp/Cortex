import { cn } from '@/lib/utils';
import { ClinicalMarkdown } from '@/components/ClinicalMarkdown';
import { parseSoapBlocks } from '@/lib/soapSections';

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
  const blocks = parseSoapBlocks(text);

  if (!blocks) {
    return (
      <ClinicalMarkdown text={text} />
    );
  }

  return (
    <div className="space-y-2.5">
      {blocks.map((block, index) =>
        block.kind === 'text' ? (
          <div key={index} className="px-1">
            <ClinicalMarkdown text={block.content} />
          </div>
        ) : (
          <div
            key={index}
            className={cn('rounded-lg border px-3.5 py-3', sectionStyles[block.letter] ?? 'bg-muted/30 border-border')}
          >
            <p className={cn('text-[0.625rem] font-bold uppercase tracking-wider mb-1.5', labelStyles[block.letter] ?? 'text-foreground/60')}>
              {block.title}
            </p>
            {block.content
              ? <ClinicalMarkdown text={block.content} />
              : <p className="text-sm italic text-muted-foreground">Não relatado na consulta.</p>
            }
          </div>
        ),
      )}
    </div>
  );
}

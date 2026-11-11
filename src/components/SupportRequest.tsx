import { useState } from 'react';
import { Copy, Mail, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supportLinks, supportRequestText } from '@/lib/support';

/**
 * "Ask the Cortex team" with a way to do it: a WhatsApp or e-mail link when the deployment has a
 * support channel, and always a button that copies a ready request. Use it wherever a screen shows
 * data that only the Cortex team changes.
 */
export function SupportRequest({ subject, clinicName, className, children }: {
  /** What the request is about, in the clinic's words (e.g. "Convênios e tabela de preços"). */
  subject: string;
  clinicName?: string | null;
  className?: string;
  /** One sentence above the actions; defaults to the standard explanation. */
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const text = supportRequestText(subject, clinicName);
  const links = supportLinks(text);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };
  return (
    <div className={cn('space-y-2 text-sm', className)}>
      <p className="text-muted-foreground">{children ?? 'Estes dados são mantidos pela equipe Cortex. Para corrigir ou incluir algo, envie um pedido.'}</p>
      <div className="flex flex-wrap items-center gap-2">
        {links.whatsapp && (
          <Button asChild size="sm" variant="outline">
            <a href={links.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />Falar com a equipe Cortex</a>
          </Button>
        )}
        {links.email && (
          <Button asChild size="sm" variant="outline">
            <a href={links.email}><Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />Enviar e-mail</a>
          </Button>
        )}
        <Button type="button" size="sm" variant={links.whatsapp || links.email ? 'ghost' : 'outline'} onClick={() => void copy()}>
          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />Copiar pedido
        </Button>
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {copied === 'ok' ? (links.whatsapp || links.email ? 'Pedido copiado.' : 'Pedido copiado. Envie pelo canal combinado com a equipe Cortex.')
            : copied === 'failed' ? 'Não foi possível copiar. Anote o assunto e envie pelo canal combinado.' : ''}
        </span>
      </div>
    </div>
  );
}

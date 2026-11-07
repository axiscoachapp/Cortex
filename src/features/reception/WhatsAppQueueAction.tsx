import {useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {AlertDialog,AlertDialogTrigger,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import type {WhatsAppConversation} from './whatsappApi';

/** Mounted for the fresh conversation/read/owner/queue identity only. */
export function WhatsAppQueueAction({conversation,disabled,busy,onConfirm}:{conversation:WhatsAppConversation;disabled:boolean;busy:boolean;onConfirm:(conversation:WhatsAppConversation,queue:string)=>void}){
  const [queue,setQueue]=useState(''),id=useId();
  const valid=queue.length<=40&&/^[a-z0-9]/.test(queue)&&!/[^a-z0-9_-]/.test(queue)&&queue!==conversation.queue;
  return <AlertDialog onOpenChange={()=>setQueue('')}>
    <AlertDialogTrigger asChild><Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={disabled}>{busy?'Mudando fila…':'Mudar fila'}</Button></AlertDialogTrigger>
    <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-5">
      <AlertDialogHeader className="min-w-0 text-left">
        <AlertDialogTitle>Mudar fila desta conversa?</AlertDialogTitle>
        <AlertDialogDescription className="[overflow-wrap:anywhere]">Conversa com <strong>{conversation.profileName||'Contato sem nome'}</strong>. Fila atual: <strong>{conversation.queue}</strong>. O responsável e os vínculos serão mantidos.</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="min-w-0 space-y-2">
        <Label htmlFor={id}>Nova fila</Label>
        <Input id={id} value={queue} onChange={event=>setQueue(event.target.value)} disabled={disabled} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Ex.: agendamento" className="h-11" aria-describedby={id+'-hint'}/>
        <p id={id+'-hint'} className="text-sm text-muted-foreground [overflow-wrap:anywhere]">Até 40 letras minúsculas, números, hífen ou sublinhado. Comece com letra ou número.</p>
        <p role="status" className="text-sm [overflow-wrap:anywhere]">{valid?'Mover de '+conversation.queue+' para '+queue+'.':'Escolha uma fila diferente da atual.'}</p>
      </div>
      <AlertDialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:space-x-0">
        <AlertDialogCancel className="mt-0 h-auto min-h-11 whitespace-normal">Cancelar</AlertDialogCancel>
        <AlertDialogAction className="h-auto min-h-11 whitespace-normal" disabled={disabled||!valid} onClick={()=>{if(valid&&!disabled)onConfirm(conversation,queue);}}>Confirmar mudança</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

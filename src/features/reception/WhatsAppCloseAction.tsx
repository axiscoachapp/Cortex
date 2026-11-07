import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogTrigger,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import type {WhatsAppConversation} from './whatsappApi';

/** Mounted only for the current fresh revision; losing it discards confirmation. */
export function WhatsAppCloseAction({conversation,disabled,busy,onConfirm}:{conversation:WhatsAppConversation;disabled:boolean;busy:boolean;onConfirm:(conversation:WhatsAppConversation)=>void}){
  return <AlertDialog>
    <AlertDialogTrigger asChild><Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={disabled}>{busy?'Encerrando…':'Encerrar conversa'}</Button></AlertDialogTrigger>
    <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-5">
      <AlertDialogHeader className="min-w-0 text-left">
        <AlertDialogTitle className="[overflow-wrap:anywhere]">Encerrar esta conversa?</AlertDialogTitle>
        <AlertDialogDescription className="[overflow-wrap:anywhere]">A conversa com <strong>{conversation.profileName||'Contato sem nome'}</strong> sairá de Em aberto e o contador de não lidas será zerado. O responsável e os vínculos serão mantidos.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:space-x-0">
        <AlertDialogCancel className="mt-0 h-auto min-h-11 whitespace-normal">Cancelar</AlertDialogCancel>
        <AlertDialogAction className="h-auto min-h-11 whitespace-normal bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={disabled} onClick={()=>onConfirm(conversation)}>Confirmar encerramento</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

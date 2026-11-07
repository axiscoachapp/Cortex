import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogTrigger,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import type {WhatsAppConversation} from './whatsappApi';

/** Mounted only for the current fresh revision; losing it discards confirmation. */
export function WhatsAppReopenAction({conversation,disabled,busy,onConfirm}:{conversation:WhatsAppConversation;disabled:boolean;busy:boolean;onConfirm:(conversation:WhatsAppConversation)=>void}){
  return <AlertDialog>
    <AlertDialogTrigger asChild><Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={disabled}>{busy?'Reabrindo…':'Reabrir conversa'}</Button></AlertDialogTrigger>
    <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-5">
      <AlertDialogHeader className="min-w-0 text-left">
        <AlertDialogTitle className="[overflow-wrap:anywhere]">Reabrir esta conversa?</AlertDialogTitle>
        <AlertDialogDescription className="[overflow-wrap:anywhere]">A conversa com <strong>{conversation.profileName||'Contato sem nome'}</strong> voltará para Em aberto. {conversation.assignedTo===null?'Ela continuará sem responsável. Você poderá assumir depois, em uma ação separada.':'O responsável será mantido.'} Os vínculos e as não lidas serão preservados.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:space-x-0">
        <AlertDialogCancel className="mt-0 h-auto min-h-11 whitespace-normal">Cancelar</AlertDialogCancel>
        <AlertDialogAction className="h-auto min-h-11 whitespace-normal" disabled={disabled} onClick={()=>onConfirm(conversation)}>Confirmar reabertura</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

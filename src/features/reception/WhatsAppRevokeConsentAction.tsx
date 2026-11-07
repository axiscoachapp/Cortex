import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogTrigger,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import type {WhatsAppConversation} from './whatsappApi';

/** Mounted only for a fresh confirmed phone/owner/consent snapshot. */
export function WhatsAppRevokeConsentAction({conversation,disabled,busy,onConfirm}:{conversation:WhatsAppConversation;disabled:boolean;busy:boolean;onConfirm:(conversation:WhatsAppConversation)=>void}){
  return <AlertDialog>
    <AlertDialogTrigger asChild><Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={disabled}>{busy?'Retirando autorização…':'Retirar autorização'}</Button></AlertDialogTrigger>
    <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-5">
      <AlertDialogHeader className="min-w-0 text-left">
        <AlertDialogTitle className="[overflow-wrap:anywhere]">Retirar autorização de lembretes?</AlertDialogTitle>
        <AlertDialogDescription className="[overflow-wrap:anywhere]">
          <span className="block">Conversa com <strong>{conversation.profileName||'Contato sem nome'}</strong>. Telefone do WhatsApp: <strong>+{conversation.waId}</strong>.</span>
          <span className="mt-2 block">A autorização de lembretes deste telefone será retirada na clínica. Isso também pode afetar outras conversas do mesmo número.</span>
          <span className="mt-2 block">Mensagens já preparadas ou enviadas podem continuar. A conversa, o responsável e os vínculos serão mantidos.</span>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:space-x-0">
        <AlertDialogCancel className="mt-0 h-auto min-h-11 whitespace-normal">Cancelar</AlertDialogCancel>
        <AlertDialogAction className="h-auto min-h-11 whitespace-normal" disabled={disabled} onClick={()=>onConfirm(conversation)}>Confirmar retirada</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

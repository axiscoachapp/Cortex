import { useCallback, useEffect, useId } from 'react';
import { useBlocker } from 'react-router-dom';

type Entry = {message:string;blocking:boolean;onBlocked?:()=>void};
const entries = new Map<string,Entry>();
let confirmedNavigation = false;
export function afterConfirmedSaveOrDiscard(action:()=>void) {
  confirmedNavigation=true;
  try{action();}finally{confirmedNavigation=false;}
}
export function confirmSessionExit():boolean {
  const active=[...entries.values()];const locked=active.find(entry=>entry.blocking);
  if(locked){if(locked.onBlocked)locked.onBlocked();else window.alert(locked.message);return false;}
  return !active.length||window.confirm(active[0].message);
}

/** All route, Back and reload exits use the same unsaved-draft policy. */
export function useUnsavedChanges(dirty: boolean, message = 'Há alterações não salvas. Sair e descartar essas alterações?', options?: {blocking?:boolean;onBlocked?:()=>void}) {
  const id=useId();
  useEffect(()=>{
    if(dirty)entries.set(id,{message,blocking:!!options?.blocking,onBlocked:options?.onBlocked});else entries.delete(id);
    return()=>{entries.delete(id);};
  },[id,dirty,message,options?.blocking,options?.onBlocked]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  return (next: boolean) => next || !dirty || (!options?.blocking && window.confirm(message));
}

/** React Router supports one blocker. Editors register here rather than replacing each other's guard. */
export function UnsavedChangesRouteGuard() {
  const blocker = useBlocker(useCallback(({currentLocation,nextLocation}) => !confirmedNavigation && entries.size>0 &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search), []));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const active=[...entries.values()];const locked=active.find(entry=>entry.blocking);
    if(locked){if(locked.onBlocked)locked.onBlocked();else window.alert(locked.message);blocker.reset();return;}
    if(!active.length||window.confirm(active[0].message))blocker.proceed();else blocker.reset();
  },[blocker]);
  return null;
}

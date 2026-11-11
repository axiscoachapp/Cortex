import { createElement, useCallback, useEffect, useId, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { DiscardChangesDialog } from '@/components/DiscardChangesDialog';

type Entry = {message:string;blocking:boolean;onBlocked?:()=>void};
const entries = new Map<string,Entry>();
let confirmedNavigation = false;
export function afterConfirmedSaveOrDiscard(action:()=>void) {
  confirmedNavigation=true;
  try{action();}finally{confirmedNavigation=false;}
}
/** Synchronous check kept for callers outside the main navigation (access and session screens). */
export function confirmSessionExit():boolean {
  const active=[...entries.values()];const locked=active.find(entry=>entry.blocking);
  if(locked){if(locked.onBlocked)locked.onBlocked();else window.alert(locked.message);return false;}
  return !active.length||window.confirm(active[0].message);
}

/** What leaving now would cost: an operation that must finish first, or edits that would be lost. */
export function pendingExit(): { locked?: string; unsaved: boolean } {
  const active=[...entries.values()];
  return { locked: active.find(entry=>entry.blocking)?.message, unsaved: active.length>0 };
}

// Screens with their own exit rule (an open editor that may refuse) add it here;
// the sign-out dialog runs every rule before ending the session.
const exitGuards = new Set<()=>boolean>();
export function useExitGuard(guard:()=>boolean) {
  useEffect(()=>{exitGuards.add(guard);return()=>{exitGuards.delete(guard);};},[guard]);
}
export function runExitGuards():boolean {
  for(const guard of exitGuards)if(!guard())return false;
  return true;
}

type DiscardRequest = {message:string;proceed:()=>void};
let askDiscard: ((request:DiscardRequest)=>void) | null = null;

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
  // With `proceed`, a dirty close asks in the app's dialog and runs `proceed`
  // after "Descartar alterações"; without it, the browser's confirm (legacy callers).
  return (next: boolean, proceed?: () => void) => {
    if(next || !dirty) return true;
    if(options?.blocking) return false;
    if(proceed && askDiscard){askDiscard({message,proceed});return false;}
    return window.confirm(message);
  };
}

/** React Router supports one blocker. Editors register here rather than replacing each other's guard. */
export function UnsavedChangesRouteGuard() {
  const blocker = useBlocker(useCallback(({currentLocation,nextLocation}) => !confirmedNavigation && entries.size>0 &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search), []));
  const [request,setRequest]=useState<DiscardRequest|null>(null);
  useEffect(()=>{askDiscard=setRequest;return()=>{if(askDiscard===setRequest)askDiscard=null;};},[]);
  const blocked=blocker.state==='blocked';
  const active=blocked?[...entries.values()]:[];
  const locked=active.find(entry=>entry.blocking);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const now=[...entries.values()];const lock=now.find(entry=>entry.blocking);
    if(lock){if(lock.onBlocked)lock.onBlocked();else window.alert(lock.message);blocker.reset();return;}
    if(!now.length)blocker.proceed();
  },[blocker]);
  if(blocked&&!locked&&active.length)return createElement(DiscardChangesDialog,{open:true,message:active[0].message,
    onKeep:()=>blocker.reset?.(),onDiscard:()=>blocker.proceed?.()});
  if(request)return createElement(DiscardChangesDialog,{open:true,message:request.message,
    onKeep:()=>setRequest(null),onDiscard:()=>{setRequest(null);request.proceed();}});
  return null;
}

import {createContext,useContext} from 'react';
// Hidden: the workspace is concealed (actor change, definitive refusal or an
// expired grace period). Dialogs bound to the previous verification retire.
export const SessionVisibilityContext=createContext(false);
export const useSessionHidden=()=>useContext(SessionVisibilityContext);
// Paused: the same actor's last verification is kept while a re-check is
// retrying or inside its grace period. Keep local state; disable submits only.
export const SessionPausedContext=createContext(false);
export const useSessionPaused=()=>useContext(SessionPausedContext);

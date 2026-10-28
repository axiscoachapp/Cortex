import {createContext,useContext} from 'react';
export const SessionVisibilityContext=createContext(false);
export const useSessionHidden=()=>useContext(SessionVisibilityContext);

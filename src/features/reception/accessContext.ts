import { createContext, useContext } from 'react';
import type { ClinicAccess } from './contracts';

export const ClinicAccessContext = createContext<ClinicAccess | null>(null);
export const useClinicAccess = () => useContext(ClinicAccessContext);

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { PrescriptionList } from './PrescriptionList';
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'owner'}})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
  const query={select:()=>query,eq:()=>query,order:()=>query,range:async(from:number)=>({error:null,data:from?[]:[
    {id:'legacy',doc_type:'receita_simples',status:'generated',secret_code:'LEGACY',created_at:'2026-01-01',expires_at:'2099-01-01'},
    {id:'forged-signature',doc_type:'atestado',status:'signed',secret_code:'SIGNED',created_at:'2026-01-01',expires_at:'2099-01-01',issuance_verified_at:'2026-01-01',signature_verified_at:null},
  ]})};return query;
}}}));
describe('prescription trust display',()=>{
  it('requires reissue for legacy rows and never labels an unattested signature as signed',async()=>{
    render(<QueryClientProvider client={new QueryClient()}><PrescriptionList patientId="patient" /></QueryClientProvider>);
    expect(await screen.findByText('Reemitir documento')).toBeInTheDocument();
    expect(screen.getByText('Assinatura não verificada')).toBeInTheDocument();
    expect(screen.queryByText('Assinada')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button',{name:'Abrir documento'})[0]).toBeDisabled();
  });
});

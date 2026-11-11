import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DoctorSuggestion } from './DoctorSuggestion';
import type { ReceptionCase } from './contracts';
const doctors=[{id:'a',name:'Médico sintético A',specialty:null},{id:'b',name:'Médico sintético B',specialty:null}];
const beneficiary=(doctorId:string)=>({id:'patient-'+doctorId,name:'Beneficiário sintético',dateOfBirth:null,doctorId,relationship:'self' as const});
const request={doctorId:null,beneficiaries:[beneficiary('a'),beneficiary('b')]} as ReceptionCase;
describe('human doctor routing suggestions',()=>{
 it('offers linked choices without preselecting or submitting and reports the selected identity only on click',()=>{
  const select=vi.fn();render(<DoctorSuggestion doctors={doctors} receptionCase={request} onSelect={select}/>);expect(select).not.toHaveBeenCalled();expect(screen.getAllByRole('button')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'Selecionar Médico sintético B'}));expect(select).toHaveBeenCalledOnce();expect(select).toHaveBeenCalledWith('b');
 });
 it('shows no replacement suggestion when the indicated doctor is unavailable',()=>{
  render(<DoctorSuggestion doctors={doctors} receptionCase={{...request,doctorId:'revoked'}} onSelect={vi.fn()}/>);expect(screen.queryByRole('button')).not.toBeInTheDocument();expect(screen.getByText(/indicado.*indisponível/)).toBeVisible();
 });
 it('locks suggestions while a routing operation is pending',()=>{
  const select=vi.fn();render(<DoctorSuggestion doctors={doctors} receptionCase={request} onSelect={select} disabled/>);for(const button of screen.getAllByRole('button')){expect(button).toBeDisabled();fireEvent.click(button);}expect(select).not.toHaveBeenCalled();
 });
 it('removes options immediately when a doctor ceases to be authorized',()=>{
  const select=vi.fn(),view=render(<DoctorSuggestion doctors={doctors} receptionCase={request} onSelect={select}/>);view.rerender(<DoctorSuggestion doctors={[doctors[0]]} receptionCase={request} onSelect={select}/>);expect(screen.queryByRole('button',{name:'Selecionar Médico sintético B'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Selecionar Médico sintético A'})).toBeEnabled();expect(select).not.toHaveBeenCalled();
 });
 it('does not guess a doctor for a new person without confirmed links',()=>{
  render(<DoctorSuggestion doctors={doctors} receptionCase={{...request,beneficiaries:[]}} onSelect={vi.fn()}/>);expect(screen.queryByRole('button')).not.toBeInTheDocument();expect(screen.getByText(/Pergunte qual médico/)).toBeVisible();
 });
 it('is hidden when the case already has the doctor it would suggest',()=>{
  const view=render(<DoctorSuggestion doctors={doctors} receptionCase={{...request,doctorId:'a'}} onSelect={vi.fn()}/>);expect(view.container).toBeEmptyDOMElement();
  // A single linked doctor that differs from the case's (none set) is still offered.
  view.rerender(<DoctorSuggestion doctors={doctors} receptionCase={{...request,beneficiaries:[beneficiary('b')]}} onSelect={vi.fn()}/>);expect(screen.getByRole('button',{name:'Selecionar Médico sintético B'})).toBeVisible();
 });
});

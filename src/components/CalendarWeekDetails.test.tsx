import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CalendarWeekDetails, CompactWeekHeader } from './CalendarWeekDetails';
import type { Appointment } from '@/types/patient';

const day=new Date(2026,10,12,12);
const appointment=(id:string,start:Date,end:Date,title='Consulta sintética'):Appointment=>({id,userId:'synthetic-doctor',patientId:null,title,startTime:start,endTime:end,type:'retorno',status:'agendado',reminderSent:false});
const first=appointment('first',new Date(2026,10,10,9),new Date(2026,10,10,9,30));
describe('mobile week details',()=>{
 it('shows full title and both dated times and opens only the exact appointment on a human click',()=>{
  const select=vi.fn();render(<CalendarWeekDetails date={day} appointments={[first]} onSelect={select}/>);
  expect(screen.getByRole('heading',{name:'Consultas da semana'})).toBeVisible();expect(screen.getByText('10/11 09:00 – 10/11 09:30')).toBeVisible();expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:/Consulta sintética/}));expect(select).toHaveBeenCalledOnce();expect(select).toHaveBeenCalledWith(first);
 });
 it('sorts chronologically without mutating the supplied appointments and labels cancellations',()=>{
  const late={...appointment('late',new Date(2026,10,13,17),new Date(2026,10,13,18),'Reserva sintética posterior'),status:'cancelado' as const};const rows=[late,first];
  render(<CalendarWeekDetails date={day} appointments={rows} onSelect={vi.fn()}/>);expect(screen.getAllByRole('button').map(button=>button.textContent)).toEqual([expect.stringContaining(first.title),expect.stringContaining(late.title)]);expect(screen.getByText('Cancelado')).toBeVisible();expect(rows[0]).toBe(late);
 });
 // Weeks start on Monday (M 30): 12/11/2026 belongs to 09/11–15/11.
 it('includes overlapping appointments but excludes intervals merely touching the week boundary',()=>{
  const crossing=appointment('cross',new Date(2026,10,8,23,30),new Date(2026,10,9,0,30),'Reserva atravessa meia-noite');
  const touching=appointment('touch',new Date(2026,10,8,23),new Date(2026,10,9,0),'Anterior');
  const next=appointment('next',new Date(2026,10,16,0),new Date(2026,10,16,1),'Próxima semana');
  render(<CalendarWeekDetails date={day} appointments={[crossing,touching,next]} onSelect={vi.fn()}/>);expect(screen.getAllByRole('button')).toHaveLength(1);expect(screen.getByText('08/11 23:30 – 09/11 00:30')).toBeVisible();expect(screen.getByRole('heading',{name:'segunda-feira, 09/11'})).toBeVisible();
 });
 it('starts the week on Monday and ends it on Sunday',()=>{
  const sunday=appointment('sunday',new Date(2026,10,15,10),new Date(2026,10,15,10,30),'Domingo da semana');
  const previousSunday=appointment('previous',new Date(2026,10,8,10),new Date(2026,10,8,10,30),'Domingo anterior');
  render(<CalendarWeekDetails date={day} appointments={[sunday,previousSunday]} onSelect={vi.fn()}/>);
  expect(screen.getByRole('button',{name:/Domingo da semana/})).toBeVisible();expect(screen.queryByText('Domingo anterior')).not.toBeInTheDocument();
 });
 it('tracks the selected week rather than today and distinguishes empty weeks',()=>{
  const view=render(<CalendarWeekDetails date={day} appointments={[first]} onSelect={vi.fn()}/>);view.rerender(<CalendarWeekDetails date={new Date(2026,10,19)} appointments={[first]} onSelect={vi.fn()}/>);expect(screen.queryByRole('button')).not.toBeInTheDocument();expect(screen.getByText('Nenhuma consulta nesta semana.')).toBeVisible();
 });
 it('keeps long and untrusted titles as plain text',()=>{
  const title='<img src=x onerror=alert(1)> Consulta sintética com título extenso';render(<CalendarWeekDetails date={day} appointments={[{...first,title}]} onSelect={vi.fn()}/>);expect(screen.getByText(title)).toBeVisible();expect(document.querySelector('img')).toBeNull();
 });
 it('selects the exact ID even when two appointments share the same title and interval',()=>{
  const duplicate={...first,id:'second',patientId:'synthetic-second-patient'},select=vi.fn();render(<CalendarWeekDetails date={day} appointments={[first,duplicate]} onSelect={select}/>);
  fireEvent.click(screen.getAllByRole('button',{name:/Consulta sintética/})[1]);expect(select).toHaveBeenCalledOnce();expect(select).toHaveBeenCalledWith(duplicate);expect(select.mock.calls[0][0].id).toBe('second');
 });
 it('provides a concise visual day/date and the full accessible date for week drilldown',()=>{
  render(<button><CompactWeekHeader date={new Date(2026,10,8)}/></button>);expect(screen.getByText('DOM')).toHaveAttribute('aria-hidden','true');expect(screen.getByText('08')).toHaveAttribute('aria-hidden','true');expect(screen.getByRole('button',{name:'domingo, 8 de novembro de 2026'})).toBeInTheDocument();
 });
});

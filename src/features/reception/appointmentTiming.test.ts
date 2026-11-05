import { describe, expect, it } from 'vitest';
import { appointmentTiming } from './appointmentTiming';
describe('administrative appointment time projection',()=>{
 it('uses the clinic day and time for an explicit foreign offset',()=>{
  expect(appointmentTiming({startTime:'2026-11-06T01:00:00+03:00',endTime:'2026-11-06T01:30:00+03:00'})).toEqual({valid:true,day:'2026-11-05',label:'19:00–19:30'});
 });
 it('preserves PostgreSQL microseconds when classifying an otherwise valid interval',()=>{
  expect(appointmentTiming({startTime:'2026-11-05T12:00:00.000001+00:00',endTime:'2026-11-05T12:00:00.000002+00:00'}).valid).toBe(true);
 });
 it.each(['infinity','-infinity','not-a-date','2026-11-05','2026-02-30T12:00:00Z','2026-11-05T24:00:00Z','2026-11-05T12:00:00'])('does not infer a day from %s',startTime=>{
  const value=appointmentTiming({startTime,endTime:'2026-11-05T12:30:00Z'});expect(value.valid).toBe(false);expect(value.day).toBeNull();expect(value.label).toBe('Início indisponível–09:30');
 });
 it.each(['2026-11-05T12:00:00Z','2026-11-05T11:59:00Z','infinity'])('preserves a known start day without presenting end %s as a valid interval',endTime=>{
  const value=appointmentTiming({startTime:'2026-11-05T12:00:00Z',endTime});expect(value.valid).toBe(false);expect(value.day).toBe('2026-11-05');
 });
});

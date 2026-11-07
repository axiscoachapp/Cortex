import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { patientId } from './clinic-review-api.mjs';
import { ids } from './reception-api.mjs';

export async function auditSchedulingMigration({api,app,receptionApi,receptionApp,scene,capture,checks,screens,errors,blocked}) {
  const before=structuredClone(api.displayData);
  const staffBefore=structuredClone({staff:receptionApi.staff,cases:receptionApi.cases,contacts:receptionApi.contacts,appointments:receptionApi.appointments});
  const noLegacyNav=async page=>{
    await expect(page.getByRole('link',{name:'Pendências',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Trabalho pendente',exact:true})).toHaveCount(0);
    await expect(page.locator('a[href^="/trabalho"]')).toHaveCount(0);
  };
  const generic=await scene(app,'review','/trabalho');
  await capture(generic,app,'clinical','/trabalho',375,undefined,'legacy-general',{navigate:false});
  await expect(generic).toHaveURL(app.origin+'/');await noLegacyNav(generic);
  assert.equal(api.scheduling.allReads.length,0,'Generic legacy redirect mounted private work readers');
  checks.push({genericHome:true,noLegacyWorkRead:true});
  for(const [width,legacy] of [[375,'/trabalho'],[768,'/TRABALHO/'],[1280,'/%74rabalho'],[1920,'/trabalho']]) {
    api.scheduling.setMode('valid');
    const path=legacy+'?queue=scheduling',page=await scene(app,'review',path);
    await page.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
    const panel=page.getByRole('region',{name:'Lista de espera e confirmações'});
    const toggle=page.getByRole('button',{name:'Lista de espera e confirmações',exact:true});
    await capture(page,app,'clinical',path,width,async()=>{
      await expect(page).toHaveURL(app.origin+'/agenda?queue=scheduling');
      await expect(panel.getByRole('link')).toHaveCount(2);
      await expect(panel.getByText('Espera sintética preservada',{exact:true})).toBeVisible();
      await expect(panel.getByText('Confirmação sintética preservada',{exact:true})).toBeVisible();
      await expect(panel.getByText('Espera já concluída',{exact:true})).toHaveCount(0);
      await expect(panel.getByText('Resultado fora da fila de agenda',{exact:true})).toHaveCount(0);
      await noLegacyNav(page);
    },'scheduling-panel',{navigate:false});
    const group=page.getByRole('group',{name:'Visualização da agenda'});
    await group.getByRole('button',{name:'Semana',exact:true}).click();
    await page.locator('.rbc-toolbar').getByRole('button',{name:'Próximo',exact:true}).click();
    const period=await page.locator('.rbc-toolbar-label').innerText();
    await toggle.click();await expect(panel).toHaveCount(0);
    await expect(page.locator('.rbc-toolbar-label')).toHaveText(period);
    await expect(group.getByRole('button',{name:'Semana',exact:true})).toHaveAttribute('aria-pressed','true');
    await toggle.click();await expect(panel.getByRole('link')).toHaveCount(2);
    await expect(page.locator('.rbc-toolbar-label')).toHaveText(period);
    api.scheduling.setMode('unavailable');
    await panel.getByRole('button',{name:'Atualizar acompanhamentos da agenda'}).click();
    await capture(page,app,'clinical',path,width,async()=>{
      await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.getByRole('link')).toHaveCount(0);
    },'scheduling-unavailable',{navigate:false});
    api.scheduling.setMode('valid');
    await panel.getByRole('button',{name:'Tentar carregar acompanhamentos'}).click();
    await capture(page,app,'clinical',path,width,async()=>{await expect(panel.getByRole('link')).toHaveCount(2);},'scheduling-recovered',{navigate:false});
    api.scheduling.setMode('empty');await panel.getByRole('button',{name:'Atualizar acompanhamentos da agenda'}).click();
    await capture(page,app,'clinical',path,width,async()=>{
      await expect(panel.getByText('Nenhum acompanhamento de espera ou confirmação em aberto.',{exact:true})).toBeVisible();
    },'scheduling-empty',{navigate:false});
    checks.push({width,legacyCalendar:true,viewAndDatePreserved:true,errorLinksHidden:true,recovered:true,empty:true});
    if([375,1920].includes(width)) {
      api.scheduling.setMode('valid');await panel.getByRole('button',{name:'Atualizar acompanhamentos da agenda'}).click();
      const open=panel.getByRole('link',{name:'Abrir paciente Paciente Exemplo A',exact:true});
      await expect(open).toBeVisible();await open.focus();await open.press('Enter');
      await expect(page).toHaveURL(app.origin+'/?patient='+patientId);
      await page.getByRole('button',{name:'Acompanhamento',exact:true}).click();
      await capture(page,app,'clinical',path,width,async()=>{
        await expect(page.getByRole('dialog')).toContainText('Espera sintética preservada');
        await expect(page.getByRole('dialog').getByRole('button',{name:'Abrir registro'})).not.toHaveCount(0);
        await noLegacyNav(page);
      },'patient-work-preserved',{navigate:false});
    }
  }
  const patientLink='/trabalho?patient='+patientId+'&new=1&appointment=old&complaint=synthetic';
  const patient=await scene(app,'review',patientLink);
  await capture(patient,app,'clinical',patientLink,375,async()=>{
    await expect(patient).toHaveURL(app.origin+'/?patient='+patientId);
    await expect(patient.getByRole('button',{name:'Consulta manual',exact:true})).toBeVisible();await noLegacyNav(patient);
  },'legacy-patient',{navigate:false});
  for(const [width,path] of [[375,'/trabalho?queue=scheduling'],[1280,'/TRABALHO/?queue=scheduling'],[1920,'/%74rabalho?queue=scheduling']]){
    const staff=await scene(receptionApp,'recepcao-a',path);
    await capture(staff,receptionApp,'staff',path,width,async()=>{
      await expect(staff).toHaveURL(receptionApp.origin+'/recepcao/agenda');
      await expect(staff.getByRole('heading',{name:'Agenda da equipe',exact:true})).toBeVisible();await noLegacyNav(staff);
    },'legacy-staff-calendar',{navigate:false});
  }
  receptionApi.staff.find(person=>person.id===ids.a).active=false;
  const inactive=await scene(receptionApp,'recepcao-a','/trabalho?queue=scheduling');
  await capture(inactive,receptionApp,'staff','/trabalho?queue=scheduling',375,async()=>{
    await expect(inactive.getByRole('heading',{name:'Acesso de recepção indisponível',exact:true})).toBeVisible();
  },'legacy-staff-inactive',{navigate:false});
  receptionApi.staff.find(person=>person.id===ids.a).active=true;
  assert.deepEqual(api.displayData,before);assert.deepEqual(api.scheduling.unexpected,[]);
  for(const key of ['workspaceWrites','patientWrites','appointmentWrites','briefings','checklists','chat'])assert.equal(api.metrics[key],0,key);
  assert.deepEqual({staff:receptionApi.staff,cases:receptionApi.cases,contacts:receptionApi.contacts,appointments:receptionApi.appointments},staffBefore);
  assert.deepEqual(receptionApi.metrics.clinicalReads,[]);assert.deepEqual(receptionApi.metrics.externalCalls,[]);assert.deepEqual(receptionApi.metrics.unknown,[]);
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  for(const screen of screens)assert.ok(screen.overflow<=1&&screen.dialogHorizontalOverflow<=1&&!screen.dialogOutsideViewport&&screen.dialogActionReachable!==false&&!screen.missingLabels.length&&!screen.missingButtons.length&&!screen.brokenText.length,'Scheduling migration layout clipped');
}

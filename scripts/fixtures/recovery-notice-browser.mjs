import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { patientId } from './clinic-review-api.mjs';

export async function auditRecoveryNotice({api,app,scene,capture,checks,screens,errors,blocked}) {
  const before=structuredClone(api.displayData);
  for(const width of [375,768,1280,1920]) {
    api.recoveryNotice.reset();
    const page=await scene(app,'review','/');
    await page.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
    const region=page.getByRole('region',{name:'Consultas para retomar'});
    await capture(page,app,'review','/',width,async()=>{
      await expect(region).toBeVisible();
      await expect(region.getByRole('button',{name:/Retomar consulta de/})).toHaveCount(3);
      for(const text of ['Processamento pendente','Aguardando revisão','Nova tentativa necessária'])await expect(region.getByText(text,{exact:true})).toBeVisible();
    },'recovery-notices');
    const origin=await page.evaluate(()=>performance.timeOrigin);
    api.recoveryNotice.setMode('unavailable');
    await region.getByRole('button',{name:'Atualizar consultas para retomar'}).click();
    await capture(page,app,'review','/',width,async()=>{
      await expect(region.getByRole('alert')).toBeVisible();
      await expect(region.getByRole('button',{name:/Retomar consulta de/})).toHaveCount(0);
    },'recovery-unavailable',{navigate:false});
    api.recoveryNotice.setMode('valid');
    await region.getByRole('button',{name:'Tentar verificar consultas'}).click();
    await capture(page,app,'review','/',width,async()=>{
      await expect(region.getByRole('button',{name:/Retomar consulta de/})).toHaveCount(3);
    },'recovery-refreshed',{navigate:false});
    assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);
    api.recoveryNotice.setMode('empty');
    await region.getByRole('button',{name:'Atualizar consultas para retomar'}).click();
    await capture(page,app,'review','/',width,async()=>{
      await expect(region).toHaveCount(0);
    },'recovery-empty',{navigate:false});
    checks.push({width,unavailableRowsHidden:true,recoverySameDocument:true,emptyHidden:true});
    if([375,1920].includes(width)) {
      api.recoveryNotice.setMode('valid'); await page.goto(app.origin+'/');
      const resume=region.getByRole('button',{name:'Retomar consulta de Paciente Exemplo A',exact:true});
      await expect(resume).toBeVisible(); await resume.focus(); await resume.press('Enter');
      await capture(page,app,'review','/',width,async()=>{
        await expect(page).toHaveURL(app.origin+'/?patient='+patientId);
        await expect(page.getByText('Há uma consulta preservada para este paciente. Retome a revisão ou tente processar o áudio novamente.',{exact:true})).toBeVisible();
      },'recovery-patient',{navigate:false});
      api.recoveryNotice.makeReview(patientId);
      const mobileHome=page.getByRole('button',{name:'Início',exact:true});
      await (await mobileHome.isVisible()?mobileHome:page.getByRole('button',{name:'Haddad Nicola — Início',exact:true})).click();
      await expect(region.getByText('Aguardando revisão',{exact:true})).toHaveCount(2);
      page.once('dialog',dialog=>dialog.accept());
      await region.getByRole('button',{name:'Retomar consulta de Paciente Exemplo A',exact:true}).click();
      await capture(page,app,'review','/',width,async()=>{
        await expect(page.getByRole('dialog')).toContainText('Revisão sintética atualizada em outra aba');
        await expect(page).toHaveURL(app.origin+'/?patient='+patientId);
      },'recovery-same-patient-fresh',{navigate:false});
      checks.push({width,keyboardResumeExactPatient:true,existingRecoveryCommands:true,samePatientFreshRead:true});
    }
  }
  api.recoveryNotice.reset(); assert.deepEqual(api.displayData,before);
  assert.deepEqual(api.recoveryNotice.unexpected,[]);assert.ok(api.recoveryNotice.calls.length>=20);
  for(const key of ['workspaceWrites','patientWrites','appointmentWrites','briefings','checklists','chat'])assert.equal(api.metrics[key],0,key);
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  for(const screen of screens)assert.ok(screen.overflow<=1&&screen.dialogHorizontalOverflow<=1&&!screen.dialogOutsideViewport&&screen.dialogActionReachable!==false&&!screen.missingLabels.length&&!screen.missingButtons.length&&!screen.brokenText.length,'Recovery notice layout clipped');
}

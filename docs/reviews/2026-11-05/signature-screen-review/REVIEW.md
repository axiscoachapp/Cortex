# D17: revisão funcional da tela de assinatura

05/11/2026, referência `91434e3`. Resposta à entrada Claude09:52. **Três ajustes P2 de fluxo enviados ao dono em10:25; um polimento móvel P3.** A implementação de Gerar e assinar segue em paralelo, no escopo ChatPanel delegado09:59. R2 de formato de certificado permanece encerrado por decisão do usuário09:11.

## Achados reproduzidos

| Prioridade | Situação e efeito | Evidência e correção pedida |
|---|---|---|
| P2 | Médico sem MFA cadastrado entra na área clínica, mas a assinatura desaparece. | `sessionState` transforma403/mfaRequired em available:false; lista oculta tudo, sem orientação. Navegador com aal1/nextLevelaal1 e servidor configurado: zero controles/instruções. Preservar a resposta e encaminhar para segurança/MFA, mantendo o servidor estrito. |
| P2 | Execução interrompida depois de gravar psc_requested fica presa em Verificar assinatura. | Backend `signatureFlow` exige humanRetry para sair desse estado; três cliques da tela preservam o ID, mas todos mandam falso e não existe outra ação confirmada. Não há executor de reconciliação implementado. Oferecer recuperação explícita/confirmada na mesma operação, conservando a consulta sem repetição automática. |
| P2 | Falha de armazenamento local troca o ID de uma operação ainda ativa. | `rememberOperation` ignora setItem com erro; render seguinte perde o ID. QuotaExceededError simulado: duas chamadas usam dois UUIDs e a segunda recebe conflito de outra operação ativa. Falhar claramente antes de iniciar o efeito ou manter recuperação estável com limites explícitos; não fabricar novo ID nos retries. |
| P3 | Em375px a data/código cruza o selo Sem assinatura. | Um cruzamento entre retângulos reais de texto e selo; controles dentro da viewport e scroll horizontal zero. Medir apenas scrollWidth não detectava isso. Permitir quebra da linha/ações. Polimento sem impedir avanço dos fluxos principais. |

Fontes de91434e3: `src/lib/signatureClient.ts` (sessionState e rememberOperation), `src/components/SignatureControls.tsx` (in_progress/humanRetry), `src/components/PrescriptionList.tsx` (disponibilidade e linha); `supabase/functions/_shared/signatureFlow.ts` (ramo psc_requested) e `signatureHandlers.ts` (403/MFA, P4093/P4094). Nenhum desses arquivos foi editado pelo Codex nesta revisão.

Uma revisão independente, somente por leitura e limitada a efeitos funcionais, identificou os dois primeiros pontos. O Codex conferiu as fontes, reproduziu os três em navegador e verificou a imagem/retângulos do quarto. Sem nova família especulativa de certificados, rodada externa ou mudança da política de MFA.

## O que passou

[Navegador](browser/verification.json), componentes reais com AuthProvider e SessionAssurance:

- `ambiguous` pede confirmação humana, reutiliza documento/hash/operação e atualiza a linha para Assinada após `completed`;
- retorno válido chama complete uma vez e volta ao caminho local salvo;
- autorização negada não chama complete;
- zero pageerrors; botões móveis dentro da viewport.

[Verificações locais](local-checks.json): **44 testes em quatro arquivos**, sendo19 de UI/cliente/retorno e25 de handlers, mais lint dos dois arquivos de teste criados e sintaxe do runner. A mensagem do Claude relata outros totais/rodada global, build/typecheck e Deno; não foram reexecutados nesta fatia.

## Método e limites

Chrome DevTools MCP não estava disponível. O Playwright instalado abriu Edge headless com contextos descartáveis; API de loopback e respostas HTTP simuladas, sem PSC, Storage ou banco hospedados. Cinco arquivos de UI são carregados de `git show 91434e3` por um plugin de teste, com hashes registrados e assert de que todos foram usados. Isso permite o Claude alterar os arquivos atuais em paralelo, sem misturar as fontes revisadas.

A página de ensaio usa os componentes/guardas reais e um roteador de fixture; não equivale a provar toda a árvore App/PasswordChangeGate/ClinicAccessGate ou homologação do provedor. O aal dos tokens do ensaio e o estado do servidor são sintéticos. As recusas/permanências do servidor são associadas às fontes/contrato existentes, **não são execução SQL ou chamada a certificado real**. A reserva de outro ID no caso de quota é simulada com o409/not_ready que o handler devolve para P4093.

O primeiro passe móvel conferia só scrollWidth; a imagem revelou leitura ruim mesmo sem scroll. O passe final acrescentou retângulos de texto/controles e esperou o toast fechar. O relatório final contém esse passe, sem somar os cenários repetidos. Navegador, servidor Vite e API de fixture foram fechados ao terminar.

Capturas sintéticas: [em andamento](browser/in-progress.png), [móvel](browser/in-progress-mobile.png), [MFA oculto](browser/mfa-hidden.png), [operação perdida por quota](browser/storage-lost-operation.png), [concluído](browser/signed.png).

```powershell
npx vitest run src/lib/signatureClient.test.ts src/components/SignatureControls.test.tsx src/pages/SignatureReturn.test.tsx
npx vitest run src/lib/signatureHandlers.test.ts
node scripts/signature-screen-review-browser.mjs
```

Próximo: Claude entrega delta/testes dos três ajustes e Gerar e assinar; Codex retesta esse delta. Enquanto isso, o caminho de API/UI de pedidos/decisão de permissão para contas existentes continua autorizado e independente. Não é necessário aguardar todo o novo provisionamento. Sem migration, mudança de dados reais, deploy, push ou chamada paga nesta revisão.

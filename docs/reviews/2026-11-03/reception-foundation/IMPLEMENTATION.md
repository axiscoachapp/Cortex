# Recepção e agenda humana — incremento local

Data: 03/11/2026. Escopo: começar a recepção, permissões das secretárias, fila e agenda humana no Cortex da clínica. Referência: [plano](../../../../tasks/clinic-crm/plan.md). Nenhum banco hospedado, cadastro real ou arquivo de migração PersonalMed foi alterado.

## Funcionalidades implementadas

- `/recepcao`: entrada manual, contato novo/existente, filtros e paginação, assumir, transferir, encaminhar, aguardar, concluir e reabrir. Revisões impedem sobrescrever alterações concorrentes.
- Acompanhamento com registros persistentes e rascunho separado por conta/caso. Salvamento serializado, conflito entre abas, recuperação do servidor e aviso de texto não salvo. Registrar uma anotação limpa o rascunho correspondente atomicamente; retry não duplica o registro.
- `/recepcao/contatos`: busca paginada por nome/telefone. Contato difere de paciente; números familiares não são únicos. Entrada manual brasileira exige DDD; telefone legado bruto permanece pesquisável sem inventar DDD. Contato novo não cria prontuário automaticamente.
- Beneficiário confirmado por nome/nascimento/médico e relação do interlocutor. Um contato pode ligar vários prontuários. A projeção não contém evolução, diagnóstico, medicamentos, transcrição, documentos ou conversa clínica.
- Sugestão explicada pelo médico indicado ou único vínculo confirmado entre agendas permitidas. Ambiguidade exige decisão humana. Selecionar sugestão apenas preenche o campo; encaminhar exige ação explícita.
- `/recepcao/agenda`: dia/semana, agendas delegadas, bloqueios da gestão, reserva após conferência humana, remarcação, confirmação, chegada/desfazer chegada e cancelamento preservando histórico. Datas usam America/Sao_Paulo, independentemente do navegador.
- Primeiro cadastro durante reserva cria paciente mínimo na lista privada do médico selecionado, sem copiar histórico. Reserva e cadastro são uma transação idempotente; conflito não deixa cadastro órfão.
- `/recepcao/equipe`: administrador cria conta dedicada com senha temporária e delega/revoga agendas. O fluxo existente exige senha pessoal no primeiro acesso. Cada secretária usa sua própria conta.
- Marca Haddad Nicola e escala de 150% preservadas. Duas colunas quando há espaço; no celular o caso selecionado recebe foco/rolagem. Navegação inferior identifica o ambiente administrativo.

## Decisões de autorização e integridade

`clinic_members` continua com médicos/admin. `clinic_staff_members` guarda identidades administrativas dedicadas; `staff_doctor_scopes` delega agendas. Isso evita que verificações clínicas antigas que aceitam membros da clínica passem a aceitar secretárias. Uma conta desativada de recepção continua administrativa.

As novas tabelas têm RLS e não concedem acesso direto ao cliente autenticado. RPCs verificam sessão, MFA quando configurado, clínica, médico e delegação. O frontend valida projeções estritas e decide a rota antes de montar leitores clínicos. Revogação vale para a próxima requisição; a tela consulta acesso novamente a cada 15 segundos.

Se a revalidação falhar por indisponibilidade após o trabalho abrir, o ambiente permanece montado e oculto para preservar rascunhos e estado local. A ação fica bloqueada até verificar o acesso novamente. O primeiro acesso falha fechado sem montar leitores clínicos; uma revogação confirmada leva à tela de acesso indisponível. Há teste de falha/recuperação sem desmontagem.

Políticas restritivas e guardas negam à recepção tabelas clínicas, armazenamento e RPCs SECURITY DEFINER. Edge functions clínicas recusam `app_metadata.account_type=reception`, definido pelo servidor. Médicos mantêm prontuários próprios e compartilhamento explícito. Administrar a recepção não concede prontuário de outro médico.

Auditoria registra ator real, operação, IDs, revisões e horários, sem copiar anotações para eventos. Rascunhos são por ator. Transferir/encaminhar trava permissões antes do caso e reautoriza depois do lock. Revogação libera responsáveis inelegíveis; demandas abertas de médico desativado retornam à fila inicial com auditoria.

Calendário usa o lock por proprietário preexistente e contador transacional, incluindo defesa contra snapshots REPEATABLE READ. A proteção vale também na agenda médica antiga. Identidade, proprietário, associação e autoria são imutáveis. Encaminhar um caso depois da reserva não impede cancelar o compromisso anterior.

A agenda médica antiga agora compara revisão ao editar/cancelar e conserva compromissos cancelados. Lembretes verificam revisão antes do envio e ao registrar o resultado. Uma remarcação durante envio já iniciado resulta em conflito e não marca o novo horário como lembrado; e-mail já aceito pelo provedor não pode ser desfeito.

Vínculos administrativos bloqueiam exclusão destrutiva antes da limpeza de arquivos, com conflito de custódia na API. Exportação/anonimização/retenção completas do CRM pertencem a T24; o bloqueio preserva os dados enquanto esse ciclo não está implementado.

## Verificação

Dados sintéticos, PostgreSQL 16/pgvector descartável e Edge/Chromium isolado com API HTTP de loopback. Navegador prova interface com transporte simulado; autorização e concorrência são testadas separadamente no banco real.

| Verificação | Resultado |
|---|---|
| SQL | 45 migrations, 24 suítes, incluindo regressões clínicas e quatro suítes de recepção |
| Duas conexões PostgreSQL | Um responsável por caso; uma reserva por intervalo; snapshot repetível aborta; sem cadastros órfãos; route/revoke libera responsável; route/draft reautoriza após lock |
| Diretório | 2.501 contatos, páginas de 50, cursor com empate, telefone familiar e legado sem DDD |
| Testes JS/TS | 383 testes em 63 arquivos aprovados; foco de 52 testes também aprovado após os últimos ajustes |
| Navegador recepção | 14 verificações com duas secretárias/admin: disputa, reload de rascunho privado, conferência, conflito de horário, remarcação, chegada/cancelamento, falha parcial, revogação e bloqueio da gestão |
| Navegador clínico | Abertura sem IA/status automático, conversa persistente, documentos, agenda, PDF e roteiro preservados |
| Responsividade | 390/768/1280/1920 px a 150%, sem overflow horizontal; capturas inspecionadas |
| Tipos, Edge, build | Aprovados; build com URL/chave pública sintéticas, sem alterar `.env` |
| Lint | Zero erros; oito avisos Fast Refresh preexistentes |

Artefatos: [relatório](browser/verification.json), [fila 1280](browser/queue-1280.png), [fila 390](browser/queue-390.png), [agenda](browser/calendar-1280.png). Reproduzir: `npm run test:db`, `node scripts/reception-browser.mjs`, `node scripts/clinic-review-browser.mjs`, `npm test`, `npm run lint`, `npm run typecheck:edge`, `npm run build` com variáveis explícitas.

Revisão adversarial local encontrou e levou à correção de leitura administrativa de agenda legada externa, contato retido por autoria após revogação, responsáveis inelegíveis, corrida de rascunho, associação caso reencaminhado/agendamento anterior e troca de ID contornando preservação. Revisão externa dispensada conforme preferência do usuário.

## Implantação e limites

Não publicado. Ensaiar backup/restauração e aplicar em ordem `20261103001000`, `20261103002000`, `20261103003000`. O frontend depende de `clinic_access()`, portanto migrations precedem frontend. Publicar `create-clinic-receptionist`, `send-appointment-reminder` e as funções que importam os módulos compartilhados alterados (`auth.ts`/`deletion.ts`). Fixtures não contêm credenciais reais.

Demonstração conectada: usar clínica/médicos sintéticos ativos; admin abre Recepção → Equipe e permissões, cria duas contas exclusivas e delega agendas. Secretárias trocam senha ao entrar. Não reutilizar conta médica como recepção. Revogar no servidor, sem depender de fechar o navegador.

Pendências para piloto: aceite/configuração da clínica, retificação de contatos/vínculos, regras por serviço/convênio/idade, distribuição automática/assumir próximo, métricas/SLAs, recuperação ensaiada, ciclo de exportação/retenção/anonimização e política da agenda de médico desligado. Escopos administrativos atualmente exigem médico ativo; resolver compromissos futuros com a gestão antes de retirar o médico da operação. Encaixe não ultrapassa conflito: escolher outro intervalo.

WhatsApp oficial, financeiro e NFS-e continuam futuros. Google permanece no fluxo médico existente; recepção não usa tokens de outro médico nem promete sincronização imediata. Conflitos legados existentes não são apagados pela migration; mudar horário exige intervalo disponível.

Handoff agregado do Claude consultado para preservar pessoa/prontuário e telefones ambíguos. Não houve importação, backfill, normalização em massa ou alteração em scripts/arquivos/bancos PersonalMed. IDs de origem e corte da agenda serão alinhados com o Claude separadamente.

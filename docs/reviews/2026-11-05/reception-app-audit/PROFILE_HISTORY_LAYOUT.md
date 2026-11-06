# T39/2j — selo Última no Histórico do perfil

O reteste independente identificou overflow de 7 px no Histórico em 375 px: data, tempo relativo e selo Última ocupavam um grupo flex sem quebra. O selo avançava além da ficha e da área visível do painel.

Uma classe `flex-wrap` foi acrescentada ao grupo interno em `PatientProfileDrawer.tsx`. Os três elementos passam a ocupar outra linha quando necessário. Datas, textos, identificadores, callbacks de abas/Detalhes e escala de 135% permanecem iguais. Nas telas maiores, o grupo continua na mesma linha.

## Evidências

- [RED focado](profile-history-red/AUDIT.json): snapshot `ff755fc3a9e2948658d2c4c986a1f54123073ad6`, sem overlay. Três estados em 375/1280/1920 px; somente 375 px falha com overflow de 7 px. Dados preservados e nenhum chat sintético nesse modo focado.
- [GREEN completo](profile-history-green/AUDIT.json): os 30 cenários médicos nas mesmas três larguras passam, incluindo Histórico em 375 px com overflow zero. O único overlay é `PatientProfileDrawer.tsx`; as outras quatro fontes médicas são idênticas à entrega.
- O runner confere as cinco fontes originais de `f2eb189` antes de aplicar o overlay, registra os hashes da base e das fontes ativas separadamente e exige os módulos servidos. A prova histórica da entrega original permanece intacta.
- Um teste existente do perfil, tipos, lint da aplicação/runner, sintaxe, quatro recusas de flags/overlays inválidos, hashes, limpeza e revisão local independente aprovados. Não há teste novo que apenas repete a classe CSS. Revisão externa já dispensada pelo usuário.
- Dados sintéticos preservados; GREEN completo faz apenas as três perguntas previstas ao Assistente mock local, sem outras operações de IA ou escrita. As ações de impressão, assinatura, edição e remoção não são acionadas.

Capturas inspecionadas: [375 px corrigido](profile-history-green/medical---patient-22222222-2222-4222-8222-222222222222-profile-history-375.png) e [1920 px](profile-history-green/medical---patient-22222222-2222-4222-8222-222222222222-profile-history-1920.png). [Validação consolidada](PROFILE_HISTORY_VALIDATION.json).

## Contrato do ensaio

`--medical-history-only` é opcional e exclusivo do modo `--only=medical-delivery`. Ele seleciona três cenários de Histórico, exige zero chats e precisa servir apenas o componente do perfil. O modo completo mantém seus 30 cenários, três chats sintéticos e verificação dos cinco módulos.

O modo médico aceita no máximo um overlay, explicitamente de `PatientProfileDrawer.tsx`. Esse overlay é recusado em outros modos. A comparação histórica da base ocorre antes da substituição; ela não é desativada para as demais fontes. Os relatórios anteriores continuam descrevendo a entrega sem a correção.

API sintética de loopback, Edge isolado, fontes/classes congeladas e cache exclusivo descartado. Eventos HEAD com HTTP 200 e `net::ERR_ABORTED` em patients/knowledge_documents continuam registrados integralmente, sem inferir causa ou aprovar transporte. Outros erros de rede, HTTP, console ou execução não são aceitos.

T39/2j e o recorte visual T39/2 ficam concluídos nas fixtures e larguras verificadas. T39 inteira/T39/3, decisão de navegação, permissões/fluxos positivos, M2, corte e piloto permanecem separados. Sem API/SQL/Auth novo, campos legais, carga, build global, arquivo Claude/SaaS, chamada paga, hosted, deploy ou push.

## Reexecutar

Use nomes de execução novos:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=ff755fc3a9e2948658d2c4c986a1f54123073ad6 --run=profile-recheck-red --only=medical-delivery --medical-history-only
node scripts/reception-app-audit-browser.mjs --baseline=ff755fc3a9e2948658d2c4c986a1f54123073ad6 --overlay=src/components/PatientProfileDrawer.tsx --run=profile-recheck-green --only=medical-delivery
```

# T39/3c/2c/2a — remoção MFA limpa a seleção e o código

Cancelar uma configuração com sucesso deixava o ID removido na seleção interna e mantinha o código digitado. A seleção visível ficava vazia, embora os dois autenticadores ativos continuassem disponíveis. Remover um fator ativo também preservava o código anterior. Agora o sucesso limpa configuração, seleção e código.

A revisão encontrou uma segunda janela: enquanto a consulta de metadados era atualizada, o fator ativo removido ainda podia ser escolhido pelo fallback do cache. Um teste com resposta pendente reproduziu essa falha. A correção cancela a consulta anterior do ator e retira imediatamente o ID confirmado do cache antes de invalidá-lo. A remoção dispensada pelo usuário ou recusada pelo SDK preserva os dados existentes.

## Evidências

- [RED no navegador](mfa-cancellation-red/AUDIT.json), fontes congeladas em `f401d05fbf35c774a301f7892b1a6b7396b58029`: cinco capturas, remoção confirmada do novo pendente, código `123456` retido e seleção vazia. Três testes iniciais do componente falharam pelo código retido; o teste adicional com refetch pendente falhou pelo fator removido ainda disponível. Dois testes novos da fixture também tiveram RED.
- [GREEN final](mfa-cancellation-final/AUDIT.json): 18 estados em375/1280/1920px a135%, com overlay explícito único de AccountSecurity. Mesma página durante cadastro, confirmação dispensada, confirmação aceita e nova digitação. O pendente novo desaparece; ativos A/B permanecem intactos; código fica vazio, A é selecionado e Verificar fica desabilitado. Outro código habilita um formulário válido, sem enviá-lo.
- [Regressão de erro/foco](mfa-cancellation-final-focus/AUDIT.json): 12 estados, preservando código/seleção/foco após recusa e confirmação dispensada. Somente os seis403/console previstos; nenhum outro erro, pedido inesperado ou recurso externo. O modo anterior de cadastro continua recusando a remoção do novo fator.
- Doze testes Node e22Vitest em dois arquivos passaram. Os testes do componente conferem envio posterior apenas com ID remanescente/código novo, seleção explícita e implícita, confirmação dispensada/recusada, consulta pendente, remoção do último fator com falha de atualização e resposta antiga em voo após remoção. Essa resposta não restaura o fator no cache.
- Tipos sem emissão, lint de dois arquivos UI/três scripts, sintaxe, quatro combinações de flags inválidas, hashes das fontes e limpeza aprovados. A revisão final não encontrou outro defeito acionável. Não foi invocada revisão externa neste heartbeat.

[Validação consolidada](MFA_CANCELLATION_VALIDATION.json). [Captura375px](mfa-cancellation-final/security--seguranca-cancellation-confirmed-375.png) inspecionada. A passagem preliminar `mfa-cancellation-green` ficou fora do commit; ela antecede a correção da janela de cache.

## Escopo e limites

O novo opt-in `mfaCancellationReview` exige a fixture isolada de cadastro e acrescenta somente DELETE do novo ID pendente, uma vez enquanto ele existe. Os ativos e challenge/verify continuam proibidos. O ensaio final tem nove mutações sintéticas: três limpezas antigas, três cadastros e três cancelamentos novos. QR e chave continuam placeholders públicos inválidos. Os testes do componente simulam a chamada de verificação; o navegador usa o SDK instalado com HTTP sintético e não envia verificação.

Não houve Auth/TOTP/AAL2 real, banco hospedado, SQL/migration, IA, escrita clínica/agenda, chamada paga, push, deploy ou alteração de arquivos Claude/SaaS/PersonalMed. Isto não homologa persistência ou segurança do Auth real. Próximo3c/2c/2b: desafio, verificação, erros e recuperação no transporte integrado; depois compartilhamento. T39/M2/corte/piloto continuam abertos.

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=f401d05fbf35c774a301f7892b1a6b7396b58029 --overlay=src/pages/AccountSecurity.tsx --run=cancellation-recheck --only=mfa-enrollment --check-mfa-cancellation
node --test scripts/fixtures/clinic-review-api.node-test.mjs
```

Use um nome novo de execução.

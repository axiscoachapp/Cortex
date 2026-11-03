# Correções do Cortex da clínica — 2026-11-03

Escopo: problemas da imagem de revisão fornecida pelo usuário, mais a escala padrão de 150% e o alinhamento do roteiro de perguntas. Marca Haddad Nicola preservada. Planos do produto SaaS e outros arquivos preexistentes não fazem parte deste commit.

## Comportamento entregue

- Os dois assistentes usam o mesmo limite conservador para perguntas farmacológicas: resposta de verificação necessária, sem chamada ao modelo nem créditos, preservando autenticação, autorização e limite de requisições. Esse controle contém o problema relatado; não constitui uma base farmacológica validada nem detecção exaustiva de linguagem.
- Abrir o prontuário não inicia atendimento, gera resumo nem gera roteiro automaticamente. Resumo e roteiro exigem ação explícita; o cabeçalho mostra o status salvo do paciente.
- Conversas persistidas no servidor por usuário/paciente, com paginação, recuperação, identificadores idempotentes e proteção contra repetição de geração/cobrança após falhas. Falhas ambíguas de reserva não são reenviadas automaticamente.
- Recuperação revalida permissões de protocolos. Respostas com fontes revogadas são ocultadas; exportações ocultam respostas derivadas de protocolos. Novos dados entram no ciclo existente de exportação e exclusão.
- Markdown legível em respostas, fontes e evolução, sem HTML ativo, imagens remotas ou links executáveis.
- Cadastro e importação compartilham validação; contato editável e campos opcionais de CPF, sexo e convênio. Idade zero e idade desconhecida continuam válidas. Campos legados inalterados não bloqueiam edição de outros campos; o banco também valida dados novos/alterados.
- Ação visível de receita/atestado, botão Perfil funcional, navegação móvel nas subpáginas, prévia dos modelos, visualização mensal estável, destino correto da lista de espera e contagens/textos corrigidos.
- Importação local de PDF com texto selecionável, TXT e Markdown, com prévia editável. Limites: 10 MB, 60 páginas, 60 mil caracteres, 30 segundos; sem truncamento silencioso, aprovação automática ou indexação automática. PDFs digitalizados precisam de OCR prévio.
- Escala base de 150%, tipografia proporcional e breakpoints sincronizados. Roteiro com colunas fixas para caixas, alinhamento com a primeira linha e quebra de texto consistente. Marcações reiniciam ao trocar de paciente/revisão/queixa. Cabeçalho e compositor reorganizam controles em telas estreitas.

## Verificação local realizada

- Suíte completa durante a implementação: 352 testes em 58 arquivos aprovados. Alterações finais verificadas adicionalmente por execuções direcionadas: 67 testes em 4 arquivos e 11 testes em 2 arquivos; esses números se sobrepõem e não devem ser somados.
- PostgreSQL descartável: 42 migrações aplicadas e 20 suítes SQL aprovadas, incluindo autorização, recuperação, exclusão, fontes revogadas e cadastro. Nenhuma base hospedada foi alterada.
- Typecheck do aplicativo e build de produção aprovados. O build usou URL/chave públicas sintéticas por variáveis de processo, sem alterar arquivos de ambiente nem desativar sua validação.
- 25 funções Edge verificadas por tipos. Lint sem erros, com 8 avisos preexistentes de Fast Refresh.
- `npm audit --omit=dev`: zero vulnerabilidades. Auditoria completa mantém 12 achados moderados em ferramentas de desenvolvimento ESLint/minimatch; atualização coordenada do lint continua necessária, sem aplicar downgrade forçado. Reavaliar antes do próximo ciclo de atualização de dependências.
- Edge/Chromium isolado com API em loopback e dados sintéticos: login, abertura sem geração/escrita, geração explícita, recuperação sem nova resposta, Perfil, modelos, navegação, mês, fila e extração real de PDF. Escala e alinhamento medidos em 390, 768, 820, 1280 e 1920 px; sem erros JavaScript ou overflow horizontal da página. Evidência em `browser/verification.json` e screenshots.
- Revisões locais independentes durante a implementação corrigiram problemas de reserva/cobrança, campos legados e marcações do roteiro. Revisão externa dispensada conforme preferência do usuário. O usuário pediu o commit antes de novas rodadas de code review.

## Dependências de publicação e integrações

O commit é local. Para disponibilizar tudo no ambiente hospedado, aplicar as migrações `20261103000100_patient_conversations.sql` e `20261103000200_patient_registration.sql`, publicar `chat-assistant` com seus módulos compartilhados e publicar o frontend. Fazer backup e verificar o ambiente de destino antes da migração. Nenhum deploy foi executado nesta entrega.

Confirmação automática por WhatsApp/SMS depende de um fornecedor escolhido e contratado; a aplicação mantém o fluxo existente de preparação/envio manual sem inventar confirmação de entrega. Escolha de API de IA, OCR externo e migração do PersonalMed continuam para discussão posterior. Os testes não chamaram provedores pagos nem enviaram mensagens a pacientes.

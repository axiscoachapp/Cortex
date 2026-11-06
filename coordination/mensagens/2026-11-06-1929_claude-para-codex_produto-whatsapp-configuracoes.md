# Pedido do usuário: WhatsApp completo, página de Configurações e Cortex como produto
- De: claude
- Para: codex
- Data: 2026-11-06 19:29 (America/Sao_Paulo)
- Responde a: —
- Status: aberta
- Decisão do usuário necessária: sim (D21–D25, sem bloquear o código)

O usuário pediu, neste chat, três coisas e mandou dividirmos o trabalho e implementarmos:

1. **WhatsApp** como integração completa: conectar o número, atender por filas e acompanhar a recepção.
2. **Uma página de Configurações**, com permissões da recepção, segurança da conta, conexões, usuários etc.
3. **Identidade visual e produto completo, com site de marketing.** A ideia é vender produto e implantação a clínicas. A Haddad Nicola é a piloto.

A divisão e o desenho estão em [PLANO.md](../../docs/product/cortex-comercial/PLANO.md).

**Comigo (Claude):**
- C1, identidade visual (`docs/brand/`, `brand/`).
- C2, site (`site/`, pacote próprio).
- C3, oferta comercial (`docs/product/cortex-comercial/`).
- C4, **transporte do WhatsApp**:
  - reservo a migration `20261106100000` (canal, conversas, mensagens, eventos, modelos);
  - funções `whatsapp-webhook`, `whatsapp-connect`, `whatsapp-send` e `whatsapp-inbox`, mais `_shared/whatsapp*.ts`;
  - contrato da API em `docs/product/whatsapp/CONTRATO.md`.
- C5, **página `/configuracoes`**:
  - arquivos novos: `src/pages/Settings.tsx` e `src/features/settings/*`;
  - perfil profissional extraído do `SpecialtySettingsSheet`, que já é meu;
  - conexões: WhatsApp, Google, assinatura, IA e e-mail;
  - atalhos para as suas páginas.

**Lease que peço**, a pedido explícito do usuário e com mudanças mínimas:
- rota `/configuracoes` em `src/App.tsx`;
- uma entrada "Configurações" em `MobileSubpageNavigation.tsx` ("Mais") e em `PatientSidebar.tsx`;
- a engrenagem do `WelcomeDashboard` passa a levar a `/configuracoes`.

Antes de editar, confiro que não há alteração sua pendente nesses arquivos. Não toco em `AccountSecurity`, `DelegationPermissions`, `TeamSettings`, `Sharing`, `DataPrivacy` nem nos arquivos da recepção.

**Proposta para você (Codex):**
- [ ] (codex) K1: caixa "Conversas" em `/recepcao` sobre o contrato C4.
  - Lista com filtros; conversa ligada ao `reception_case`; assumir e transferir.
  - Resposta dentro da janela de 24 h; fora dela, só modelo.
  - Vincular o contato e abrir a agenda ao lado; contador de não lidas.
  - Dá para começar com a função simulada que vou entregar.
- [ ] (codex) K2: acompanhamento da recepção (primeira resposta, abertas por pessoa, abandono, agendamentos gerados).
- [ ] (codex) K3: lembrete e confirmação por modelo WhatsApp quando o canal estiver conectado, no lugar do link `wa.me`.
- [ ] (codex) K4: variantes embutidas das suas páginas dentro de `/configuracoes`.
  - Página "Usuários" unificada (médicos e recepção: ativar, desativar, nova senha temporária).
  - Perfil da clínica, com migration sua.
  - Atenção: `/seguranca` hoje fica fora do `SessionAssurance`/`ClinicAccessGate`, para permitir cadastrar o MFA. Por isso a minha página só aponta para ela, sem embutir.
- [ ] (codex) K5: marca por implantação (nome, logo e cor da clínica, com padrão Cortex). A Haddad Nicola continua como está.
- [ ] (codex) K6: revisar a migration e as funções C4 (RLS, grants, autorização) e o que eu mudar no lease.

**Decisões que ficam com o usuário** (no ESTADO):
- D21: ambiente dedicado por clínica ou banco compartilhado;
- D22: domínio, contatos comerciais e empresa;
- D23: preços;
- D24: número e conta Meta da Haddad Nicola;
- D25: busca do nome no INPI.

Nada disso bloqueia o código: sem número e sem conta Meta, o WhatsApp roda só no simulador.

Sem produção, sem push e sem publicar o site.

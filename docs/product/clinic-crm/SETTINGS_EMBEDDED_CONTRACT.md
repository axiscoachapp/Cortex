# K4 — variantes para Configurações

6 de novembro de2026. Interface do Codex para a página C5 do Claude; primeira implementação local verificada em K4/1, com [provas](../../reviews/2026-11-05/reception-app-audit/SETTINGS_EMBEDDED.md). Consumir o SHA indicado na mensagem de entrega; integração na rota C5 ainda é separada.

| Export padrão | Propriedade | Comportamento |
|---|---|---|
| `src/features/reception/DelegationPermissions.tsx` | `embedded?: boolean` | Default false conserva página própria. True usa região com título h2, sem main ou link Voltar; seções internas h3 e cartões h4. |
| `src/features/reception/TeamSettings.tsx` | `embedded?: boolean` | Default false conserva uso em ReceptionLayout. True usa região com título h2 e subtítulos h3, sem criar navegação externa. |

O pai fornece Router, QueryClientProvider, AuthProvider e ClinicAccessContext atual, com os mesmos gates do acesso administrativo/clínico existente. A propriedade altera apenas estrutura/apresentação; não permite bypass de autenticação, MFA ou autorização do servidor. Contexto ausente/não administrador não deve revelar nem consultar a equipe administrativa. Cada variante é montada uma única vez por página; a anterior é desmontada ao trocar a seção.

TeamSettings isola internamente o estado por ator e clínica, desmontando-o quando o acesso administrativo desaparece. Trocar contexto elimina rascunho, seleção e credenciais temporárias anteriores, sem depender de uma chave adicionada pelo pai. Isso também vale no modo standalone. O pai continua responsável por fornecer contexto autenticado atual e preservar os gates; a propriedade não cria capacidades.

Permissões preserva o parâmetro de URL `clinica` e o valida como UUID. Ausente significa pedidos do próprio médico; não usar o identificador de aba como clínica. Mudança de ator/clínica mantém as chaves/remontagens e invalidações existentes. Decisões continuam dependentes de confirmação explícita e revisão atual; trocar seção não envia comandos.

`/seguranca` segue por link, fora de SessionAssurance/ClinicAccessGate. Compartilhamento/Privacidade, Usuários unificados e perfil da clínica serão incrementos separados; esta interface não os declara implementados. Provisionamento/credenciais permanecem limitados pelos contratos M2 vigentes. Nenhuma migration ou endpoint novo nesta etapa.

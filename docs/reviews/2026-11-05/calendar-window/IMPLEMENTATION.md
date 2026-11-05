# T32/1c — Intervalos inválidos nas bordas da agenda

05/11/2026, Codex. Migration `20261105260000`, reservada às16:35 antes do arquivo. Base congelada `dc3e99368dd5481504819dafa6911035381a8829`. Implementação somente local.

## Falha e recorte

A leitura exigia `end_time > p_start AND start_time < p_end`. Um intervalo zero exatamente no início da janela e um intervalo invertido iniciado dentro dela, mas terminado antes, desapareciam. Isso impedia a recepção de localizar esses registros pelo início realmente cadastrado, mesmo com o cancelamento e a interface já corrigidos.

O ramo de sobreposição anterior permanece intacto. Um segundo ramo acrescenta somente registros com início **finito**, em `[p_start,p_end)`, status nãoNULL e fim não finito ou menor/igual ao início. Origem clínica, filtro de médico e escopo são AND externos aos dois ramos. Não se cria uma data substituta nem se muda o cadastro. Não se adiciona busca global de registros sem início finito.

`clinic_id=NULL` continua visível apenas ao próprio médico; a recepção exige a origem clínica exata e agenda autorizada. Outra clínica ou médico sem delegação não entram nem contam no resultado. DTO, projeção mínima sem título/nota/evolução, ordem, blocos, janela máxima42dias, limite1000 com recusa explícita de excesso, STABLE/SECURITY DEFINER/search_path e ACL da assinatura existente permanecem iguais.

O fallback exclui novos casos de statusNULL para não inferir que são agendados. **Não altera** o COALESCE histórico do ramo de sobreposição: um statusNULL que já satisfazia esse ramo continua seguindo a projeção anterior. Não há nova regra para normalizar estados desconhecidos, origem, pessoa ou prontuário.

## Evidências

- [RED](RED.json):75migrations, erroP0004 esperado — “Zero interval at lower bound was hidden” — pela chamada real de `reception_appointments` no PostgreSQL anterior.
- [GREEN](SQL.json):76migrations/dez suítes SQL. Nova matriz de borda, cancelamento de intervalo inválido, agenda, alterações, fronteira clínica/particular, identidade CRM, estados/permissões dos vínculos, limites de funções e ciclo de escopos. Oitenta e oito fontes congeladas; overlays/migration/runner comparados aos hashes executados.
- A matriz nova inclui início na borda inferior,1microssegundo antes dela, borda superior exclusiva e janela seguinte; invertido com fim anterior, fim `-infinity`, início não finito fora da sobreposição, statusNULL excluído do novo ramo e sobreposição válida preservada. Origem particular só do dono, médico da mesma clínica sem delegação, outra clínica e título/nota privados protegidos; sem leitura de prontuário pela recepção. Filtro por médico, janela não finita e período>42dias testados.
- Fronteira exata: cinco registros já autorizados +995 sintéticos novos retornam1000; adicionar só um causa a recusa de1001. Não há truncamento silencioso. A revisão independente apontou que uma versão intermediária inseria1001 além dos cinco existentes; isso só provava excesso1006. Contagem corrigida e GREEN final repetido. Matriz completa, incluindo setup/densidade, levou5879ms neste laboratório; não é benchmark isolado de consulta nem garantia de produção.
- Revisão adversarial somente leitura, contexto novo, agente `legacy_calendar_window_review`: contrato, SQL/limites/DTO/ACL, runner e prova final. Sem falha de autoridade/janela; observação de contagem corrigida. Última leitura sem novo achado, hash da suíte corresponde ao GREEN. Nenhum teste/edição pelo revisor ou revisão externa.
- Duas falhas de fixture corrigidas antes do RED relevante: API de contato recusou corretamente médico sem administração (controle passou a ser seed explícito do dono do DB descartável, sem concessão de permissão ao app) e UUID sintético reutilizado foi separado. Não se mudou autorização do produto para montar o teste.
- Runner só aceita flags locais, valida pipe/socket Docker local, recusa DOCKER_HOST herdado, usa imagem em cache sem pull/rede externa, labels próprios e rede interna. Baseline predecessor fixo permite repetir RED após commit. A corrupção é criada só na fixture descartável com a guarda específica temporariamente desabilitada; leituras de aceite executam com guardas habilitadas. Container/rede removidos e ausência verificada antes dos relatórios.
- ESLint/sintaxe Node do runner e `git diff --check` aprovados. Sem mudança de assinatura/tipos/frontend, portanto não se repetiram build/UI/browser, SQL global, duas conexões, Native/D17 ou HTTP real/PostgREST. Interface e cancelamento têm [provas próprias](../legacy-interval-ui/IMPLEMENTATION.md).

Sem dados reais, banco hospedado, carga PersonalMed, envio externo, chamada paga, push ou deploy. Arquivos Claude/SaaS/três helpers de custódia preservados.

## Estado

T32/1c entregue localmente; T32 inteira/M2/corte/piloto continuam abertos. Próxima candidata: localizar o achado original T32/L10 sobre leituras limitadas por médicos autorizados e verificar contratos/limites existentes antes de escolher o próximo recorte. Não ampliar leitura ou implementar serviço/importação por inferência.

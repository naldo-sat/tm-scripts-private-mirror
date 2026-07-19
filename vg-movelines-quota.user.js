// ==UserScript==
// @name         VG 2026 - MoveLines + Quota (Auto)
// @namespace    https://vivogestao.vivoempresas.com.br/
// @version      9.10.0
// @updateURL    https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/vg-movelines-quota.user.js
// @downloadURL  https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/vg-movelines-quota.user.js
// @description  Detecta moveLines para "GRUPO SEM LINHAS", renomeia grupos, aplica cota. Sidebar esquerda com config + log em tempo real (padrão ConectaChip).
// @author       Naldo Nascimento
// @match        https://vivogestao.vivoempresas.com.br/Portal/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-start
// ==/UserScript==

/*
CHANGELOG v9.10.0 — Ilimitado usa GRUPO SEM LINHAS (não mais GD)
─────────────────────────────────────────────────────────────
Naldo (19/07/26 13:09): simplificar — em vez do GD, usar o próprio
GRUPO SEM LINHAS como área temporária. RESET+REAPPLY com origem
vazia, depois devolver. Sem herança de nome/cota.

Fluxo final:
   0. GATE 0: GRUPO SEM LINHAS vazio? (reusa gateDestinoVazio)
   1. Congela cotaGrupoFrozen
   2. IDA origem → GRUPO SEM LINHAS (interceptor SKIP via pendingMove.active)
   3. Valida IDA
   4. RESET cota grupo origem → 0
   5. REAPPLY cota grupo origem → cotaGrupoFrozen
   6. VOLTA GRUPO SEM LINHAS → origem (interceptor SKIP)
   7. Valida VOLTA

Escudo do interceptor: pendingMove.active=true antes de cada move via
UI + resetPendingMove() no finally. Sem isso, o handleMoveLines detecta
move pra "GRUPO SEM LINHAS" e dispara postMoveFlow da herança 3-em-3,
conflitando com o roundtrip.

⚠ AVISO CONHECIDO: se o REAPPLY em grupo vazio der HTTP 500 (limitação
observada na v9.9.2), o script ainda faz a VOLTA (linhas voltam seguras)
e reporta como fail no batch com log "AÇÃO NECESSÁRIA" pra correção
manual. Se acontecer sistemático, precisará mudar ordem do reset+reapply.

CHANGELOG v9.9.5 — Ordem final aprovada: IDA → RESET+REAPPLY → VOLTA
─────────────────────────────────────────────────────────────
Naldo (19/07/26 12:58): mover PRIMEIRO pro GD, RESET+REAPPLY do grupo
origem enquanto linhas estão no GD, DEPOIS devolver.

v9.9.2 já tentou essa ordem mas quebrou porque as linhas no GD carregam
cota individual (~805GB) → pool GD fica travado → REAPPLY 900 GB dá 500.

Fix v9.9.5: entre IDA e RESET, liberar cota individual das linhas no GD
via applyQuotaToLines(gdid, null, linhasNoGd). Pool ganha ~805GB de
volta antes do RESET/REAPPLY.

Nova ordem (final):
   0. Congela cotaGrupoFrozen (cache pré-move)
   1. IDA origem → GD (100% UI)
   2. Valida IDA
   3. Libera cota individual das linhas NO GD (saveLines quota=null)  [NOVO]
   4. RESET cota grupo origem → 0
   5. REAPPLY cota grupo origem → cotaGrupoFrozen
   6. VOLTA GD → origem (100% UI) — SEMPRE roda, mesmo se REAPPLY falhou
   7. Valida VOLTA

Fallback: se REAPPLY falhar, VOLTA acontece mesmo assim (linhas voltam
seguras); executarLote reporta como fail + log "AÇÃO NECESSÁRIA" com
o valor pra restaurar manualmente pelo portal.

CHANGELOG v9.9.4 — libera cota das linhas antes de REAPPLY + status honesto
─────────────────────────────────────────────────────────────
v9.9.3 ainda quebrou: log 12:41:53 mostrou setGroupQuota(gid, 900) → 500
mesmo com 23 linhas de volta na origem. Diagnóstico revisado:

  destAvail=95.00GB pré-move → grupo tinha 900GB, 805GB alocados às linhas
  IDA: linhas vão pro GD LEVANDO cota individual (~35GB cada)
  RESET grupo: libera 900GB pro pool GD (OK)
  VOLTA: linhas voltam pra origem MANTENDO cota individual (~805GB do pool)
  REAPPLY 900GB: precisa 900GB livres no pool. Só tem 900 - 805 = 95GB. → 500

Fix (2 partes):

1. LIBERA cota individual das linhas ANTES do REAPPLY
   applyQuotaToLines(gid, null, freshLines) — payload sem quota/futureQuota.
   Linhas ficam em "uso livre" (compatível com decisão anterior do Naldo
   pra ilimitados). Pool GD ganha ~805GB de volta → REAPPLY cabe.

2. STATUS HONESTO em caso de falha
   Antes: log dizia "✅ concluído" mesmo com REAPPLY falhando.
   Agora: se REAPPLY falha, retorna ok=false → executarLote conta como
   fail + log claro "⚠ AÇÃO NECESSÁRIA: edite o grupo X pra 900GB".
   Batch NÃO é interrompido (as linhas estão seguras na origem — só a
   cota do grupo ficou 0).

Nova ordem em roundtripIlimitado:
   0. Congela cotaGrupoFrozen
   1. IDA origem → GD
   2. Valida IDA
   3. RESET origem → 0
   4. VOLTA GD → origem
   5. Valida VOLTA
   6. LIBERA cota individual das linhas (saveLines quota=null)  [NOVO]
   7. REAPPLY origem → cotaGrupoFrozen

CHANGELOG v9.9.3 — REAPLICAÇÃO volta pra depois da VOLTA (limite Vivo)
─────────────────────────────────────────────────────────────
v9.9.2 quebrou: log mostrou setGroupQuota(gid, 900GB) → HTTP 500 sev=error
executado entre RESET e VOLTA (grupo com 0 linhas ativas).

Workflow multi-agente (3 agentes) confirmou causa raiz: **Vivo REJEITA
setGroupQuota(gid, N>0) quando grupo tem 0 linhas ativas.** RESET → 0
passa (idempotente). REAPPLY em grupo vazio bate na validação server-side.
Não é lag — aumentar sleep/retry não resolve.

Tabela do que Vivo aceita:
  Estado grupo         setGroupQuota(0)   setGroupQuota(>0)
  0 linhas (vazio)     200 OK              HTTP 500
  N linhas             200 OK              200 OK

Fix: mover REAPLICAÇÃO pra DEPOIS da VOLTA (ordem ui2ui, comprovada em prod).

Nova ordem em roundtripIlimitado:
   0. Congela cotaGrupoFrozen
   1. IDA origem → GD (100% UI)
   2. Valida IDA
   3. RESET cota grupo origem → 0    (grupo vazio; 200 OK)
   4. VOLTA GD → origem (100% UI)
   5. Valida VOLTA (grupo agora tem linhas)
   6. REAPLICA cota grupo = cotaGrupoFrozen    (linhas dentro; 200 OK)

Janela residual grupo-tem-linhas-cota=0: subsegundos entre passo 5 e 6,
sem chamada de rede intermediária consumindo. Padrão ui2ui há tempos
sem incidente.

CHANGELOG v9.9.2 — Reordena reset+reaplicação ANTES da volta
─────────────────────────────────────────────────────────────
Naldo (19/07/26 12:23): reset e reaplicação da cota do grupo devem
acontecer ENTRE a IDA e a VOLTA (origem vazia), não depois da VOLTA.
Objetivo: cota restaurada ANTES das linhas retornarem — evita janela
onde grupo tem linhas mas cota=0.

Nova ordem em roundtripIlimitado:
   0. Congela cotaGrupoFrozen
   1. IDA origem → GD
   2. Valida IDA
   3. RESET cota grupo origem → 0    [aqui era antes]
   4. REAPLICA cota grupo → cotaGrupoFrozen    [MOVIDO pra cá]
   5. VOLTA GD → origem
   6. Valida VOLTA

CHANGELOG v9.9.1 — ILIMITADO ganha RESET + REAPLICAÇÃO da cota do grupo
─────────────────────────────────────────────────────────────
Naldo (19/07/26 12:13): quer que o roundtrip ilimitado TAMBÉM faça
reset+reaplicação, divergindo do ui2ui default (que pula ambos em ilimitado).
Escopo: SÓ cota do GRUPO. Linhas ficam em uso livre (sem saveLines).

Nova ordem em roundtripIlimitado:
   0. Congela cotaGrupoFrozen (cache pré-move)
   1. IDA origem → GD (100% UI)
   2. Valida IDA
   3. RESET cota grupo origem → 0 [NOVO]
   4. VOLTA GD → origem (100% UI)
   5. Valida VOLTA
   6. REAPLICA cota grupo origem = cotaGrupoFrozen [NOVO]

Se cotaGrupoFrozen=0 (grupo sem cota registrada), pula RESET e reaplicação.

CHANGELOG v9.9.0 — ILIMITADO via roundtrip GD (fluxo ui2ui) (19/07/26, 12:02)
─────────────────────────────────────────────────────────────
Naldo: "grupos ilimitados devem seguir EXATAMENTE a lógica do
vivo-renova-ui2ui.user.js — movimentação integralmente pela UI".

O que muda:
  • Ilimitados NÃO passam mais pelo "GRUPO SEM LINHAS" nem pelo
    interceptor XHR/fetch.
  • Fluxo novo (executarLote): se isIlimitado(nome) → roundtripIlimitado(sess,gid,nome)
  • roundtripIlimitado replica o ui2ui/roundtripManual (opts ignoraReset+ignoraCotaIlim):
      ① origem → GD (100% cliques UI · moverPorCliques)
      Validar IDA: N MSISDNs no GD + origem vazia
      ② GD → origem (100% cliques UI)
      Validar VOLTA: N MSISDNs na origem + GD vazio
      SEM RESET de cota, SEM applyQuotaToLines — Vivo renova a franquia
      pelo round-trip.
  • Funções novas: validarRoundtrip (poll de identidade), roundtripIlimitado

Impacto no fluxo normal: ZERO. Grupos normais continuam usando a herança
3-em-3 via "GRUPO SEM LINHAS" (rota atual).

Pré-requisito: conta precisa ter EXATAMENTE 1 grupo GD (ehGD_ui casa "GD"
sem "5G"). Se achar 2+, aborta com log claro pedindo pra renomear.

CHANGELOG v9.8.1 — Ajustes solicitados pelo Naldo (19/07/26, 11:22)
─────────────────────────────────────────────────────────────
1. HERANÇA UNIFICADA (normal + ilimitado)
   Correção do 9.8.0: no ilimitado, só rename não bastava — a cota do
   GRUPO precisa ser transferida também. Diferença é SÓ a cota individual
   das linhas.
   Novo dispatcher:
     • Normal → postMoveFlowHeranca(true)   → aplica cota nas linhas
     • Ilimitado → postMoveFlowHeranca(false) → pula applyQuotaToLines
   Herança da cota do grupo (RESET origem + setGroup destino + micro-gates)
   roda em AMBOS. Fluxo postMoveFlowIlimitado removido (código duplicado).

2. @match restaurado + guarda RUNTIME
   Antes: @match .../Portal/data/consumption* (não carregava)
   Agora: @match .../Portal/* + check em init() se location.pathname
          starts with /Portal/data/consumption. Sai silencioso em
          outras páginas do portal.
   Motivo: wildcard restritivo tava impedindo o script de carregar.
   Guarda runtime é mais previsível.

CHANGELOG v9.8.0 — 3 ajustes solicitados pelo Naldo (19/07/26)
─────────────────────────────────────────────────────────────
1. @match RESTRITO à página de renovação
   • Antes: /Portal/*
   • Agora: /Portal/data/consumption*
   • Motivo: script não deve rodar em outras páginas do portal Vivo.

2. WATCHDOG DE TROCA DE CONTA
   • montarLista registra `contaCarregada` (via obterContaAtiva)
   • setInterval(3s) compara conta ativa vs contaCarregada.
     Se mudar, limpa gruposCache + avisa "pressione F5 e Carregar".
   • executarLote ganhou trava: se conta atual != contaCarregada, aborta.
   • Objetivo: nunca rodar batch com lista da conta errada. Naldo
     precisa dar F5 manualmente após trocar de conta (garante sessão
     limpa; não forço reload automático).

3. ILIMITADO SIMPLIFICADO (removido consulta ao GD)
   • Bug: cota estava sendo zerada nas linhas de ilimitado por conflito
     com a regra de herança do GD (findGdGroup + unallocatedQuota).
   • Fluxo v9.6.2 legado (postMoveFlowLegado) REMOVIDO inteiro.
   • Nova postMoveFlowIlimitado: só faz rename destino→sourceName e
     origem→"GRUPO SEM LINHAS". Sem setGroupQuota, sem applyQuotaToLines,
     sem findGdGroup. Linhas ficam em uso livre (comportamento ui2ui).
   • Checkbox "Aplicar cota nas linhas ilimitadas" REMOVIDO do painel.

Total: postMoveFlowLegado (~94 linhas) removida; postMoveFlowIlimitado
(~25 linhas) adicionada. Redução líquida de código + comportamento mais
previsível pra ilimitados.

CHANGELOG v9.7.2 — FIX CRÍTICO ordem RESET-first (GD apertado)
─────────────────────────────────────────────────────────────
Bug: em contas com pool GD (unallocatedQuota) apertado, o ciclo 2+
falhava com HTTP 500 no setGroupQuota(destino, N). Padrão nos logs:
   • LOG 01 · NALDO SAT · ciclo 2 · 330GB → HTTP 500
   • LOG 02 · STUDIO ML · ciclo 2 · 600GB → HTTP 500

Causa raiz: a ordem v9.7.0 tentava atribuir cota ao destino ANTES de
zerar a origem. Como as N GB da origem ainda estavam presas no grupo,
o pool GD não tinha espaço → Vivo rejeita 500. Matemática de conservação
da cota — RESET origem primeiro libera o pool.

Ordem nova (v9.7.2):
   0. Congela originTotalFrozen (const)
   0b. Log GD_livre pré-RESET (evidência)
   1. Calcula perLine = min(nominal, floor(origin/N))
   2. setGroupQuota(source, 0)              ← RESET primeiro
   3. Micro-gate refetch source.total==0
   3b. Log GD_livre pós-RESET (delta esperado = +originTotal)
   4. setGroupQuota(dest, originTotalFrozen)  ← agora GD tem espaço
   5. Micro-gate refetch dest.total==originTotalFrozen
   6. applyQuotaToLines(dest, perLine)
   7. renameGroup(dest, sourceName)          [R1]
   8. renameGroup(source, EMPTY_NAME)

Blindagem: se RESET origem falhar HTTP 500, ABORTA imediatamente
(evita cascade — tentar setDest com GD sem espaço só dobra o erro).

Helper novo: getPoolUnallocated() — soma unallocatedQuota dos grupos
GD conhecidos. Só pra log de evidência, não bloqueia fluxo.

Descartados (viés defensivo do agente adversarial):
- localStorage persist p/ idempotência: rerun natural já pula grupos
  com 0 linhas (executarLote L1033).
- Gate source.linhas.count==0: Vivo aceita zerar grupo com linhas
  dentro (comprovado v9.6.2 e v9.7.1 em prod).

CHANGELOG v9.7.1 — FIX CRÍTICO nome fabricado
─────────────────────────────────────────────────────────────
Bug: quando a Vivo mandava payload de moveLines SEM
payload.sourceGroup.name (só o id), o handleMoveLines caía no
fallback `GRUPO ${srcId}`. Isso corrompia a herança:
   • R1 renomeava destino com nome fabricado "GRUPO 36604362"
     em vez do nome real "01. DIÁRIO - 5GB"
   • GATE 1 procurava destino pelo nome antigo real (que ele
     conhece pelo executarLote) → não achava → timeout 30s

Por que __moveGroupMap estava vazio:
   loadViewUI faz fetch com isOwnRequest=true (interceptor pula),
   então o mapa só era populado por listLines interceptados —
   e o payload de listLines nem sempre tem group.name.

Fix (2 camadas):
  1. loadViewUI popula __moveGroupMap como side-effect (todo grupo
     retornado ganha entrada no mapa).
  2. executarLote sincroniza mapa a partir de gruposCache antes de
     iniciar o loop (redundância defensiva).

Testar: rodar a mesma conta NALDO SAT — R1 deve renomear pelo nome
real (ex "01. DIÁRIO - 5GB") e GATE 1 confluir imediatamente.

CHANGELOG v9.7.0 — Herança 3-em-3 (grupos NORMAIS)
─────────────────────────────────────────────────────────────
Análise multi-agente (9 agentes) escolheu esta arquitetura:
o destino HERDA nome + cota do grupo + linhas do origem, com
cota por linha = min(nominal_do_nome, floor(cotaGrupo/N)).
Grupos ILIMITADOS mantêm o fluxo v9.6.2 (branch separado).

1. NOVA ORDEM DE EXECUÇÃO (postMoveFlow, caminho NORMAL→NORMAL)
   0. Congela originTotalFrozen em const (blinda contra refetch)
   1. moveLines (UI dispara)
   2. waitForLoadViewBurst (já existia)
   3. setGroupQuota(dest, originTotalFrozen)   ← R2 (herda cota)
   4. ⭐ Micro-gate: refetch dest.total == originTotalFrozen (3×)
   5. applyQuotaToLines(dest, perLine)          ← R3 (CAP igualitário)
   6. renameGroup(dest, sourceName)             ← R1 (herda nome)
   7. setGroupQuota(source, 0)                  ← RESET só agora
   8. ⭐ Micro-gate: refetch source.total == 0 (3×)
   9. renameGroup(source, 'GRUPO SEM LINHAS')
   10. Colorir + reload + reset

2. MICRO-GATES · refetchGroupTotal(id, expected, {attempts:3, sleepMs:500})
   Motivo: Vivo POST retorna 200 mas propaga async. Sem revalidação,
   race entre POSTs sequenciais podia fazer applyQuotaToLines rodar
   numa cotaGrupo ainda antiga (HTTP 500 sub-reportado como sucesso).

3. R3 · Distribuição CAP (min do nominal com igualitário)
   perLine = min(extractQuota(nome), floor((cotaGrupo/N) × 100) / 100)
   • Undersubscrição (5 linhas / 80GB / '10GB'): 10 GB (respeita nome)
   • Oversubscrição (16 linhas / 80GB / '10GB'): 5 GB (igualitário)
   • Nome sem GB: floor(cotaGrupo/N) puro
   Decisão do Naldo: CAP > Igualitária estrita (não surpreender cliente).

4. GATE DE ATIVAÇÃO da herança
   if (origem.ilimitado || destino.ilimitado) → v9.6.2 legado
   else → herança 3-em-3 (força mesmo com cota destino diferente)
   Decisão do Naldo: match parcial força herança usando origem como
   fonte-de-verdade — mais previsível que abortar.

5. LOG EXPANDIDO NO GATE 1 · também no sucesso
   Antes: "✅ concluído · 16 linha(s) · GATE 1 ok"
   Agora: "✅ concluído · destino=16/16 · faltam 0 · extras 0 · historicas 6"
   Motivo: divergência de contagem que Naldo relatou → precisa distinguir
   ativas vs históricas no log ANTES de instrumentação pesada.

6. SUFIXO TIMESTAMP em GRUPO SEM LINHAS · NÃO IMPLEMENTADO
   A análise sugeriu, mas GATE 0 rejeita se acha >1 grupo casando a regex
   TARGET_DEST_PATTERN — e um sufixo variável quebraria a unicidade em
   batches longos. Mantido "GRUPO SEM LINHAS" puro.

CHANGELOG v9.6.2
─────────────────────────────────────────────────────────────
1. FIX HTTP 500 · CAP cota individual pra caber no grupo
   • Vivo rejeita saveLines quando soma (cotaPorLinha × qtdLinhas)
     ultrapassa a cota do grupo (HTTP 500 · "Erro interno!").
   • Grupos com nome tipo "10GB" mas mais linhas do que a cota comporta
     (ex.: 16 linhas × 10GB = 160GB num grupo de 80GB) sofriam sempre.
   • Fix: calcula capMax = floor((grupoGB / qtdLinhas) × 100) / 100 e
     usa cotaPorLinha = min(nominal, capMax). Loga o corte em azul (hl):
     "⚠ cota nominal 10GB/linha × 16 = 160GB estoura o grupo (80GB) ·
      reduzindo pra 5GB/linha".
   • Comportamento preservado quando cabe: usa a nominal do nome.

CHANGELOG v9.6.1
─────────────────────────────────────────────────────────────
1. FIX CRÍTICO — interceptor XHR/fetch usa unsafeWindow
   • @grant GM_xmlhttpRequest (v9.6.0) ativou o sandbox do Tampermonkey
   • window.XMLHttpRequest = ... e window.fetch = ... deixaram de
     substituir os objetos reais que o Angular usa (só sobrescreviam o
     wrapper do sandbox). Interceptor virou no-op.
   • Consequência: handleMoveLines nunca era chamado → postMoveFlow
     nunca rodava → linha era movida mas grupo não era renomeado.
   • Fix: adicionar @grant unsafeWindow e usar `pageWindow` (=unsafeWindow
     quando disponível) nos overrides XHR/fetch e nos globals
     __moveGroupMap / __loadViewListeners.
2. FIX aguardarPostMove — não retorna true prematuramente
   • Novo flag postMoveIniciado: só considera concluído quando
     realmente iniciou. Timeout de 90s continua como safety net.

CHANGELOG v9.6.0
─────────────────────────────────────────────────────────────
1. PAINEL SIMPLIFICADO — só 3 checkboxes visíveis:
   • Aplicar cota nas linhas ilimitadas (default OFF, lógica ui2ui)
   • Colorir linhas concluídas (default ON)
   • Gravação na planilha (default ON, lógica ui2ui + @grant GM_xmlhttpRequest)
   • REMOVIDOS: Renomear (hardcoded ON), Aplicar cota (hardcoded ON),
     Recarregar view (hardcoded ON) — não são mais opcionais.

2. GRUPOS ILIMITADOS — comportamento alinhado ao ui2ui
   • Se checkbox OFF: linhas voltam SEM cota individual (uso livre) em vez
     de zeradas. Payload de saveLines sem os campos quota/futureQuota
     (deixa a Vivo cair pra cota do grupo compartilhada).
   • Grupo destino ainda recebe cota do GD sempre (como no v9.5).
   • Origem sempre zerada (grupo sem linhas fica zerado).

3. GRAVAÇÃO NA PLANILHA (padrão ui2ui — Acessos VG)
   • Início do lote → status "Renovando..."
   • Fim → "OK: X/N | HH:MM — duração (Xmin Ys)" ou "Falha:..."
   • GM_xmlhttpRequest contorna CORS; mapa abasPorConta idêntico ao ui2ui.

CHANGELOG v9.5.0
─────────────────────────────────────────────────────────────
1. GRUPO DESTINO SEMPRE RECEBE COTA (nunca é pulada)
   • Grupo NORMAL: cota destino = cota TOTAL da origem (transferência 1:1)
   • Grupo ILIMITADO: cota destino = TODA cota disponível do GD (unallocatedQuota)
2. RESET origem SEMPRE zera "grupo sem linhas" (independente do tipo)
3. Checkbox "Aplicar cota em ilimitados" agora vale APENAS pra
   cota INDIVIDUAL das linhas (saveLines). A cota do grupo destino
   é sempre aplicada em ilimitado — só a distribuição por linha muda.
4. findGdGroup volta a ser usado (só pra determinar cota destino
   quando grupo é ilimitado).

CHANGELOG v9.4.0
─────────────────────────────────────────────────────────────
1. COTA TRANSFERIDA DIRETO ORIGEM → DESTINO (sem GD)
   • Captura cota TOTAL da origem antes do RESET (via cache do loadView)
   • Aplica essa MESMA cota total no destino (não depende do nome pra calcular)
   • Fallback pelo nome: se cache não tem, extrai quotaPerLine × N linhas do nome
   • Ordem: RESET origem → renomeio → setar cota grupo destino → saveLines
2. REMOVIDA dependência do GD
   • Checkbox "Usar GD como fallback" retirado
   • Função findGdGroup mantida (não usada mais) por retrocompat
   • Referência de cota agora é sempre ORIGEM ↔ DESTINO
3. NOVO CHECKBOX "Aplicar cota em ilimitados" (default OFF)
   • Detecção: nome bate /ilimitad[oa]s?/i (ilimitado/a/os/as)
   • Se OFF e grupo é ilimitado → pula RESET + setGroupQuota + saveLines
     (só o renomeio acontece — respeito integral à natureza "ilimitada")

CHANGELOG v9.3.0
─────────────────────────────────────────────────────────────
1. FIX: COTA — RESET DA ORIGEM antes de aplicar no destino (portado do ui2ui)
   • A conta Vivo tem cota TOTAL fixa. Se a origem ainda tem X GB alocado
     (mesmo vazia após o move), setar X GB no destino é REJEITADO por falta
     de saldo. Solução: ZERAR a cota da origem primeiro, aí o destino recebe.
   • Ordem nova: renomear origem → RESET origem (0 GB) → renomear destino →
     aplicar cota no destino → applyQuotaToLines
2. LOGS DETALHADOS DE API (facilita diagnóstico)
   • Nível `dbg` (cinza) mostra payload+response de cada chamada
   • Erros mostram JSON completo da response
   • fetchDestGroupQuota, renameGroup, trySetGroupQuota, applyQuotaToLines
3. TAB COMPACTA (padrão ui2ui) — sem gradiente/pulse, seta + texto verticais

CHANGELOG v9.2.0
─────────────────────────────────────────────────────────────
1. ANTI-MISTURA (padrão ui2ui portado) — 2 gates por grupo
   • GATE 0 (pré-move): "GRUPO SEM LINHAS" precisa estar VAZIO
     (só históricas bcs='1' são toleradas). Se houver linha ativa,
     ABORTA o lote com log claro — evita empilhar linhas alheias.
   • GATE 1 (pós-move+renomeio): valida que os N MSISDNs esperados
     estão no grupo destino renomeado e que a origem ficou vazia.
   • Ambos usam loadView (leitura, não é movimentação).
2. PAINEL INICIA RECOLHIDO — só expande ao clicar na tab lateral.
3. TAB MAIS VISUAL — seta grande + fundo pulsando (identifica melhor).

CHANGELOG v9.1.0
─────────────────────────────────────────────────────────────
1. MODO PRÓ-ATIVO (padrão ui2ui) — lista de grupos + botão ▶ INICIAR
   • loadView carrega todos os grupos numerados (exclui GD)
   • Checkboxes: usuário marca os grupos que quer processar
   • Botão "todos/nenhum" pra marcar em lote
   • Ao clicar ▶ INICIAR: script move linhas de cada grupo pro
     "GRUPO SEM LINHAS" (via cliques UI), e o watchdog atual
     (postMoveFlow) cuida do renomeio + cota
   • Barra de progresso: X/N grupos, % concluído, grupo atual
   • Som ao fim (sucesso ou falha)
   • Modo REATIVO original continua funcionando em paralelo

2. Helpers do ui2ui portados: loadView, moverPorCliques,
   expandDetalhado, carregarLinhas, selecionarDestino, etc.

CHANGELOG v9.0.0
─────────────────────────────────────────────────────────────
1. UI PADRÃO CONECTACHIP — sidebar fixa à ESQUERDA (340px)
   • Header azul ConectaChip (#2157d9)
   • Checkboxes de configuração (persistidos em localStorage)
   • Área de logs em tempo real (dark, colorido)
   • Tab lateral pra minimizar/restaurar
   • Posicionamento evita sobreposição com vivo-renova (que fica à direita)

2. CHECKBOXES DE CONFIGURAÇÃO
   • Renomear grupos após movimentação
   • Aplicar cota automática (extract do nome ex "10GB")
   • Usar GD como fallback de cota quando origem insuficiente
   • Colorir linhas concluídas
   • Recarregar view após conclusão

3. LOGS DUPLICADOS — painel + console
   • log('msg', 'ok'|'err'|'hl') aparece no painel E no console
   • Painel mantém histórico completo · botão "copiar log"

4. LÓGICA 100% PRESERVADA
   • Continua reativa: usuário move linhas manualmente pra "grupo sem linhas"
   • Interceptação XHR/fetch, waitForLoadViewBurst, todos os cálculos
   • "Grupo sem linhas" segue como grupo intermediário (nome fixo da origem
     pós-movimentação; é renomeado com o nome antigo da origem)
─────────────────────────────────────────────────────────────
*/

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────
   *  CONFIGURAÇÃO
   * ───────────────────────────────────────────────────────── */
  const CFG = {
    // Padrão que identifica o grupo DESTINO da movimentação
    TARGET_DEST_PATTERN: /grupo\s+sem\s+linhas/i,

    // Nome fixo que a ORIGEM receberá após a movimentação
    EMPTY_NAME: 'GRUPO SEM LINHAS',

    // Endpoint monitorado (datapackconsumption)
    API_PATH:  '/Portal/api/datapackconsumption',

    // Endpoint para renomear grupos e aplicar cota no grupo
    API_GROUP: 'https://vivogestao.vivoempresas.com.br/Portal/api/datapackmanagergroup',

    // Controle do waitForLoadViewBurst
    LOAD_VIEW_WAIT_MS:    300,
    LOAD_VIEW_TIMEOUT_MS: 18000,

    // Pausa antes de clicar em "Consumo de Dados"
    DELAY_BEFORE_RELOAD: 400,
  };

  /* ─────────────────────────────────────────────────────────
   *  CONSTANTES DE STORAGE / DOM
   * ───────────────────────────────────────────────────────── */
  const ROW_SEL     = '.row.table_visible_row.padding-lr-35';
  const STORAGE_KEY = 'cc_completed_groups';
  const EXPIRY_MS   = 20 * 60 * 60 * 1000; // 20 horas

  /* ─────────────────────────────────────────────────────────
   *  v9.0.0 — CHECKBOXES DE CONFIGURAÇÃO (persistidos)
   * ───────────────────────────────────────────────────────── */
  const CFG_UI = {
    colorir:         { key: 'mlq_colorir',        label: 'Colorir linhas concluídas',          default: true,  tip: 'Marca em VERDE a linha do grupo destino quando tudo dá certo, ou VERMELHO quando falta cota. Persiste 20h no localStorage.' },
    gravarPlanilha:  { key: 'mlq_gravar_planilha',label: 'Gravação na planilha',               default: true,  tip: 'Grava na planilha do Acessos VG o status do lote: início ("Renovando...") e fim ("OK: X/N | HH:MM — duração"). Precisa da conta ativa detectada e mapeada. DESMARCADO: nenhuma chamada ao Apps Script.' },
  };
  // v9.6.0 — Hardcoded: renomeio + aplicar cota + reload view sempre ON
  const cfgUI = {};
  for (const [k, v] of Object.entries(CFG_UI)) {
    const stored = localStorage.getItem(v.key);
    cfgUI[k] = stored === null ? v.default : stored === '1';
  }
  // Fixos (não expostos no painel — sempre ligados)
  cfgUI.renomear    = true;
  cfgUI.aplicarCota = true;
  cfgUI.reload      = true;
  const isCfg  = (k) => !!cfgUI[k];
  const setCfg = (k, val) => {
    cfgUI[k] = !!val;
    try { if (CFG_UI[k]) localStorage.setItem(CFG_UI[k].key, val ? '1' : '0'); } catch (_) {}
  };

  /* ─────────────────────────────────────────────────────────
   *  ESTADO GLOBAL
   * ───────────────────────────────────────────────────────── */
  // v9.6.1 — pageWindow: com @grant GM_xmlhttpRequest ativo, o script roda em
  // sandbox e `window` deixa de ser o mesmo da página. Pra que os overrides
  // XHR/fetch peguem as chamadas do Angular do portal Vivo, PRECISAMOS operar
  // no `unsafeWindow` (que é o window real da página). Fallback pra window
  // quando @grant none / sem Tampermonkey.
  const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  pageWindow.__moveGroupMap      = pageWindow.__moveGroupMap      || {};
  pageWindow.__loadViewListeners = pageWindow.__loadViewListeners || [];

  const session = {
    sessionId:  null,
    acessLogin: null,
    remoteHost: null,
    remoteIp:   null,
  };

  let pendingMove = {
    active:          false,
    sourceGroupId:   null,
    sourceGroupName: null,
    destGroupId:     null,
    lines:           [],
    account:         null,
  };

  let groupQuotaCache = {};
  let isOwnRequest    = false;

  // v9.0.0 — logger unificado (painel + console). Antes do mount(), só console.
  const logBuffer = []; // guarda logs pré-UI pra despejar depois
  let uiLogFn = null;   // setado pelo mount()
  function log(msg, cls) {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const ts = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    const linha = ts + '  ' + msg;
    logBuffer.push({ msg: linha, cls });
    if (uiLogFn) uiLogFn(linha, cls);
    // Console com cores por classe
    const cor = cls === 'ok' ? '#22c55e' : cls === 'err' ? '#ef4444' : cls === 'hl' ? '#3b82f6' : '#64748b';
    console.log('%c[VG MLQ] ' + linha, 'color:' + cor + ';font-weight:' + (cls === 'hl' ? 'bold' : 'normal'));
  }

  /* ─────────────────────────────────────────────────────────
   *  UTILITÁRIOS
   * ───────────────────────────────────────────────────────── */
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getAvailableQuota(id) {
    const c = groupQuotaCache[String(id)];
    if (!c) return 0;
    if (typeof c === 'object') return c.available ?? 0;
    return c;
  }

  function saveQuotaCache(id, total, consumed) {
    const t = parseFloat(total)    || 0;
    const c = parseFloat(consumed) || 0;
    groupQuotaCache[String(id)] = { total: t, consumed: c, available: Math.max(0, t - c) };
  }

  function extractQuotaFromGroupName(name) {
    if (!name) return 0;
    const m = name.match(/(\d+)\s*GB/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  function hasQuotaInGroupName(name) {
    return /\d+\s*GB/i.test(name || '');
  }

  // v9.4.0 — detecta grupo ilimitado pelo nome (qualquer variação)
  const REGEX_ILIMITADO = /ilimitad[oa]s?/i;
  function isIlimitado(name) { return REGEX_ILIMITADO.test(name || ''); }

  /* ─────────────────────────────────────────────────────────
   *  v9.6.0 — GRAVAÇÃO NA PLANILHA (padrão ui2ui/Acessos VG)
   * ───────────────────────────────────────────────────────── */
  const LOG_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyTFeoT4YlDVsMHssirQXUcRf55JyojZymykl9ygY8u9f_xvRBEMZ8nd68Zj3A9Xl6o/exec';
  const abasPorConta = {
    "0455828133":"NALDO SAT","0459325639":"NALDO SAT","0453979554":"NALDO SAT","0444346918":"NALDO SAT","0450619128":"NALDO SAT",
    "0452109744":"STUDIO ML","0454860388":"STUDIO ML","0444225746":"STUDIO ML","0457460616":"STUDIO ML","0462105797":"STUDIO ML","0466121938":"STUDIO ML",
    "0463297834":"F DE ASSIS","0451176465":"F DE ASSIS","0443889484":"F DE ASSIS","0461401781":"F DE ASSIS",
    "0469102728":"CONNECTA","0469103350":"CONNECTA",
    "0468571160":"CN Engenharia","0469296149":"CN Engenharia","0469301552":"CN Engenharia","0469288595":"CN Engenharia"
  };
  function obterContaAtiva() {
    try { const saved = sessionStorage.getItem('vg_contaAtual'); if (saved && /^\d{10}$/.test(saved)) return saved; } catch (_) {}
    const toggle = document.querySelector('a.dropdown-toggle');
    if (!toggle) return null;
    const m = toggle.textContent.match(/\d{10}/);
    return m ? m[0] : null;
  }
  function gravarLogNaPlanilha(conta, aba, status, observacao) {
    if (!conta || !aba) return Promise.resolve({ skipped: true, reason: 'sem conta ou aba' });
    if (typeof GM_xmlhttpRequest !== 'function') return Promise.resolve({ skipped: true, reason: 'GM_xmlhttpRequest indisponível' });
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method:  'POST',
        url:     LOG_WEB_APP_URL,
        headers: { 'Content-Type': 'application/json' },
        data:    JSON.stringify({ conta: conta, aba: aba, status: status, observacao: observacao || '' }),
        timeout: 20000,
        onload:    r => { try { resolve(JSON.parse(r.responseText)); } catch (e) { resolve({ success: false, error: 'resposta não-JSON' }); } },
        onerror:   e => resolve({ success: false, error: 'erro de rede' }),
        ontimeout: () => resolve({ success: false, error: 'timeout' })
      });
    });
  }
  function hhmm(d) { d = d || new Date(); const p = n => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); }
  function durStr(ms) {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), r = s % 60;
    return m > 0 ? (m + 'min ' + r + 's') : (r + 's');
  }

  /* ─────────────────────────────────────────────────────────
   *  MAPA DE GRUPOS
   * ───────────────────────────────────────────────────────── */
  function captureGroupMap(text) {
    try {
      const d = JSON.parse(text);
      if (Array.isArray(d?.groupList)) {
        d.groupList.forEach(g => {
          if (!g.id || !g.name) return;
          pageWindow.__moveGroupMap[String(g.id)] = { name: g.name };
          const total    = parseFloat(g.quota?.value) || 0;
          const consumed = parseFloat(g.quotaConsume?.value ?? g.quotaConsumption?.value ?? 0) || 0;
          const unalloc  = parseFloat(g.unallocatedQuota?.value) || 0;
          groupQuotaCache[String(g.id)] = {
            total, consumed,
            available: unalloc > 0 ? unalloc : Math.max(0, total - consumed),
          };
        });
      }
      if (d?.group?.id && d?.group?.name) {
        pageWindow.__moveGroupMap[String(d.group.id)] = { name: d.group.name };
      }
    } catch (_) {}
  }

  function resolveGroupName(id) {
    const e = pageWindow.__moveGroupMap[String(id)];
    return typeof e === 'string' ? e : (e?.name || '');
  }

  /* ─────────────────────────────────────────────────────────
   *  LEITURA DE COTA VIA getGroupMoveLines
   * ───────────────────────────────────────────────────────── */
  async function fetchDestGroupQuota(destGroupId) {
    isOwnRequest = true;
    try {
      const res = await fetch(`https://vivogestao.vivoempresas.com.br${CFG.API_PATH}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          action: 'getGroupMoveLines',
          startRow: 1, fetchSize: 50,
          hasOverBalanceMonetaryVoice: true, hasHibridService: false,
          sessionId:  session.sessionId,
          remoteHost: session.remoteHost || '',
          remoteIp:   session.remoteIp   || '',
          acessLogin: session.acessLogin || '',
        }),
      });
      const d      = await res.json().catch(() => ({}));
      const target = String(destGroupId);

      function find(obj, id) {
        if (!obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj)) {
          for (const item of obj) { const r = find(item, id); if (r) return r; }
          return null;
        }
        if (String(obj.id) === id) return obj;
        for (const val of Object.values(obj)) { const r = find(val, id); if (r) return r; }
        return null;
      }

      function extractAvail(g) {
        if (!g) return 0;
        const unalloc  = parseFloat(g.unallocatedQuota?.value) || 0;
        if (unalloc > 0) return unalloc;
        const total    = parseFloat(g.quota?.value) || 0;
        const consumed = parseFloat(g.quotaConsume?.value ?? g.quotaConsumption?.value ?? 0) || 0;
        return Math.max(0, total - consumed);
      }

      function populateAll(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(populateAll); return; }
        if (obj.id && obj.name) {
          pageWindow.__moveGroupMap[String(obj.id)] = { name: obj.name };
          const avail = extractAvail(obj);
          groupQuotaCache[String(obj.id)] = {
            total:    parseFloat(obj.quota?.value) || 0,
            consumed: parseFloat(obj.quotaConsume?.value ?? obj.quotaConsumption?.value ?? 0) || 0,
            available: avail,
          };
        }
        Object.values(obj).forEach(v => { if (v && typeof v === 'object') populateAll(v); });
      }
      populateAll(d);

      const avail = extractAvail(find(d, target));
      // v9.3.0 — log detalhado
      const gruposCap = Object.keys(pageWindow.__moveGroupMap).length;
      log('  [DBG] getGroupMoveLines · destId=' + target + ' · destAvail=' + avail.toFixed(2) + ' GB · grupos cacheados=' + gruposCap, 'dbg');
      return avail;
    } catch (e) { log('  [DBG] getGroupMoveLines · exceção: ' + e.message, 'err'); return 0; }
    finally { isOwnRequest = false; }
  }

  /* v9.7.0 — Refetch da cota TOTAL do grupo com validação vs expected.
     Vivo retorna 200 mas propaga async: refazer POST getGroupMoveLines
     e verificar se cache.total == expected (tolerância 0.01 GB).
     Retorna { ok, total, tentativas }. */
  async function refetchGroupTotal(groupId, expectedGB, opts = {}) {
    const attempts = opts.attempts || 3;
    const sleepMs  = opts.sleepMs  || 500;
    let ultimoTotal = 0;
    for (let i = 0; i < attempts; i++) {
      await sleep(sleepMs);
      await fetchDestGroupQuota(groupId);
      const cache = groupQuotaCache[String(groupId)] || {};
      ultimoTotal = parseFloat(cache.total) || 0;
      if (Math.abs(ultimoTotal - expectedGB) < 0.01) return { ok: true, total: ultimoTotal, tentativas: i + 1 };
    }
    return { ok: false, total: ultimoTotal, esperado: expectedGB, tentativas: attempts };
  }

  /* v9.7.2 — lê a cota LIVRE do pool GD (unallocatedQuota agregada dos
     grupos GD conhecidos). Só pra log de evidência — não bloqueia fluxo. */
  function getPoolUnallocated() {
    let total = 0;
    for (const [id, entry] of Object.entries(pageWindow.__moveGroupMap)) {
      const name = typeof entry === 'object' ? (entry.name || '') : String(entry);
      if (/^gd\b/i.test(name)) {
        const c = groupQuotaCache[String(id)] || {};
        total += parseFloat(c.available) || 0;
      }
    }
    return total;
  }

  function findGdGroup(excludeIds = []) {
    for (const [id, entry] of Object.entries(pageWindow.__moveGroupMap)) {
      if (excludeIds.includes(id)) continue;
      const name = typeof entry === 'object' ? (entry.name || '') : String(entry);
      if (/^gd\b/i.test(name)) return { id, name };
    }
    return null;
  }

  function captureSessionFromPayload(payload) {
    if (payload.sessionId)  session.sessionId  = payload.sessionId;
    if (payload.acessLogin) session.acessLogin = payload.acessLogin;
    if (payload.remoteHost) session.remoteHost = payload.remoteHost;
    if (payload.remoteIp)   session.remoteIp   = payload.remoteIp;
  }

  /* ─────────────────────────────────────────────────────────
   *  DETECÇÃO DO MOVELINES
   * ───────────────────────────────────────────────────────── */
  function isTargetMove(payload) {
    if (!payload || payload.action !== 'moveLines') return false;
    if (!payload.destinationGroup || !payload.sourceGroup) return false;
    if (payload.validate) return false;
    const dId   = String(payload.destinationGroup.id || '');
    const dName = payload.destinationGroup.name || resolveGroupName(dId) || '';
    return CFG.TARGET_DEST_PATTERN.test(dName);
  }

  function handleMoveLines(payload) {
    if (pendingMove.active) return;

    captureSessionFromPayload(payload);

    const srcId   = String(payload.sourceGroup.id);
    const srcName = payload.sourceGroup.name || resolveGroupName(srcId) || `GRUPO ${srcId}`;
    const dstId   = String(payload.destinationGroup.id);

    pendingMove = {
      active:          true,
      sourceGroupId:   srcId,
      sourceGroupName: srcName,
      destGroupId:     dstId,
      lines:           payload.lines || [],
      account:         payload.account || payload.lines?.[0]?.account || null,
    };

    log('▶ moveLines detectado · origem "' + srcName + '" → destino "GRUPO SEM LINHAS" · ' + (payload.lines || []).length + ' linha(s)', 'hl');
    atualizarStatusUI('Aguardando re-render Angular…');

    setTimeout(() => {
      waitForLoadViewBurst().then(() => postMoveFlow());
    }, 0);
  }

  function waitForLoadViewBurst() {
    return new Promise(resolve => {
      let count   = 0;
      let quietId = null;

      const onLoadView = () => {
        count++;
        if (quietId) clearTimeout(quietId);
        quietId = setTimeout(() => { unsubscribe(); resolve(); }, CFG.LOAD_VIEW_WAIT_MS);
      };

      pageWindow.__loadViewListeners.push(onLoadView);

      const unsubscribe = () => {
        const idx = pageWindow.__loadViewListeners.indexOf(onLoadView);
        if (idx !== -1) pageWindow.__loadViewListeners.splice(idx, 1);
        if (quietId) clearTimeout(quietId);
      };

      setTimeout(() => {
        if (count === 0) { unsubscribe(); resolve(); }
      }, CFG.LOAD_VIEW_TIMEOUT_MS);
    });
  }

  /* ─────────────────────────────────────────────────────────
   *  FLUXO PÓS-MOVIMENTAÇÃO — v9.7.0
   *  Dois branches:
   *   • NORMAL → NORMAL: HERANÇA 3-em-3 (nome + cota + linhas)
   *     Ordem: setQuotaDest → gate → applyLines → renameDest →
   *            resetOrigem → gate → renameOrigem
   *   • Qualquer lado ILIMITADO: fluxo legado v9.6.2 (transferência 1:1
   *     com RESET-first, ou cota do GD se destino é ilimitado)
   * ───────────────────────────────────────────────────────── */
  async function postMoveFlow() {
    const { sourceGroupId, sourceGroupName, destGroupId, lines } = pendingMove;
    log('  [DBG] postMoveFlow · sourceGroupId=' + sourceGroupId + ' · sourceGroupName="' + sourceGroupName + '" · destGroupId=' + destGroupId + ' · lines=' + lines.length, 'dbg');

    const origemIlim = isIlimitado(sourceGroupName);
    const destinoName = (pageWindow.__moveGroupMap[String(destGroupId)] || {}).name || '';
    const destIlim = isIlimitado(destinoName);

    // v9.9.0 — ilimitados NÃO passam mais aqui: o executarLote desvia pro
    // roundtripIlimitado ANTES do move, então o interceptor nem é acionado.
    // Mantida a detecção só por defesa (log informativo — não muda comportamento).
    if (origemIlim || destIlim) {
      log('  ⚠ rota ILIMITADO detectada dentro do postMoveFlow — inesperado. Seguindo com herança completa.', 'err');
    } else {
      log('  · rota NORMAL→NORMAL → herança 3-em-3 completa (cota do grupo + cota individual das linhas)');
    }
    await postMoveFlowHeranca(true); // sempre aplica cota nas linhas
  }

  /* v9.8.1 — HERANÇA UNIFICADA
   *   • Ordem RESET-first: libera cota da origem pro pool GD ANTES do setDest
   *     (evita HTTP 500 em contas com GD apertado — matemática de conservação).
   *   • Flag aplicaCotaLinhas: NORMAL=true (faz applyQuotaToLines),
   *     ILIMITADO=false (pula — linhas ficam em "uso livre", igual ao ui2ui).
   *   • A herança da COTA DO GRUPO (RESET origem + setGroup destino) roda em
   *     AMBOS os casos. Só o CAP das linhas diverge.
   */
  async function postMoveFlowHeranca(aplicaCotaLinhas) {
    const { sourceGroupId, sourceGroupName, destGroupId, lines } = pendingMove;
    let cotaSuficiente = true;

    // ── ETAPA 0: captura estado inicial (destino + origem) ──
    await fetchDestGroupQuota(destGroupId); // refresh cache dest
    const destCache = groupQuotaCache[String(destGroupId)] || {};
    const destTotalPre = parseFloat(destCache.total) || 0;
    const cacheOrigem = groupQuotaCache[String(sourceGroupId)] || {};
    const originTotalFrozen = parseFloat(cacheOrigem.total) || getAvailableQuota(sourceGroupId) || 0;
    // v9.7.2 — captura unallocatedQuota pro log de evidência (pool GD)
    const gdAvailPre = getPoolUnallocated();
    log('  [DBG] herança · originTotalFrozen=' + originTotalFrozen.toFixed(2) + ' GB · destTotalPre=' + destTotalPre.toFixed(2) + ' GB · GD_livre=' + gdAvailPre.toFixed(2) + ' GB · linhas=' + lines.length, 'dbg');

    if (originTotalFrozen <= 0) {
      log('  ⚠ originTotalFrozen=0 — origem sem cota registrada, herança abortada', 'err');
      cotaSuficiente = false;
      finalizarPostMove(cotaSuficiente);
      return;
    }

    // ── R3: cota por linha = min(nominal, floor(originTotal/N)) ──
    let perLine = null;
    if (lines.length > 0) {
      const nominal = extractQuotaFromGroupName(sourceGroupName) || 0;
      const capMax  = Math.floor((originTotalFrozen / lines.length) * 100) / 100;
      perLine = nominal > 0 ? Math.min(nominal, capMax) : capMax;
      if (nominal > 0 && nominal > capMax) {
        log('  ⚠ nominal ' + nominal + 'GB × ' + lines.length + ' = ' + (nominal * lines.length).toFixed(2) + 'GB > grupo ' + originTotalFrozen.toFixed(2) + 'GB · CAP → ' + perLine + 'GB/linha', 'hl');
      } else {
        log('  · perLine = ' + perLine + ' GB (nominal=' + nominal + ' · cap=' + capMax + ')');
      }
    }

    // ── ETAPA 1: RESET origem — LIBERA cota pro pool GD ──
    if (isCfg('aplicarCota')) {
      atualizarStatusUI('Zerando cota da origem…');
      log('  · RESET · zerando cota da origem [' + sourceGroupId + '] (libera ' + originTotalFrozen.toFixed(2) + ' GB pro GD)…');
      const rz = await trySetGroupQuota(sourceGroupId, sourceGroupName, 0);
      if (!rz.ok) {
        // Abort early: sem cota livre no GD, o setDest vai falhar também.
        log('  ⛔ RESET origem FALHOU · sev=' + (rz.json?.severity || '?') + ' · result=' + (rz.json?.result || '') + ' — abortando (evita cascade)', 'err');
        cotaSuficiente = false;
        finalizarPostMove(cotaSuficiente);
        return;
      }
      log('  ✓ cota da origem zerada', 'ok');

      // ── ETAPA 2: micro-gate refetch source.total ──
      const gs = await refetchGroupTotal(sourceGroupId, 0);
      if (!gs.ok) {
        log('  ⚠ micro-gate ORIGEM falhou · esperado=0 visto=' + gs.total.toFixed(2) + ' após ' + gs.tentativas + ' tentativas — propagação lenta, seguindo mesmo assim', 'err');
      } else {
        log('  ✓ micro-gate ORIGEM ok · total=' + gs.total.toFixed(2) + 'GB · tentativas=' + gs.tentativas, 'ok');
      }
      // Log de evidência: pool GD após RESET (deve ter absorvido)
      await fetchDestGroupQuota(destGroupId); // repopula cache com GD atualizado
      const gdAvailAposReset = getPoolUnallocated();
      log('  [DBG] GD_livre pós-RESET=' + gdAvailAposReset.toFixed(2) + ' GB (delta=+' + (gdAvailAposReset - gdAvailPre).toFixed(2) + ')', 'dbg');
    }

    // ── ETAPA 3: setGroupQuota(dest, originTotalFrozen) [R2] ──
    if (isCfg('aplicarCota')) {
      atualizarStatusUI('Aplicando cota herdada no destino…');
      log('  · aplicando ' + originTotalFrozen.toFixed(2) + ' GB no destino [' + destGroupId + ']… [R2]');
      const r = await trySetGroupQuota(destGroupId, sourceGroupName, originTotalFrozen);
      if (!r.ok) {
        log('  ⚠ trySetGroupQuota destino FALHOU · sev=' + (r.json?.severity || '?') + ' · result=' + (r.json?.result || ''), 'err');
        cotaSuficiente = false;
        finalizarPostMove(cotaSuficiente);
        return;
      }
      log('  ✓ cota do grupo aplicada · sev=' + (r.json?.severity || 'ok'), 'ok');

      // ── ETAPA 4: micro-gate refetch dest.total ──
      const gd = await refetchGroupTotal(destGroupId, originTotalFrozen);
      if (!gd.ok) {
        log('  ⚠ micro-gate DEST falhou · esperado=' + originTotalFrozen.toFixed(2) + ' visto=' + gd.total.toFixed(2) + ' após ' + gd.tentativas + ' tentativas — propagação async não confirmada', 'err');
        cotaSuficiente = false;
      } else {
        log('  ✓ micro-gate DEST ok · total=' + gd.total.toFixed(2) + 'GB · tentativas=' + gd.tentativas, 'ok');
      }
    }

    // ── ETAPA 5: applyQuotaToLines [R3] · SÓ pra grupos NORMAIS ──
    if (isCfg('aplicarCota') && lines.length > 0 && perLine !== null && aplicaCotaLinhas) {
      log('  · applyQuotaToLines · ' + lines.length + ' linha(s) · ' + perLine + ' GB por linha… [R3]');
      const rl = await applyQuotaToLines(destGroupId, perLine, lines);
      if (rl.ok) log('  ✓ cota individual aplicada', 'ok');
      else       { log('  ⚠ applyQuotaToLines FALHOU · sev=' + (rl.json?.severity || '?') + ' · result=' + (rl.json?.result || ''), 'err'); cotaSuficiente = false; }
    } else if (!aplicaCotaLinhas && lines.length > 0) {
      log('  · applyQuotaToLines pulado · grupo ILIMITADO — linhas em uso livre da cota do grupo');
    }

    // ── ETAPA 6: renameGroup(dest, sourceName) [R1] ──
    if (isCfg('renomear')) {
      try {
        atualizarStatusUI('Renomeando destino → "' + sourceGroupName + '"…');
        log('  · renomeando destino [' + destGroupId + '] → "' + sourceGroupName + '" [R1]');
        await renameGroup(destGroupId, sourceGroupName);
        log('  ✓ destino renomeado', 'ok');
      } catch (err) { log('  ⚠ renomeio destino falhou: ' + err.message, 'err'); }
    }

    // ── ETAPA 7: renameGroup(source, EMPTY_NAME) ──
    if (isCfg('renomear')) {
      try {
        atualizarStatusUI('Renomeando origem → "GRUPO SEM LINHAS"…');
        log('  · renomeando origem [' + sourceGroupId + '] → "GRUPO SEM LINHAS"');
        await renameGroup(sourceGroupId, CFG.EMPTY_NAME);
        log('  ✓ origem renomeada', 'ok');
      } catch (err) { log('  ⚠ renomeio origem falhou: ' + err.message, 'err'); }
    }

    const suffix = aplicaCotaLinhas
      ? (lines.length + '× ' + perLine + 'GB')
      : (lines.length + ' linha(s) em uso livre');
    log('  ✅ herança concluída · ' + sourceGroupName + ' · grupo=' + originTotalFrozen.toFixed(2) + 'GB · ' + suffix, 'ok');
    finalizarPostMove(cotaSuficiente);
  }


  function finalizarPostMove(cotaSuficiente) {
    const { destGroupId } = pendingMove;
    if (isCfg('colorir')) {
      if (cotaSuficiente) { saveStatus(destGroupId, 'ok'); colorirComRetentativa(destGroupId); }
      else                { saveStatus(destGroupId, 'error'); colorirVermelhoComRetentativa(destGroupId); }
    }
    if (isCfg('reload')) {
      sleep(CFG.DELAY_BEFORE_RELOAD).then(() => clickConsumoDados());
    }
    atualizarStatusUI(cotaSuficiente ? 'Concluído · aguardando próximo movimento…' : 'Concluído com erro · aguardando próximo…');
    resetPendingMove();
  }

  function logConclusao({ sourceGroupName, lines, quotaPerLine, quotaNeeded, destAvail, neededFromOrigin, gdUsado, gdNome, gdRemainder }) {
    const gdLinha = gdUsado
      ? '   • GD (' + gdNome + '): ' + gdRemainder.toFixed(2) + ' GB'
      : '   • GD: não utilizado';
    log('✅ concluído · ' + sourceGroupName + ' · ' + lines.length + '× ' + quotaPerLine + 'GB = ' + quotaNeeded + 'GB · destino ' + destAvail.toFixed(2) + 'GB · origem ' + neededFromOrigin.toFixed(2) + 'GB' + (gdUsado ? ' · GD ' + gdRemainder.toFixed(2) + 'GB' : ''), 'ok');
  }

  function resetPendingMove() {
    pendingMove = {
      active: false, sourceGroupId: null, sourceGroupName: null,
      destGroupId: null, lines: [], account: null,
    };
  }

  /* ─────────────────────────────────────────────────────────
   *  v9.1.0 — HELPERS PORTADOS DO UI2UI (loadView + cliques)
   *  Necessários pro modo pró-ativo (▶ INICIAR).
   * ───────────────────────────────────────────────────────── */
  const DP_BASE   = 'https://vivogestao.vivoempresas.com.br' + CFG.API_PATH;
  const STEP_MS   = 700;
  const VERMAIS_MAX = 20;
  const STEP = () => sleep(STEP_MS);

  function getUiSession() {
    if (session.sessionId) return { sessionId: session.sessionId, remoteHost: session.remoteHost || '', remoteIp: session.remoteIp || '', acessLogin: session.acessLogin || '' };
    // Fallback: tenta ler do performance/resource
    try {
      const u = performance.getEntriesByType('resource').map(e => e.name)
        .filter(x => x.includes('datapackconsumption') && x.includes('loadView')).pop();
      if (u) {
        const p = new URLSearchParams(u.split('?')[1] || '');
        const sid = p.get('sessionId');
        if (sid) return { sessionId: sid, remoteHost: p.get('remoteHost') || '', remoteIp: p.get('remoteIp') || '', acessLogin: p.get('acessLogin') || '' };
      }
    } catch (_) {}
    return null;
  }

  async function loadViewUI(sess) {
    isOwnRequest = true;
    try {
      const qsp = new URLSearchParams({ action: 'loadView', technology: '4G', startRow: '1', fetchSize: '2000', ...sess });
      const lv = await (await fetch(DP_BASE + '?' + qsp, { headers: { Accept: 'application/json' } })).json();
      const all = [];
      (function walk(n) {
        if (!n || typeof n !== 'object') return;
        if (n.id != null && n.name != null) all.push(n);
        for (const c of (Array.isArray(n) ? n : Object.values(n))) if (c && typeof c === 'object') walk(c);
      })(lv);
      // v9.7.1 — alimenta __moveGroupMap. Sem isso, handleMoveLines cai no
      // fallback "GRUPO <id>" e o R1 renomeia destino com nome fabricado.
      for (const g of all) pageWindow.__moveGroupMap[String(g.id)] = { name: g.name };
      return all;
    } catch (_) { return []; }
    finally { isOwnRequest = false; }
  }

  const ehGD_ui     = (g) => /(^|\s)GD\b|GD CONNECTA/i.test(g.name || '') && !/5G/i.test(g.name || '');
  const numerado_ui = (g) => /^\s*\d/.test(g.name || '');

  const qs  = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => !!(el && el.offsetParent !== null && !el.disabled);
  function clickEl(el) { if (!el) throw new Error('elemento nulo'); try { el.scrollIntoView({ block: 'center' }); } catch (e) {} el.click(); }
  function setCheck(el, val) { if (!el) return; if (el.checked !== val) el.click(); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); }

  function acharBotao(txt, opt) {
    opt = opt || {}; const alvo = norm(txt);
    let bs = qsa('button').filter(b => norm(b.textContent) === alvo && visivel(b));
    if (opt.purpura) { const rx = bs.filter(b => /purpura|text-purple/i.test(b.className || '')); if (rx.length) bs = rx; }
    return opt.primeiro ? (bs[0] || null) : (bs[bs.length - 1] || null);
  }

  async function waitFor(fn, { timeout = 12000, interval = 250 } = {}) {
    const t0 = Date.now();
    for (;;) { let v; try { v = fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() - t0 > timeout) throw new Error('timeout'); await sleep(interval); }
  }

  function ensureConsumo() { const icon = qs('span.icon-data-consumption-closed'); if (icon) { const a = icon.closest('a.anchor-context') || icon.closest('a'); if (a) a.click(); } }
  const acharRow = (id) => { const bt = qs('[id="' + id + '-btedit"]') || qs('[id="' + id + '-btremove"]'); return bt ? bt.closest('.row.table_visible_row') : null; };
  function colapsarGrupos() {
    qsa('input[id^="selectAll"]').forEach(sa => { const id = sa.id.replace('selectAll', ''); const row = acharRow(id), exp = row && row.querySelector('span.expander'); if (exp) try { exp.click(); } catch (e) {} });
  }
  function fecharModais() {
    qsa('ngb-modal-window, .modal.show, .modal.in, [role="dialog"]').forEach(m => { const x = m.querySelector('button.close, [aria-label="Close"]') || qsa('button', m).find(b => /cancelar|fechar/i.test(b.textContent || '')); if (x) try { x.click(); } catch (e) {} });
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch (e) {}
  }

  async function expandDetalhado(id, nome) {
    const bt = qs('[id="' + id + '-btedit"]') || qs('[id="' + id + '-btremove"]');
    if (!bt) { log('  ✗ EXPAND: btn [' + id + '-btedit] não achado no DOM', 'err'); return false; }
    const row = bt.closest('.row.table_visible_row');
    if (qs('#selectAll' + id)) { log('  · já expandido', 'ok'); return true; }
    const alvo = () => qs('#selectAll' + id) || acharBotao('Ver Linhas', { primeiro: true });

    const exp = row ? row.querySelector('span.expander') : null;
    if (exp) {
      try { clickEl(exp); } catch (e) {}
      try { await waitFor(alvo, { timeout: 8000, interval: 200 }); return true; }
      catch (e) { log('  ✗ expander não abriu em 8s', 'err'); }
    }
    // fallback: clica no card
    const card = row ? (qsa('div', row).find(d => /float:\s*left/i.test(d.getAttribute('style') || '') && norm(d.textContent) === norm(nome)) || row) : null;
    if (card) {
      try { clickEl(card); } catch (e) {}
      try { await waitFor(alvo, { timeout: 8000, interval: 200 }); return true; } catch (e) {}
    }
    return false;
  }

  async function carregarTodasLinhas() {
    const vl = acharBotao('Ver Linhas', { primeiro: true });
    if (vl) { clickEl(vl); await STEP(); }
    let n = 0;
    while (n < VERMAIS_MAX) { const vm = acharBotao('Ver mais linhas', { primeiro: true }); if (!vm) break; clickEl(vm); n++; await STEP(); }
    if (acharBotao('Ver mais linhas', { primeiro: true })) throw new Error('ainda há "Ver mais linhas" após ' + VERMAIS_MAX);
  }

  async function selecionarDestino(dstId) {
    for (let p = 0; p < 8; p++) {
      const lab = qs('label[for="rdgroup' + dstId + '"]');
      if (lab) { clickEl(lab); const rd = qs('#rdgroup' + dstId); if (rd) { try { rd.checked = true; rd.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } return true; }
      const next = qs('li.page-item:not(.disabled) a[aria-label="Next"]');
      if (!next) break;
      clickEl(next); await sleep(700);
      await waitFor(() => qs('label[for^="rdgroup"]'), { timeout: 8000 }).catch(() => {});
    }
    return false;
  }

  // Move via CLIQUES (source → dest). Só dispara — postMoveFlow lida com o resto.
  async function moverPorCliques(srcId, srcNome, dstId, dstNome) {
    log('  · expand "' + srcNome + '"…');
    colapsarGrupos();
    const okExp = await expandDetalhado(srcId, srcNome);
    if (!okExp) return { ok: false, motivo: 'não expandiu "' + srcNome + '"' };
    await STEP();
    log('  · carregando linhas…');
    await carregarTodasLinhas();
    const sa = qs('#selectAll' + srcId);
    if (!sa) return { ok: false, motivo: 'selectAll' + srcId + ' sumiu' };
    setCheck(sa, true);
    await STEP();
    const mv = await waitFor(() => acharBotao('Mover para outro grupo', { primeiro: true }), { timeout: 9000 }).catch(() => null);
    if (!mv) return { ok: false, motivo: '"Mover para outro grupo" não apareceu' };
    log('  · abrindo modal de move…');
    clickEl(mv);
    await waitFor(() => qs('label[for^="rdgroup"]'), { timeout: 15000 }).catch(() => {});
    await STEP();
    log('  · selecionando destino "' + dstNome + '"…');
    const okDst = await selecionarDestino(dstId);
    if (!okDst) return { ok: false, motivo: 'destino rdgroup' + dstId + ' não selecionável' };
    await STEP();
    const c1 = await waitFor(() => acharBotao('Mover Linhas', { purpura: true }), { timeout: 9000 }).catch(() => null);
    if (!c1) return { ok: false, motivo: '"Mover Linhas" não apareceu' };
    log('  · confirmando "Mover Linhas"…');
    clickEl(c1); await STEP();
    const c2 = await waitFor(() => acharBotao('Mover', { purpura: true }), { timeout: 10000 }).catch(() => null);
    if (!c2) return { ok: false, motivo: '"Mover" (final) não apareceu' };
    clickEl(c2);
    // O interceptador vai detectar o moveLines e disparar postMoveFlow — aguardamos.
    return { ok: true };
  }

  // v9.6.1 — Aguarda postMoveFlow COMEÇAR (active=true) e DEPOIS terminar (active=false)
  // Antes retornava true imediatamente se interceptor não disparasse — mascarava o bug.
  async function aguardarPostMove(timeoutMs = 90000) {
    const t0 = Date.now();
    let hasStarted = false;
    while (Date.now() - t0 < timeoutMs) {
      if (pendingMove.active) hasStarted = true;
      if (hasStarted && !pendingMove.active) return true;
      await sleep(400);
    }
    if (!hasStarted) {
      log('  ⚠ aguardarPostMove: pendingMove.active nunca ficou true — interceptor XHR/fetch NÃO disparou. Verifique @grant/unsafeWindow.', 'err');
    }
    return false;
  }

  // v9.2.0 — helpers de validação (portados do ui2ui)
  const activeLines = (g) => (g?.lines || []).filter(l => String(l.blockConsumptionStatus) !== '1');
  const msisdnOf    = (l) => String(l.lineNumber || l.msisdn || '').replace(/\D/g, '');

  // GATE 0 — antes do move: destino "GRUPO SEM LINHAS" precisa estar funcionalmente VAZIO
  // (ignora linhas históricas bcs='1'). Se tiver ativas, é resíduo de run anterior
  // que renomeio não concluiu → risco de MISTURA. Aborta.
  async function gateDestinoVazio(sess) {
    const all = await loadViewUI(sess);
    const semLinhas = all.filter(g => CFG.TARGET_DEST_PATTERN.test(g.name || ''));
    if (semLinhas.length === 0) return { ok: false, motivo: 'nenhum "GRUPO SEM LINHAS" encontrado — crie no portal' };
    if (semLinhas.length > 1) {
      const ids = semLinhas.map(g => g.id).join(', ');
      return { ok: false, motivo: 'existem ' + semLinhas.length + ' grupos "GRUPO SEM LINHAS" (ids: ' + ids + ') — renomeie/apague antes' };
    }
    const gd = semLinhas[0];
    const ativas = activeLines(gd);
    const historicas = (gd.lines || []).length - ativas.length;
    if (ativas.length > 0) {
      return { ok: false, motivo: '"GRUPO SEM LINHAS" (id ' + gd.id + ') tem ' + ativas.length + ' linha(s) ativa(s)' + (historicas ? ' + ' + historicas + ' histórica(s)' : '') + ' — RISCO DE MISTURA. Limpe antes' };
    }
    return { ok: true, destId: String(gd.id), destName: gd.name, historicas };
  }

  // GATE 1 — pós-move+renomeio: valida que os N MSISDNs esperados estão no
  // grupo que agora tem o nome antigo da origem, e que o novo "GRUPO SEM LINHAS"
  // (que era a origem) está vazio. Faz POLL — consistência eventual da Vivo.
  async function gatePosMove(sess, expectMsisdns, expectCount, nomeAntigoOrigem, timeout = 30000) {
    const t0 = Date.now();
    let resumo = '';
    while (Date.now() - t0 < timeout) {
      const all = await loadViewUI(sess);
      // Grupo destino: agora tem o nome antigo da origem (renomeado)
      const destinoRenomeado = all.find(g => (g.name || '').trim() === (nomeAntigoOrigem || '').trim());
      // Novo "GRUPO SEM LINHAS": era a origem, foi renomeada
      const novoVazio = all.filter(g => CFG.TARGET_DEST_PATTERN.test(g.name || ''));
      if (destinoRenomeado && novoVazio.length === 1) {
        const ativas = activeLines(destinoRenomeado);
        const vazio  = activeLines(novoVazio[0]);
        const historicas = (destinoRenomeado.lines || []).length - ativas.length;
        const have = new Set(ativas.map(msisdnOf).filter(Boolean));
        const faltam = [...expectMsisdns].filter(m => !have.has(m));
        const extras = [...have].filter(m => !expectMsisdns.has(m));
        // v9.7.0 — resumo expandido com históricas + msisdns concretos (primeiros 3)
        const faltamShort = faltam.slice(0, 3).join(',') + (faltam.length > 3 ? '…' : '');
        const extrasShort = extras.slice(0, 3).join(',') + (extras.length > 3 ? '…' : '');
        resumo = 'destino=' + ativas.length + '/' + expectCount + ' · faltam ' + faltam.length + (faltam.length ? '[' + faltamShort + ']' : '') + ' · extras ' + extras.length + (extras.length ? '[' + extrasShort + ']' : '') + ' · histórica(s)_destino ' + historicas + ' · novoVazio_ativas ' + vazio.length;
        if (faltam.length === 0 && extras.length === 0 && vazio.length === 0 && ativas.length === expectCount) {
          return { ok: true, resumo };
        }
      } else {
        resumo = 'aguardando renomeio · destinoRenomeado=' + !!destinoRenomeado + ' · novoVazio=' + novoVazio.length;
      }
      await sleep(2500);
    }
    return { ok: false, motivo: 'não confluiu em ' + Math.round(timeout / 1000) + 's (' + resumo + ')' };
  }

  /* v9.9.0 — validar (poll) pra roundtrip GD (portada do ui2ui):
     confirma que N MSISDNs esperados estão em expectGroupId E emptyGroupId
     está funcionalmente vazio (só ativas contam). */
  async function validarRoundtrip(sess, expectGroupId, expectMsisdns, expectCount, emptyGroupId, opt) {
    opt = opt || {};
    const timeout  = opt.timeout  || 45000;
    const interval = opt.interval || 2500;
    const t0 = Date.now();
    let resumo = '';
    while (Date.now() - t0 <= timeout) {
      const all = await loadViewUI(sess);
      const ge = all.find(x => String(x.id) === String(expectGroupId)) || {};
      const gv = all.find(x => String(x.id) === String(emptyGroupId))  || {};
      const geAtivas = activeLines(ge);
      const vazioN   = activeLines(gv).length;
      const have     = new Set(geAtivas.map(msisdnOf).filter(Boolean));
      const faltam   = [...expectMsisdns].filter(m => !have.has(m));
      const extras   = [...have].filter(m => !expectMsisdns.has(m));
      if (faltam.length === 0 && extras.length === 0 && vazioN === 0 && geAtivas.length === expectCount) {
        return { ok: true, count: geAtivas.length };
      }
      resumo = 'tem ' + geAtivas.length + '/' + expectCount + ' · faltam ' + faltam.length + ' · extras ' + extras.length + ' · vazio-alvo ainda com ' + vazioN;
      log('  … aguardando confluência: ' + resumo);
      await sleep(interval);
    }
    return { ok: false, motivo: 'não confluiu em ' + Math.round(timeout / 1000) + 's (' + resumo + ')' };
  }

  /* v9.10.0 — ROUNDTRIP ILIMITADO via "GRUPO SEM LINHAS" (não usa mais o GD)
     Naldo (19/07/26 13:09): simplificar — usar o GRUPO SEM LINHAS como
     área temporária, RESET+REAPPLY com origem vazia, depois devolver.
     Sem herança de nome/cota; o grupo original mantém identidade.

     Fluxo:
       0. GATE 0: GRUPO SEM LINHAS vazio? (reusa gateDestinoVazio)
       1. Congela cotaGrupoFrozen
       2. IDA origem → GRUPO SEM LINHAS (100% cliques UI, interceptor SKIP)
       3. Valida IDA
       4. RESET cota grupo origem → 0
       5. REAPPLY cota grupo origem → cotaGrupoFrozen
       6. VOLTA GRUPO SEM LINHAS → origem (100% cliques UI, interceptor SKIP)
       7. Valida VOLTA

     ATENÇÃO: interceptor pega move pra "GRUPO SEM LINHAS" e dispara
     postMoveFlow (herança 3-em-3). Setamos pendingMove.active=true como
     escudo pra bypass — o interceptor pula. Reset ao final. */
  async function roundtripIlimitado(sess, gid, nome) {
    fecharModais(); colapsarGrupos(); await sleep(600);

    // ── GATE 0: GRUPO SEM LINHAS existe e está vazio? ──
    const g0 = await gateDestinoVazio(sess);
    if (!g0.ok) return { halt: true, motivo: 'GATE 0 falhou — ' + g0.motivo };
    if (g0.historicas > 0) log('  · GRUPO SEM LINHAS tem ' + g0.historicas + ' histórica[s] (bcs=1) — ignoradas');
    const gslId = g0.destId, gslNome = g0.destName;

    // ── Origem: valida linhas ativas + congela cota ──
    log('  · lendo grupos (loadView)…');
    const all = await loadViewUI(sess);
    const g = all.find(x => String(x.id) === String(gid));
    if (!g) return { halt: true, motivo: 'grupo [' + gid + '] não encontrado no loadView' };
    const ativas = activeLines(g);
    const N = ativas.length;
    if (N === 0) return { skip: true, motivo: 'origem sem ativas' };
    const msisdnsOrigem = new Set(ativas.map(msisdnOf).filter(Boolean));
    if (msisdnsOrigem.size !== N) {
      return { halt: true, motivo: 'origem tem ' + N + ' ativas mas só ' + msisdnsOrigem.size + ' MSISDNs únicos — não dá pra validar por identidade' };
    }

    await fetchDestGroupQuota(gid);
    const cacheOrigem = groupQuotaCache[String(gid)] || {};
    const cotaGrupoFrozen = parseFloat(cacheOrigem.total) || 0;
    log('  · cotaGrupoFrozen=' + cotaGrupoFrozen.toFixed(2) + ' GB · GRUPO SEM LINHAS=' + gslNome + ' [' + gslId + ']');

    // ── ① IDA: origem → GRUPO SEM LINHAS (escudo: pendingMove.active=true) ──
    log('  ═══ ① IDA: "' + nome + '" → "' + gslNome + '" (' + N + ' linha[s]) ═══', 'hl');
    pendingMove.active = true; // bypass do interceptor postMoveFlow
    let ida;
    try {
      ida = await moverPorCliques(gid, nome, gslId, gslNome);
    } finally {
      resetPendingMove();
    }
    if (!ida.ok) return { halt: true, motivo: 'IDA falhou — ' + ida.motivo };

    // GATE 1: todas no GRUPO SEM LINHAS + origem vazia
    log('  · validando IDA (todas no "' + gslNome + '"? origem vazia?)…', 'hl');
    const v1 = await validarRoundtrip(sess, gslId, msisdnsOrigem, N, gid);
    if (!v1.ok) return { halt: true, motivo: 'IDA incompleta — ' + v1.motivo };
    log('  ✓ IDA validada: ' + N + ' no "' + gslNome + '", origem vazia', 'ok');

    // ── ② RESET + REAPPLY cota do grupo origem (origem vazia) ──
    let reapplyOk = true;
    if (cotaGrupoFrozen > 0) {
      log('  · RESET · zerando cota do grupo origem [' + gid + ']…');
      const rz = await trySetGroupQuota(gid, nome, 0);
      if (rz.ok) log('  ✓ cota do grupo zerada', 'ok');
      else       log('  ⚠ RESET não confirmado · sev=' + (rz.json?.severity || '?') + ' · result=' + (rz.json?.result || ''), 'err');
      await sleep(1500);

      log('  · REAPLICANDO ' + cotaGrupoFrozen.toFixed(2) + ' GB no grupo origem [' + gid + ']…');
      const rp = await trySetGroupQuota(gid, nome, cotaGrupoFrozen);
      if (rp.ok) {
        log('  ✓ cota do grupo reaplicada · sev=' + (rp.json?.severity || 'ok'), 'ok');
      } else {
        reapplyOk = false;
        log('  ⛔ REAPLICAÇÃO FALHOU · sev=' + (rp.json?.severity || '?') + ' · result=' + (rp.json?.result || '') + ' — VOLTA ainda roda (linhas voltam), mas cota fica em 0. Corrija manual pelo portal Vivo (Editar grupo → ' + cotaGrupoFrozen.toFixed(2) + 'GB).', 'err');
      }
      await sleep(1000);
    } else {
      log('  ⏭ RESET/REAPLICAÇÃO pulados · cotaGrupoFrozen=0');
    }

    // ── ③ VOLTA: GRUPO SEM LINHAS → origem (escudo: pendingMove.active=true) ──
    // Sempre roda, mesmo se REAPPLY falhou (garante linhas na origem).
    fecharModais(); colapsarGrupos(); await sleep(600);
    log('  ═══ ③ VOLTA: "' + gslNome + '" → "' + nome + '" ═══', 'hl');
    pendingMove.active = true;
    let volta;
    try {
      volta = await moverPorCliques(gslId, gslNome, gid, nome);
    } finally {
      resetPendingMove();
    }
    if (!volta.ok) return { halt: true, motivo: 'VOLTA falhou — ' + volta.motivo + ' (linhas ficaram no "' + gslNome + '"!)' };

    // GATE 2: todas de volta na origem + GRUPO SEM LINHAS vazio
    log('  · validando VOLTA (todas de volta na origem? "' + gslNome + '" vazio?)…', 'hl');
    const v2 = await validarRoundtrip(sess, gid, msisdnsOrigem, N, gslId);
    if (!v2.ok) return { halt: true, motivo: 'VOLTA incompleta — ' + v2.motivo };
    log('  ✓ CONCILIAÇÃO: ' + N + ' de volta em "' + nome + '", "' + gslNome + '" vazio', 'ok');

    return { ok: reapplyOk, N, cotaGrupoFrozen, motivo: reapplyOk ? null : 'linhas OK (voltaram), cota do grupo NÃO foi reaplicada (ficou 0)' };
  }

  /* ─────────────────────────────────────────────────────────
   *  v9.1.0 — SOM DE FIM (Web Audio, mesmo do ui2ui)
   * ───────────────────────────────────────────────────────── */
  function tocarSomFim(ok) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const VOL = 0.6;
      const tocarTom = (freq, tStart, dur, tipo) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tipo || 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + tStart);
        gain.gain.exponentialRampToValueAtTime(VOL, ctx.currentTime + tStart + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + tStart + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + tStart);
        osc.stop(ctx.currentTime + tStart + dur + 0.05);
      };
      if (ok) {
        [[523.25,0,.18],[659.25,.15,.18],[783.99,.30,.18],[1046.5,.45,.35],[1318.5,.75,.35],[1567.9,1.05,.55]]
          .forEach(([f,t,d]) => { tocarTom(f,t,d,'triangle'); tocarTom(f/2,t,d,'sine'); });
      } else {
        for (let i = 0; i < 3; i++) { const t0 = i * 0.45; tocarTom(440, t0, .20, 'square'); tocarTom(330, t0 + .22, .20, 'square'); }
      }
      setTimeout(() => { try { ctx.close(); } catch (e) {} }, 2200);
    } catch (e) {}
  }

  /* ─────────────────────────────────────────────────────────
   *  v9.1.0 — LISTA DE GRUPOS + EXECUÇÃO EM LOTE
   * ───────────────────────────────────────────────────────── */
  let gruposCache   = [];
  let contaCarregada = null;  // v9.8.0 — conta cujos grupos estão no gruposCache
  let executando    = false;

  // v9.8.0 — invalida lista quando conta ativa muda vs a que carregou a lista
  function limparListaComAviso(listEl, motivoHtml) {
    gruposCache = [];
    contaCarregada = null;
    if (listEl) listEl.innerHTML = '<div class="mlq-g" style="color:#dc2626">' + motivoHtml + '</div>';
  }

  async function montarLista(listEl) {
    listEl.innerHTML = '<div class="mlq-g" style="color:#94a3b8">carregando grupos…</div>';
    try {
      const sess = getUiSession();
      if (!sess) { listEl.innerHTML = '<div class="mlq-g" style="color:#dc2626">sessão não encontrada — recarregue logado</div>'; return; }
      const contaAtual = obterContaAtiva();
      const all = await loadViewUI(sess);
      gruposCache = all
        .filter(g => numerado_ui(g) && !ehGD_ui(g) && !CFG.TARGET_DEST_PATTERN.test(g.name || ''))
        .map(g => ({ id: String(g.id), name: g.name, n: (g.lines || []).length }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt', { numeric: true }));
      contaCarregada = contaAtual;
      if (!gruposCache.length) { listEl.innerHTML = '<div class="mlq-g">nenhum grupo numerado</div>'; return; }
      listEl.innerHTML = '';
      for (const g of gruposCache) {
        const row = document.createElement('label');
        row.className = 'mlq-g';
        row.innerHTML = `<input type="checkbox" class="mlq-cb" value="${g.id}" checked><span class="nm"></span><span class="id">${g.id}</span><span class="ct">${g.n ? g.n + ' linha(s)' : 'vazio'}</span>`;
        row.querySelector('.nm').textContent = g.name;
        listEl.appendChild(row);
      }
      log('lista carregada · ' + gruposCache.length + ' grupo(s)' + (contaCarregada ? ' · conta ' + contaCarregada : ''), 'hl');
    } catch (e) {
      listEl.innerHTML = '<div class="mlq-g" style="color:#dc2626">erro: ' + (e && e.message || e) + '</div>';
    }
  }

  // v9.8.0 — polling leve pra detectar troca de conta enquanto o painel está aberto.
  // Só limpa a lista se JÁ havia grupos carregados (contaCarregada != null) e a conta mudou.
  // NÃO faz reload automático (Naldo faz F5 manual pra garantir sessão limpa).
  function iniciarWatchdogConta() {
    setInterval(() => {
      if (executando) return; // não interfere durante batch
      if (!contaCarregada) return; // nada pra invalidar
      const atual = obterContaAtiva();
      if (atual && atual !== contaCarregada) {
        const listEl = document.getElementById('mlq-list');
        log('⚠ conta mudou · lista era da ' + contaCarregada + ', agora ' + atual + ' — pressione F5 e recarregue', 'err');
        limparListaComAviso(listEl, '⚠ conta mudou (' + contaCarregada + ' → ' + atual + ')<br>Pressione <b>F5</b> pra sincronizar, depois clique em <b>Carregar</b>.');
      }
    }, 3000);
  }

  function setProgresso(feitos, total, nomeAtual) {
    const p = document.getElementById('mlq-progress');
    if (!p) return;
    const pct = total > 0 ? Math.round(feitos / total * 100) : 0;
    p.classList.remove('hidden');
    p.querySelector('.mlq-pg-count b').textContent = feitos;
    p.querySelector('.mlq-pg-total').textContent = total;
    p.querySelector('.mlq-pg-pct').textContent = pct + '%';
    p.querySelector('.mlq-pg-fill').style.width = pct + '%';
    p.querySelector('.mlq-pg-atual').textContent = nomeAtual || (feitos === total ? 'Concluído.' : 'Aguardando…');
  }

  async function executarLote() {
    if (executando) return;
    const marcados = qsa('#mlq-list .mlq-cb:checked').map(c => c.value);
    if (!marcados.length) { log('marque ao menos 1 grupo.', 'err'); return; }
    const sess = getUiSession();
    if (!sess) { log('sessão não encontrada — recarregue logado.', 'err'); return; }
    // v9.8.0 — trava anti-mistura: conta ativa precisa bater com a que carregou a lista
    const contaAtual = obterContaAtiva();
    if (contaCarregada && contaAtual && contaAtual !== contaCarregada) {
      log('⛔ conta mudou · lista era da ' + contaCarregada + ', agora ' + contaAtual + '. Pressione F5 e recarregue antes de rodar.', 'err');
      return;
    }

    executando = true;
    const goBtn = document.getElementById('mlq-go');
    if (goBtn) { goBtn.disabled = true; goBtn.textContent = 'rodando…'; }
    let ok = 0, fail = 0, parou = false;
    const total = marcados.length;

    // v9.7.1 — blindagem: garante que __moveGroupMap conhece TODOS os
    // grupos numerados (evita fallback "GRUPO <id>" no handleMoveLines).
    for (const g of gruposCache) pageWindow.__moveGroupMap[String(g.id)] = { name: g.name };

    // v9.6.0 — gravação na planilha (início + fim), padrão ui2ui
    const gravarLog = isCfg('gravarPlanilha');
    const logConta  = gravarLog ? obterContaAtiva() : null;
    const logAba    = logConta ? (abasPorConta[logConta] || null) : null;
    const tsInicio  = Date.now();
    if (gravarLog) {
      if (logConta && logAba) {
        log('📝 planilha: conta ' + logConta + ' · aba "' + logAba + '" · registrando início…');
        gravarLogNaPlanilha(logConta, logAba, 'Renovando...', 'Iniciada às ' + hhmm() + ' · ' + total + ' grupo(s)')
          .then(r => log(r && r.success ? '✓ planilha: início registrado' : '⚠ planilha (início): ' + (r && r.error || 'falha'), r && r.success ? 'ok' : 'err'));
      } else if (!logConta) log('⚠ planilha: conta ativa não detectada — logs NÃO serão gravados.', 'err');
      else                  log('⚠ planilha: conta ' + logConta + ' sem mapeamento de aba — logs NÃO serão gravados.', 'err');
    }

    log('═══════ INICIANDO · ' + total + ' grupo(s) → "GRUPO SEM LINHAS" (isolamento anti-mistura) ═══════', 'hl');
    setProgresso(0, total, 'Iniciando…');

    for (let i = 0; i < marcados.length; i++) {
      if (parou) break;
      const gid = marcados[i];
      const g   = gruposCache.find(x => x.id === gid);
      const nome = g ? g.name : gid;
      setProgresso(i, total, 'Processando: ' + nome);
      log('▶ ' + nome + ' [' + gid + ']', 'hl');

      try {
        // v9.9.0 — ILIMITADO: usa roundtrip GD (fluxo ui2ui), NÃO passa pelo "GRUPO SEM LINHAS"
        if (isIlimitado(nome)) {
          log('  · rota ILIMITADO → roundtrip GD (fluxo ui2ui, 100% UI)');
          const rt = await roundtripIlimitado(sess, gid, nome);
          if (rt.skip) {
            log('  ↷ ' + rt.motivo + ' — pulando');
            setProgresso(i + 1, total, 'Próximo…');
            fecharModais(); colapsarGrupos(); await sleep(1200);
            continue;
          }
          if (rt.halt) {
            fail++;
            log('  ⛔ roundtrip ilimitado falhou — ' + rt.motivo, 'err');
            log('═══════ ⛔ INTERROMPIDO em "' + nome + '" — ' + ok + ' ok antes. Verifique manualmente antes de rodar de novo. ═══════', 'err');
            parou = true;
            break;
          }
          // v9.9.4: linhas voltaram OK, mas REAPPLY pode ter falhado — conta como fail
          // mas SEGUE o batch (não é halt, as linhas estão seguras na origem).
          if (rt.ok === false) {
            fail++;
            log('  ⚠ ilimitado PARCIAL · ' + rt.N + ' linha(s) OK, ' + rt.motivo, 'err');
            log('  ⚠ AÇÃO NECESSÁRIA: abra o portal Vivo, edite o grupo "' + nome + '" e defina cota=' + (rt.cotaGrupoFrozen || 0).toFixed(2) + 'GB', 'err');
          } else {
            ok++;
            log('  ✅ ilimitado concluído · ' + rt.N + ' linha(s) · cota grupo=' + (rt.cotaGrupoFrozen || 0).toFixed(2) + 'GB reaplicada · round-trip validado', 'ok');
          }
          setProgresso(i + 1, total, i + 1 === total ? 'Concluído.' : 'Próximo…');
          fecharModais(); colapsarGrupos(); await sleep(1200);
          continue;
        }

        // ── NORMAL: fluxo herança 3-em-3 via "GRUPO SEM LINHAS" ──
        // ── GATE 0 (pré-move): destino "GRUPO SEM LINHAS" está vazio? ──
        log('  · GATE 0: validando "GRUPO SEM LINHAS" vazio…');
        const g0 = await gateDestinoVazio(sess);
        if (!g0.ok) {
          fail++;
          log('  ⛔ GATE 0 falhou — ' + g0.motivo, 'err');
          log('═══════ ⛔ INTERROMPIDO em "' + nome + '" — ' + ok + ' ok antes. Corrija e rode de novo. ═══════', 'err');
          parou = true;
          break;
        }
        if (g0.historicas > 0) log('    (' + g0.historicas + ' histórica[s] no destino — ignoradas)');
        const destId = g0.destId, destName = g0.destName;

        // ── Captura o conjunto esperado de MSISDNs da origem (pré-move) ──
        const allPre = await loadViewUI(sess);
        const origemPre = allPre.find(x => String(x.id) === String(gid));
        if (!origemPre) { fail++; log('  ⛔ origem [' + gid + '] não encontrada no loadView', 'err'); parou = true; break; }
        const ativasPre = activeLines(origemPre);
        const N = ativasPre.length;
        if (N === 0) {
          log('  ↷ origem sem linhas ativas — pulando');
          setProgresso(i + 1, total, 'Próximo…');
          continue;
        }
        const msisdnsEsperados = new Set(ativasPre.map(msisdnOf).filter(Boolean));
        if (msisdnsEsperados.size !== N) {
          fail++;
          log('  ⛔ origem tem ' + N + ' ativas mas só ' + msisdnsEsperados.size + ' MSISDNs únicos — não dá pra validar por identidade', 'err');
          parou = true;
          break;
        }
        log('  · ' + N + ' linha(s) esperada(s) · destino "' + destName + '" [' + destId + ']');

        // ── MOVE via cliques ──
        const r = await moverPorCliques(gid, nome, destId, destName);
        if (!r.ok) {
          fail++;
          log('  ⛔ move falhou — ' + r.motivo, 'err');
          log('═══════ ⛔ INTERROMPIDO — ' + ok + ' ok antes. ═══════', 'err');
          parou = true;
          break;
        }
        log('  ✓ move disparado — aguardando renomeio+cota…');

        // ── Aguarda postMoveFlow (renomeio + cota) ──
        const finalizou = await aguardarPostMove(90000);
        if (!finalizou) {
          fail++;
          log('  ⛔ timeout no postMoveFlow (90s)', 'err');
          log('═══════ ⛔ INTERROMPIDO — ' + ok + ' ok antes. ═══════', 'err');
          parou = true;
          break;
        }

        // ── GATE 1 (pós): valida que os N MSISDNs foram parar no destino
        //    renomeado, e que o novo "GRUPO SEM LINHAS" está vazio ──
        log('  · GATE 1: validando linhas no destino + novo vazio…');
        const g1 = await gatePosMove(sess, msisdnsEsperados, N, nome);
        if (!g1.ok) {
          fail++;
          log('  ⛔ GATE 1 falhou — ' + g1.motivo, 'err');
          log('═══════ ⛔ INTERROMPIDO em "' + nome + '" — ' + ok + ' ok antes. Verifique manualmente antes de rodar de novo. ═══════', 'err');
          parou = true;
          break;
        }
        ok++;
        log('  ✅ concluído · ' + N + ' linha(s) · GATE 1 ok · ' + (g1.resumo || ''), 'ok');
      } catch (e) {
        fail++;
        log('  ⛔ erro inesperado: ' + (e && e.message || e), 'err');
        parou = true;
      }
      setProgresso(i + 1, total, i + 1 === total ? 'Concluído.' : 'Próximo…');
      fecharModais();
      colapsarGrupos();
      await sleep(1200);
    }

    log('═══════ fim · ' + ok + ' ok · ' + fail + ' falha' + (parou ? ' · INTERROMPIDO' : '') + ' ═══════', parou ? 'err' : 'hl');
    setProgresso(total, total, parou ? 'Interrompido' : 'Concluído.');

    // v9.6.0 — gravação final na planilha (sobrescreve o "Renovando...")
    if (gravarLog && logConta && logAba) {
      const dur         = durStr(Date.now() - tsInicio);
      const statusFinal = (parou || fail > 0) ? 'Falha' : 'OK';
      const obsFinal    = statusFinal + ': ' + ok + '/' + total + ' | ' + hhmm() + ' — duração (' + dur + ')';
      gravarLogNaPlanilha(logConta, logAba, statusFinal, obsFinal)
        .then(r => log(r && r.success ? '✓ planilha: resultado final registrado (' + statusFinal + ')' : '⚠ planilha (fim): ' + (r && r.error || 'falha'), r && r.success ? 'ok' : 'err'));
    }

    executando = false;
    if (goBtn) { goBtn.disabled = false; goBtn.textContent = '▶ INICIAR'; }
    tocarSomFim(!parou && fail === 0);
  }

  /* ─────────────────────────────────────────────────────────
   *  CHAMADAS DE API (preservadas)
   * ───────────────────────────────────────────────────────── */
  async function renameGroup(groupId, newName) {
    isOwnRequest = true;
    const base = {
      action: 'edit', id: groupId, name: newName,
      sessionId:  session.sessionId,
      remoteHost: session.remoteHost,
      remoteIp:   session.remoteIp,
      acessLogin: session.acessLogin,
    };
    try {
      const [resVoice, resData] = await Promise.all([
        fetch(CFG.API_GROUP, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            ...base,
            isData: false, isVoice: true,
            contextVoice: true, hasOverBalanceMonetaryVoice: true,
          }),
        }),
        fetch(CFG.API_GROUP, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            ...base,
            isData: true, isVoice: false, contextVoice: false,
          }),
        }),
      ]);
      const [jsonVoice, jsonData] = await Promise.all([
        resVoice.json().catch(() => ({})),
        resData.json().catch(() => ({})),
      ]);
      const ok = jsonData.severity === 'info' || jsonVoice.severity === 'info';
      // v9.3.0 — log detalhado
      log('  [DBG] renameGroup · id=' + groupId + ' → "' + newName + '" · voice.sev=' + (jsonVoice.severity || '?') + ' · data.sev=' + (jsonData.severity || '?'), 'dbg');
      if (!ok) throw new Error(`renameGroup falhou: voice.sev=${jsonVoice.severity || 'x'} · data.sev=${jsonData.severity || 'x'}`);
      return true;
    } finally {
      isOwnRequest = false;
    }
  }

  async function trySetGroupQuota(groupId, groupName, quotaValue) {
    isOwnRequest = true;
    const payload = {
      action: 'edit', id: groupId, name: groupName,
      isData: true, contextVoice: false, is5GPortifolio: 0,
      quota:  { value: String(quotaValue), dataPackValueType: 'GB' },
      limit:  { dataPackValueType: 'MIN' },
      manager: { login: '' },
      overBalanceAllCallsLimit:                 { dataPackValueType: 'MIN' },
      overBalanceAllCallsLimitNextCycleControll: { dataPackValueType: 'MIN' },
      overBalanceLimit:                         { dataPackValueType: 'R$'  },
      overBalanceLimitNextCycleControll:        { dataPackValueType: 'R$'  },
      overBalanceLocalsLimit:                   { dataPackValueType: 'MIN' },
      overBalanceLocalsLimitNextCycleControll:  { dataPackValueType: 'MIN' },
      technology: '4G',
      sessionId:  session.sessionId,
      remoteHost: session.remoteHost,
      remoteIp:   session.remoteIp,
      acessLogin: session.acessLogin,
    };
    try {
      const res  = await fetch(CFG.API_GROUP, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      const ok   = !json.severity || json.severity === 'info';
      // v9.3.0 — log detalhado
      log('  [DBG] setGroupQuota · id=' + groupId + ' · nome="' + groupName + '" · qty=' + quotaValue + 'GB · HTTP ' + res.status + ' · sev=' + (json.severity || '(none)') + (json.result ? ' · result=' + String(json.result).slice(0, 150) : ''), 'dbg');
      return { ok, json };
    } catch (err) {
      log('  [DBG] setGroupQuota · exceção: ' + err.message, 'err');
      return { ok: false, json: { error: err.message } };
    } finally {
      isOwnRequest = false;
    }
  }

  async function applyQuotaToLines(destGroupId, quotaPerLine, lines) {
    isOwnRequest = true;
    const defaultAccount = pendingMove.account || '';

    // v9.6.0 — quotaPerLine === null → sinal de "uso livre" (payload sem quota/futureQuota)
    const semCotaIndividual = (quotaPerLine === null || quotaPerLine === undefined);
    const linesPayload = lines.map(line => {
      const base = {
        account:    line.account    || defaultAccount,
        lineNumber: line.lineNumber || line.msisdn || line.numero || '',
        userName:   line.userName   || line.name   || '',
        notifyManagerGroup: false,
      };
      if (!semCotaIndividual) {
        base.quota       = { value: String(quotaPerLine), dataPackValueType: 'GB' };
        base.futureQuota = { value: String(quotaPerLine), dataPackValueType: 'GB' };
      }
      return base;
    });

    const payload = {
      action:      'saveLines',
      acessLogin:  session.acessLogin,
      sourceGroup: { id: destGroupId },
      lines:       linesPayload,
      remoteHost:  session.remoteHost,
      remoteIp:    session.remoteIp,
      sessionId:   session.sessionId,
    };

    try {
      const res = await fetch(`https://vivogestao.vivoempresas.com.br${CFG.API_PATH}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      const ok   = !json.severity || json.severity === 'info';
      // v9.3.0 — log detalhado da response
      log('  [DBG] saveLines · status=' + res.status + ' · sev=' + (json.severity || '(none)') + (json.result ? ' · result=' + String(json.result).slice(0, 150) : ''), 'dbg');
      return { ok, json };
    } catch (err) {
      log('  [DBG] saveLines · exceção: ' + err.message, 'err');
      return { ok: false, json: { error: err.message } };
    } finally {
      isOwnRequest = false;
    }
  }

  function clickConsumoDados() {
    const span = document.querySelector('span.icon-data-consumption-closed');
    if (span) {
      const link = span.closest('a.anchor-context') || span.parentElement;
      if (link) { link.click(); return; }
    }
    document.querySelectorAll('a.anchor-context').forEach(a => {
      if (/consumo\s+de\s+dados/i.test(a.textContent)) a.click();
    });
  }

  /* ─────────────────────────────────────────────────────────
   *  COLORAÇÃO (preservada)
   * ───────────────────────────────────────────────────────── */
  function saveStatus(id, status) {
    try {
      const c = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      c[String(id)] = { timestamp: Date.now(), status };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    } catch (_) {}
  }

  function getRowId(row) {
    try {
      const b = row.querySelector('[id$="-btedit"]');
      return b ? b.id.replace('-btedit', '') : null;
    } catch (_) { return null; }
  }

  function colorirRow(row) {
    if (!row || row.dataset.ccOk === '1') return;
    row.dataset.ccOk = '1';
    row.style.setProperty('background-color', '#d4edda', 'important');
  }

  function colorirPorId(gId) {
    const strId = String(gId);
    const btn   = document.querySelector(`[id="${strId}-btedit"]`);
    if (btn) {
      const row = btn.closest(ROW_SEL);
      if (row) { colorirRow(row); return true; }
    }
    for (const row of document.querySelectorAll(ROW_SEL)) {
      if (getRowId(row) === strId) { colorirRow(row); return true; }
    }
    return false;
  }

  function colorirComRetentativa(gId, timeoutMs = 8000) {
    if (colorirPorId(gId)) return;
    let done = false;
    const obs = new MutationObserver(() => {
      if (done) return;
      if (colorirPorId(gId)) { done = true; obs.disconnect(); clearTimeout(tOut); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const tOut = setTimeout(() => {
      if (!done) { done = true; obs.disconnect(); restoreColors(); }
    }, timeoutMs);
  }

  function colorirRowVermelho(row) {
    if (!row) return;
    row.dataset.ccOk = 'error';
    row.style.setProperty('background-color', '#ffcfc9', 'important');
  }

  function colorirVermelhoPorId(gId) {
    const strId = String(gId);
    const btn   = document.querySelector(`[id="${strId}-btedit"]`);
    if (btn) {
      const row = btn.closest(ROW_SEL);
      if (row) { colorirRowVermelho(row); return true; }
    }
    for (const row of document.querySelectorAll(ROW_SEL)) {
      if (getRowId(row) === strId) { colorirRowVermelho(row); return true; }
    }
    return false;
  }

  function colorirVermelhoComRetentativa(gId, timeoutMs = 8000) {
    if (colorirVermelhoPorId(gId)) return;
    let done = false;
    const obs = new MutationObserver(() => {
      if (done) return;
      if (colorirVermelhoPorId(gId)) { done = true; obs.disconnect(); clearTimeout(tOut); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const tOut = setTimeout(() => {
      if (!done) { done = true; obs.disconnect(); }
    }, timeoutMs);
  }

  function restoreColors() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      let dirty = false;
      for (const id of Object.keys(c)) {
        if (Date.now() - c[id].timestamp > EXPIRY_MS) { delete c[id]; dirty = true; continue; }
        const btn = document.querySelector(`[id="${id}-btedit"]`);
        if (!btn) continue;
        const row = btn.closest(ROW_SEL);
        if (!row) continue;
        const status = c[id].status ?? 'ok';
        if (status === 'error' && row.dataset.ccOk !== 'error') colorirRowVermelho(row);
        else if (status === 'ok'  && row.dataset.ccOk !== '1')   colorirRow(row);
      }
      if (dirty) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    } catch (_) {}
  }

  /* ─────────────────────────────────────────────────────────
   *  INTERCEPTAÇÃO XHR (v9.6.1 — via pageWindow/unsafeWindow)
   * ───────────────────────────────────────────────────────── */
  const _XHR = pageWindow.XMLHttpRequest;
  pageWindow.XMLHttpRequest = function () {
    const xhr  = new _XHR();
    const self = this;
    let _method = '', _url = '';

    self.open = function (method, url, ...rest) {
      _method = method.toUpperCase();
      _url    = url;
      return xhr.open(method, url, ...rest);
    };

    self.send = function (body) {
      if (!isOwnRequest && _method === 'POST' && _url.includes(CFG.API_PATH) && body) {
        try {
          const parsed = typeof body === 'string' ? JSON.parse(body) : body;
          if (parsed.action === 'listLines' && parsed.group?.id && parsed.group?.name) {
            pageWindow.__moveGroupMap[String(parsed.group.id)] = { name: parsed.group.name };
            saveQuotaCache(parsed.group.id, parsed.group.quota?.value, parsed.group.quotaConsume?.value);
          }
          if (isTargetMove(parsed)) handleMoveLines(parsed);
        } catch (_) {}
      }

      xhr.addEventListener('load', () => {
        captureGroupMap(xhr.responseText || '');
        if (_method === 'GET' && _url.includes(CFG.API_PATH) && _url.includes('loadView')) {
          pageWindow.__loadViewListeners.slice().forEach(fn => { try { fn(); } catch (_) {} });
        }
      });

      return xhr.send(body);
    };

    ['setRequestHeader','getResponseHeader','getAllResponseHeaders',
     'abort','overrideMimeType','addEventListener','removeEventListener','dispatchEvent',
    ].forEach(p => { if (typeof xhr[p] === 'function') self[p] = xhr[p].bind(xhr); });

    ['onreadystatechange','onload','onerror','onprogress','onabort','ontimeout',
     'onloadstart','onloadend','readyState','response','responseText','responseType',
     'responseURL','responseXML','status','statusText','timeout','upload','withCredentials',
    ].forEach(p => Object.defineProperty(self, p, {
      get() { return xhr[p]; },
      set(v) { xhr[p] = v; },
      enumerable: true, configurable: true,
    }));

    return self;
  };

  /* ─────────────────────────────────────────────────────────
   *  INTERCEPTAÇÃO fetch (v9.6.1 — via pageWindow/unsafeWindow)
   * ───────────────────────────────────────────────────────── */
  const _fetch = pageWindow.fetch.bind(pageWindow);
  pageWindow.fetch = async function (input, init = {}) {
    const url    = typeof input === 'string' ? input : (input?.url || '');
    const method = (init.method || (typeof input === 'object' ? input.method : '') || 'GET').toUpperCase();

    if (!isOwnRequest && method === 'POST' && url.includes(CFG.API_PATH) && init.body) {
      try {
        const parsed = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        if (parsed.action === 'listLines' && parsed.group?.id && parsed.group?.name) {
          pageWindow.__moveGroupMap[String(parsed.group.id)] = { name: parsed.group.name };
          saveQuotaCache(parsed.group.id, parsed.group.quota?.value, parsed.group.quotaConsume?.value);
        }
        if (isTargetMove(parsed)) handleMoveLines(parsed);
      } catch (_) {}
    }

    const response = await _fetch(input, init);

    if (url.includes(CFG.API_PATH)) {
      response.clone().text().then(t => {
        captureGroupMap(t);
        if (method === 'GET' && url.includes('loadView')) {
          pageWindow.__loadViewListeners.slice().forEach(fn => { try { fn(); } catch (_) {} });
        }
      }).catch(() => {});
    }

    return response;
  };

  /* ─────────────────────────────────────────────────────────
   *  OBSERVER ANGULAR (preservado)
   * ───────────────────────────────────────────────────────── */
  function observeAngular() {
    const obs = new MutationObserver(() => {
      if (isCfg('colorir')) restoreColors();

      const mc = document.querySelector('moveconsume');
      if (!mc) return;

      mc.querySelectorAll('input[type="radio"][id^="rdgroup"]').forEach(radio => {
        const gId   = radio.id.replace('rdgroup', '');
        const label = mc.querySelector(`label[for="${radio.id}"]`);
        const name  = label ? label.textContent.replace(/⚡.*$/, '').trim() : '';
        if (gId && name) {
          pageWindow.__moveGroupMap[gId] = { name };
        }
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function setupLogoutDetection() {
    const obs = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (/sessão expirou|session expired|sessão expirada/i.test(node.textContent || ''))
            pageWindow.__moveGroupMap = {};
          const btn = node.querySelector?.('[href*="logout"],[href*="sair"],[onclick*="logout"]');
          if (btn && !btn._vgLogout) {
            btn._vgLogout = true;
            btn.addEventListener('click', () => { pageWindow.__moveGroupMap = {}; }, true);
          }
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    let _lastUrl = location.href;
    setInterval(() => {
      const cur = location.href;
      if (cur !== _lastUrl) {
        _lastUrl = cur;
        if (/login|logout|sign.*out|session.*expired|acesso/i.test(cur))
          pageWindow.__moveGroupMap = {};
      }
    }, 2000);
  }

  /* ─────────────────────────────────────────────────────────
   *  v9.0.0 — UI SIDEBAR (esquerda · padrão ConectaChip)
   * ───────────────────────────────────────────────────────── */
  const CC_LARGURA = 340;
  const CSS = `
    /* Paleta ConectaChip · espelhada à ESQUERDA (evita colidir com vivo-renova à direita) */
    body.mlq-aberto { margin-left: ${CC_LARGURA}px !important; transition: margin-left .3s ease; }

    /* Tab de restaurar (esquerda) — padrão ui2ui (compacto · seta acima · texto vertical) */
    #mlq-tab { position: fixed; top: 50%; left: 0; transform: translateY(-50%); z-index: 2147483640;
      background: #2157d9; color: #fff; border: none; border-radius: 0 10px 10px 0;
      padding: 14px 8px; cursor: pointer; box-shadow: 2px 0 10px rgba(0,0,0,.2);
      font: 700 11px/1 -apple-system, Segoe UI, Roboto, sans-serif;
      writing-mode: vertical-rl; display: none;
    }
    body:not(.mlq-aberto) #mlq-tab { display: inline-block; }
    #mlq-tab:hover { background: #1A46B0; }

    #mlq-panel { position: fixed; top: 0; left: 0; width: ${CC_LARGURA}px; height: 100vh; z-index: 2147483641;
      background: #FAFAFA; border-right: 1px solid #E5E7EB; box-shadow: 6px 0 24px rgba(0,0,0,.08);
      display: flex; flex-direction: column;
      font: 13px/1.45 -apple-system, "Segoe UI", Roboto, "Inter", sans-serif; color: #111827;
      transition: transform .3s ease;
    }
    body:not(.mlq-aberto) #mlq-panel { transform: translateX(-100%); }
    #mlq-panel * { box-sizing: border-box; }

    #mlq-hd { padding: 14px 16px 12px; background: #2157d9; color: #fff; position: relative; flex-shrink: 0; }
    #mlq-hd h3 { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: .2px; }
    #mlq-hd .sub { font-size: 11px; opacity: .88; margin-top: 3px; }
    #mlq-close { position: absolute; top: 10px; right: 12px; background: rgba(255,255,255,.15); border: none;
      color: #fff; width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 15px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
    }
    #mlq-close:hover { background: rgba(255,255,255,.28); }

    #mlq-cfg { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px 6px; font-size: 12.5px; flex-shrink: 0;
      background: #fff; border-bottom: 1px solid #E5E7EB;
    }
    #mlq-cfg label.cb { display: flex; align-items: center; gap: 10px; color: #374151; cursor: pointer; user-select: none; }
    #mlq-cfg label.cb input[type=checkbox] {
      -webkit-appearance: checkbox !important; -moz-appearance: checkbox !important; appearance: checkbox !important;
      width: 16px !important; height: 16px !important;
      opacity: 1 !important; visibility: visible !important; display: inline-block !important;
      position: static !important; pointer-events: auto !important;
      accent-color: #2157d9; cursor: pointer; flex-shrink: 0; margin: 0;
    }
    #mlq-cfg label.cb span.txt { flex: 1; font-weight: 500; color: #111827; }
    #mlq-cfg .hint { width: 20px; height: 20px; line-height: 20px; text-align: center; border-radius: 50%;
      background: #DBE7FB; color: #1A46B0; font-size: 11px; font-weight: 700; cursor: pointer; flex-shrink: 0;
      user-select: none; transition: background .15s;
    }
    #mlq-cfg .hint:hover { background: #2157d9; color: #fff; }

    #mlq-tooltip { position: fixed; z-index: 2147483645; max-width: 280px; padding: 10px 12px;
      background: #111827; color: #F9FAFB; font-size: 11.5px; line-height: 1.45; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.25); display: none; pointer-events: none;
    }
    #mlq-tooltip.show { display: block; }

    #mlq-status { padding: 10px 16px; background: #fff; border-bottom: 1px solid #F3F4F6; flex-shrink: 0; }
    .mlq-st-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 11.5px; color: #6B7280; }
    .mlq-st-head b { color: #111827; font-weight: 700; }
    .mlq-st-msg { font-size: 12px; color: #111827; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mlq-st-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #6B7280; margin-right: 6px; vertical-align: middle; }
    .mlq-st-dot.on { background: #16A34A; animation: mlq-pulse 1.5s infinite; }
    @keyframes mlq-pulse { 50% { opacity: .35; } }

    /* v9.1.0 — tools + lista de grupos + progresso + botão INICIAR */
    #mlq-tools { display: flex; align-items: center; gap: 10px; padding: 8px 16px 4px; font-size: 12px; color: #6B7280; flex-shrink: 0; background: #fff; }
    #mlq-tools a { color: #2157d9; cursor: pointer; font-weight: 600; text-decoration: none; }
    #mlq-tools a:hover { text-decoration: underline; }
    #mlq-list { margin: 0 12px 8px; flex: 0 0 auto; max-height: 28vh; overflow: auto; border: 1px solid #E5E7EB; border-radius: 10px; background: #fff; }
    .mlq-g { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-bottom: 1px solid #F3F4F6; cursor: pointer; }
    .mlq-g:last-child { border-bottom: none; }
    .mlq-g:hover { background: #F9FAFB; }
    .mlq-cb { width: 16px; height: 16px; flex: 0 0 auto; cursor: pointer;
      -webkit-appearance: checkbox !important; appearance: auto !important; opacity: 1 !important;
      position: static !important; margin: 0; accent-color: #2157d9;
    }
    .mlq-g .nm { flex: 1; font-weight: 600; font-size: 12px; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mlq-g .id { font: 600 10.5px/1 ui-monospace, monospace; background: #DBE7FB; color: #1A46B0; border-radius: 5px; padding: 3px 6px; flex-shrink: 0; }
    .mlq-g .ct { font-size: 11px; color: #6B7280; min-width: 62px; text-align: right; flex-shrink: 0; }

    #mlq-progress { padding: 10px 16px; background: #fff; border-top: 1px solid #E5E7EB; flex-shrink: 0; }
    #mlq-progress.hidden { display: none; }
    .mlq-pg-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 11.5px; color: #6B7280; }
    .mlq-pg-head b { color: #111827; font-weight: 700; }
    .mlq-pg-atual { font-size: 12px; color: #111827; font-weight: 600; margin-bottom: 6px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .mlq-pg-bar { height: 8px; background: #DBE7FB; border-radius: 999px; overflow: hidden; }
    .mlq-pg-fill { height: 100%; background: #2157d9; transition: width .4s ease; border-radius: 999px; width: 0%; }

    #mlq-actions { padding: 8px 12px; display: flex; gap: 6px; flex-shrink: 0; background: #fff; border-top: 1px solid #F3F4F6; border-bottom: 1px solid #F3F4F6; }
    #mlq-go { flex: 1; background: #2157d9; color: #fff; border: none; border-radius: 8px; padding: 10px;
      font-weight: 700; font-size: 12.5px; cursor: pointer; transition: background .15s;
    }
    #mlq-go:hover:not(:disabled) { background: #1A46B0; }
    #mlq-go:disabled { background: #9CA3AF; cursor: not-allowed; }
    #mlq-reload, #mlq-clear, #mlq-copy { background: #F3F4F6; color: #374151; border: 1px solid #E5E7EB; border-radius: 8px;
      padding: 8px 10px; font-weight: 600; font-size: 11.5px; cursor: pointer; transition: background .15s;
    }
    #mlq-reload:hover, #mlq-clear:hover, #mlq-copy:hover { background: #E5E7EB; }

    #mlq-log { flex: 0 0 auto; height: 180px; margin: 8px 12px 12px; padding: 10px; background: #0F172A; color: #E5E7EB;
      border-radius: 10px; overflow: auto; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
    }
    #mlq-log .ok  { color: #4ADE80; }
    #mlq-log .err { color: #F87171; }
    #mlq-log .hl  { color: #60A5FA; font-weight: 700; }
    #mlq-log .dbg { color: #94A3B8; font-style: italic; }
  `;

  function atualizarStatusUI(msg) {
    const el = document.getElementById('mlq-status-msg');
    const dot = document.getElementById('mlq-status-dot');
    if (el) el.textContent = msg || 'Aguardando movimento…';
    if (dot) dot.classList.toggle('on', /aguardando/i.test(msg || '') === false);
  }

  function mount() {
    if (document.getElementById('mlq-panel')) return;
    if (!document.body) { window.addEventListener('DOMContentLoaded', mount); return; }

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Tooltip flutuante
    const tt = document.createElement('div');
    tt.id = 'mlq-tooltip';
    document.body.appendChild(tt);

    // Tab lateral (só aparece quando ocultado) — v9.3.0 padrão ui2ui (compacta, seta+texto verticais)
    const tab = document.createElement('button');
    tab.id = 'mlq-tab';
    tab.title = 'Abrir MoveLines + Cota';
    tab.textContent = '▶ MoveLines + Cota';
    document.body.appendChild(tab);

    // Sidebar
    const panel = document.createElement('div');
    panel.id = 'mlq-panel';
    let cfgHtml = '';
    for (const [k, v] of Object.entries(CFG_UI)) {
      const checked = cfgUI[k] ? 'checked' : '';
      cfgHtml += `<label class="cb"><input type="checkbox" data-cfg="${k}" ${checked}><span class="txt">${v.label}</span><span class="hint" data-tip="${k}">?</span></label>`;
    }
    panel.innerHTML = `
      <div id="mlq-hd">
        <button id="mlq-close" title="Ocultar">×</button>
        <h3>MoveLines + Cota</h3>
        <div class="sub">Move → "GRUPO SEM LINHAS" → renomeia + cota</div>
      </div>
      <div id="mlq-cfg">${cfgHtml}</div>
      <div id="mlq-tools"><span>Marcar:</span><a id="mlq-all">todos</a><a id="mlq-none">nenhum</a><a id="mlq-reload-link" style="margin-left:auto">↻ lista</a></div>
      <div id="mlq-list"></div>
      <div id="mlq-status">
        <div class="mlq-st-head"><span>Status</span><span><span id="mlq-status-dot" class="mlq-st-dot on"></span><span id="mlq-log-count">0</span> log(s)</span></div>
        <div class="mlq-st-msg" id="mlq-status-msg">Aguardando movimento…</div>
      </div>
      <div id="mlq-progress" class="hidden">
        <div class="mlq-pg-head"><span>Progresso</span><span class="mlq-pg-count"><b>0</b>/<span class="mlq-pg-total">0</span> · <span class="mlq-pg-pct">0%</span></span></div>
        <div class="mlq-pg-atual">Aguardando…</div>
        <div class="mlq-pg-bar"><div class="mlq-pg-fill"></div></div>
      </div>
      <div id="mlq-actions">
        <button id="mlq-go" title="Iniciar automação em lote">▶ INICIAR</button>
        <button id="mlq-clear" title="Limpar log">🗑</button>
        <button id="mlq-copy" title="Copiar log">📋</button>
      </div>
      <div id="mlq-log"></div>
    `;
    document.body.appendChild(panel);
    // v9.2.0 — inicia RECOLHIDO; só expande ao clicar na tab lateral

    const logBox = panel.querySelector('#mlq-log');
    const countEl = panel.querySelector('#mlq-log-count');

    // Registra fn de log da UI e despeja buffer
    uiLogFn = (linha, cls) => {
      const div = document.createElement('div');
      if (cls) div.className = cls;
      div.textContent = linha;
      logBox.appendChild(div);
      logBox.scrollTop = logBox.scrollHeight;
      if (countEl) countEl.textContent = logBox.children.length;
    };
    // Despeja o buffer de logs anteriores
    logBuffer.forEach(({ msg, cls }) => uiLogFn(msg, cls));

    // Handlers
    const listEl = panel.querySelector('#mlq-list');
    panel.querySelector('#mlq-close').onclick = () => document.body.classList.remove('mlq-aberto');
    tab.onclick = () => document.body.classList.add('mlq-aberto');
    panel.querySelector('#mlq-clear').onclick = () => { logBox.innerHTML = ''; logBuffer.length = 0; if (countEl) countEl.textContent = '0'; };
    panel.querySelector('#mlq-copy').onclick = () => {
      const txt = logBuffer.map(l => l.msg).join('\n');
      navigator.clipboard.writeText(txt).then(() => log('(log copiado)', 'ok')).catch(() => log('não consegui copiar', 'err'));
    };
    // v9.1.0 — lista de grupos + botão INICIAR + marcar todos/nenhum + recarregar
    panel.querySelector('#mlq-all').onclick    = () => qsa('#mlq-list .mlq-cb').forEach(c => c.checked = true);
    panel.querySelector('#mlq-none').onclick   = () => qsa('#mlq-list .mlq-cb').forEach(c => c.checked = false);
    panel.querySelector('#mlq-reload-link').onclick = () => { if (!executando) montarLista(listEl); };
    panel.querySelector('#mlq-go').onclick     = () => executarLote();
    // Carrega lista com pequeno delay pra dar tempo do portal capturar sessão
    setTimeout(() => montarLista(listEl), 1200);

    // Checkboxes
    panel.querySelectorAll('input[data-cfg]').forEach(inp => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.cfg;
        setCfg(k, inp.checked);
        log((inp.checked ? '✓ ' : '⏭ ') + CFG_UI[k].label + ': ' + (inp.checked ? 'ON' : 'OFF'), 'hl');
      });
    });

    // Tooltips (click + hover)
    panel.querySelectorAll('.hint').forEach(h => {
      const mostrar = () => {
        const k = h.dataset.tip;
        const txt = CFG_UI[k]?.tip || '';
        if (!txt) return;
        tt.textContent = txt;
        tt.classList.add('show');
        const r = h.getBoundingClientRect();
        const ttW = 280;
        let left = Math.max(8, Math.min(window.innerWidth - ttW - 8, r.left + r.width / 2 - ttW / 2));
        let top  = r.top - tt.offsetHeight - 10;
        if (top < 8) top = r.bottom + 10;
        tt.style.left = left + 'px';
        tt.style.top  = top + 'px';
      };
      const esconder = () => tt.classList.remove('show');
      h.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); tt.classList.contains('show') ? esconder() : mostrar(); });
      h.addEventListener('mouseenter', mostrar);
      h.addEventListener('mouseleave', esconder);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.hint') && !e.target.closest('#mlq-tooltip')) tt.classList.remove('show'); });
  }

  /* ─────────────────────────────────────────────────────────
   *  BOOT
   * ───────────────────────────────────────────────────────── */
  // v9.8.1 — só ativa na área de renovação (data/consumption). @match ficou
  // permissivo em /Portal/* porque o wildcard restritivo estava impedindo
  // o carregamento; a checagem exata mora aqui, no runtime.
  const URL_RENOVACAO_PATH = '/Portal/data/consumption';
  function estaNaRenovacao() {
    try { return (location.pathname || '').startsWith(URL_RENOVACAO_PATH); }
    catch (_) { return false; }
  }

  function init() {
    if (!estaNaRenovacao()) return; // sai silencioso em outras páginas do portal

    setupLogoutDetection();
    observeAngular();
    setTimeout(() => { if (isCfg('colorir')) restoreColors(); }, 300);
    setInterval(() => { if (isCfg('colorir')) restoreColors(); }, 1500);
    mount();
    iniciarWatchdogConta();
    log('✅ MoveLines + Cota v9.10.0 (ilimitado: IDA GSL → RESET+REAPPLY → VOLTA · sem GD) carregado', 'ok');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();

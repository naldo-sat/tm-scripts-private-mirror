// ==UserScript==
// @name         VG 2026 - MoveLines + Quota (Auto)
// @namespace    https://vivogestao.vivoempresas.com.br/
// @version      11.0.4
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
CHANGELOG v11.0.1 — Ajustes pós-redesign (20/07/26 06:07)
─────────────────────────────────────────────────────────────
Naldo reportou 3 problemas após rodar a v11.0.0:

1. CHECKBOXES INVISÍVEIS
   O portal Vivo aplica reset agressivo em `input[type=checkbox]`. Reforçadas
   as regras em #mlq-cfg + .mlq-cb com todos os !important necessários
   (-webkit/-moz/appearance, opacity, visibility, display, position,
   pointer-events, margin, min-width/height). Adicionada borda cinza clara
   como fallback visual caso accent-color não pegue.

2. HEADER SÓ COM "CARREGANDO…"
   obterEmpresaConta() nem sempre acha o nome da empresa no dropdown
   (formato varia). Adicionado fallback:
     - empresa+conta → linha 1: empresa, linha 2: conta
     - só conta      → linha 1: "Conta 0469301552", linha 2 oculta
     - só empresa    → linha 1: empresa, linha 2 oculta
     - nada          → linha 1: "Carregando…"

3. LOG PEQUENO + SETA POUCO VISÍVEL
   Altura voltou pra 180px (era 132px na v11.0.0). Cabeçalho ganhou fundo
   var(--mlq-surface), fonte maior (--mlq-fs-sm) em peso 700, cor de texto
   mais destacada. Chevron virou botão 22x22 com fundo, borda e cor azul.
   Log NÃO começa mais fechado — abre por padrão, usuário controla via
   chevron. Removido auto-expand na 1ª linha (não precisa mais).

CHANGELOG v11.0.0 — Redesign visual (spec Naldo 20/07/26)
─────────────────────────────────────────────────────────────
Repaginação completa da UI, mantendo TODAS as funcionalidades (só remove
indicadores expressamente listados). CSS reescrito com variáveis :root.

TOKENS · adotadas 15 variáveis CSS em :root (--mlq-bg, --mlq-blue, etc).
Sem hex solto fora dessa lista.

FONTES · interface DM Sans (400/500/700), números técnicos JetBrains Mono
(400/700). Injetadas via Google Fonts. Fallback pra system-ui.

ESTRUTURA · painel 330px, card único branco, blocos separados só por
border-top de 1px (sem cards internos com fundo/borda/raio próprios).
Container arredondado com sombra flutuante.

CABEÇALHO · agora mostra empresa + número da conta (lidos do dropdown
do portal via obterEmpresaConta), polling 5s pra pegar troca de conta.
Removido título fixo do script e subtítulo "Move → ... → renomeia + cota".

CHECKBOXES · lado a lado em 2 colunas, textos curtos ("Colorir linhas" /
"Gravar planilha"). Ajuda vira tooltip CSS puro no hover via ::after +
atributo data-tip (removido balão flutuante clicável).

BOTÃO ATUALIZAR · antigo link "↻ lista" vira botão sólido com SVG de
recarga que gira via animação CSS mlq-spin quando classe .loading é
aplicada.

LISTA · sem fundo/borda colorida por estado. Novo marcador .mlq-g-st
no fim de cada linha (círculo âmbar pulsando pra processing, ✓ verde
pra ok, ✕ vermelho pra fail, ↷ cinza pra skip). Nome com title=nome
completo (fixa a queixa de truncagem sem tooltip). Removida pílula
azul do ID (vira texto puro) e sufixo "linha(s)" (vira só número).

EXECUÇÃO · Status e Progresso fundidos em #mlq-exec. Bloco Progresso
usa classe .on em vez de .hidden (default: display none). Após concluir,
permanece visível.

CRONÔMETRO · substitui contadores ao vivo + ETA. Só decorrido, formato
MM:SS (ou HH:MM:SS >59min). Usa setInterval + timestamp de início
(não conta incremental). SVG stopwatch inline.

REMOVIDOS · .mlq-pg-counters (4 indicadores), ETA e cálculo de média,
cards internos com fundo próprio, pílula do ID, sufixo "linha(s)",
emojis 🗑/📋 (viraram SVG lixeira + duas folhas).

LOG · recolhível via cabeçalho clicável (▼/chevron). Expande automático
na 1ª linha registrada. Contador mudou de "N log(s)" pra "N logs".
Formato de linha: timestamp em elemento próprio com cor #565d6c, mensagem
depois com cor por classe.

CLASSES PRESERVADAS · #mlq-panel #mlq-cfg #mlq-list #mlq-status-dot
#mlq-status-msg #mlq-log-count #mlq-progress #mlq-actions #mlq-go
#mlq-clear #mlq-copy #mlq-log · .mlq-pg-count .mlq-pg-total .mlq-pg-pct
.mlq-pg-fill .mlq-pg-atual .mlq-pg-timer · .mlq-g .processing .done-ok
.done-fail .done-skip.
NOVAS · .mlq-g-st, #mlq-exec, #mlq-status-line, #mlq-reload-btn,
#mlq-log-hd.

Status dot: agora com 4 estados (neutro/run/ok/err) — antigo .on removido.

CHANGELOG v10.0.0 — Delays reduzidos + timer/counters/highlight + retry F1
─────────────────────────────────────────────────────────────
Naldo (19/07/26 13:59): "quick wins delays + layout painel + F1 retry".

1. DELAYS REDUZIDOS (quick wins A-E)
   • Polling gatePosMove: 2500 → 1500 ms  (herança)
   • Polling validarRoundtrip: 2500 → 1500 ms  (ilimitado)
   • Sleep entre grupos no executarLote: 1200 → 600 ms
   • Sleep pré-move no roundtripIlimitado: 600 → 300 ms
   Estimado ~3-5s a menos por grupo. Micro-gates cobrem propagação.

2. TIMER + ESTIMATIVA no painel
   • Nova linha: "⏱ 12s · 4m 30s rest"
   • Timer decorrido (setInterval 1s)
   • ETA = restam × (dec/feitos) — vai calibrando conforme processa

3. CONTADORES AO VIVO
   • Nova linha: "✅ 4  ⛔ 1  ↷ 0  restam 3"
   • Atualiza a cada grupo concluído
   • ok verde, fail vermelho, skip cinza, rest azul

4. HIGHLIGHT VISUAL na lista de grupos
   • Item processando: fundo laranja + borda esquerda amarela + texto bold
   • Concluído OK: fundo verde claro + borda verde
   • Falhou: fundo vermelho claro + borda vermelha
   • Pulado (sem linhas): fundo cinza + opacidade reduzida
   • Limpa ao iniciar novo batch

5. F1 · RETRY AUTOMÁTICO DE FALHAS TRANSIENTES
   • Refatorei o loop pra usar função processarGrupo() com result:
     'ok' | 'skip' | 'fail-retry' | 'fail-halt'
   • fail-retry: timeout postMoveFlow (90s) OU GATE 1 falha
     → não interrompe batch, coleta em `falhasTentaveis`, marca fail
   • fail-halt: GATE 0 falha / move falha / MSISDN duplicado / exceção
     → interrompe batch imediatamente
   • Ao fim do batch (se não interrompido), roda RETRY sobre `falhasTentaveis`
     Se OK no retry, decrementa fail, incrementa ok, log "recuperada"
   • Botão "copiar log" (📋) já existia — mantido

CHANGELOG v9.11.0 — ILIMITADO: só roundtrip pelo GD (ui2ui default)
─────────────────────────────────────────────────────────────
Naldo (19/07/26 13:26): pra ilimitado, só movimentação. Sem tocar em
cota. Move pro GD (como o fluxo ui2ui), valida, devolve.

Motivo: as tentativas de RESET+REAPPLY em grupo vazio esbarraram em
limite estrutural da Vivo (HTTP 500 confirmado 3 vezes v9.9.2, v9.9.3
com fluxo pós-VOLTA, v9.10.0 com GRUPO SEM LINHAS). Naldo rejeita o
fallback "VOLTA+REAPPLY" e opta pela solução simples do ui2ui.

Fluxo final v9.11.0:
   1. Encontra GD único
   2. GATE 0: GD funcionalmente vazio (só ativas travam)
   3. IDA origem → GD (100% cliques UI)
   4. Valida IDA
   5. VOLTA GD → origem (100% cliques UI)
   6. Valida VOLTA

Sem RESET, sem REAPPLY, sem herança, sem escudo do interceptor.
Round-trip pelo GD renova a franquia Vivo naturalmente.

Removido:
- Congela cotaGrupoFrozen · não precisa mais
- setGroupQuota calls · não precisa mais
- Fallback lógico · não precisa mais
- Branch de "PARCIAL" no executarLote · não precisa mais

CHANGELOG v9.10.1 — Fallback pra REAPPLY quando grupo vazio rejeita 500
─────────────────────────────────────────────────────────────
Naldo (19/07/26 13:21): "elas só devem voltar quando a cota tiver sido
restaurada" + pediu fallback.

Diagnóstico definitivo (log 13:19:19): Vivo rejeita setGroupQuota(gid,>0)
em grupo com 0 linhas ativas com HTTP 500 (sem result). Limite estrutural,
independente do pool GD (log mostrou pool=1000GB livres). NÃO é lag.

Fluxo v9.10.1 = intenção do Naldo + fallback automático:
   1. IDA origem → GSL
   2. Valida IDA
   3. RESET grupo origem → 0
   4. REAPPLY grupo origem → cotaGrupoFrozen (com origem vazia)
      Se OK  → passo 5 (caminho feliz que o Naldo pediu)
      Se 500 → FALLBACK:
        a. VOLTA GSL → origem (agora)
        b. Valida VOLTA
        c. REAPPLY grupo origem → cotaGrupoFrozen (agora com linhas → aceita)
        d. Se OK → fim OK · Se falha → reporta manual
   5. VOLTA GSL → origem (só se fallback não já fez)
   6. Valida VOLTA

Trade-off aceito: se o REAPPLY em grupo vazio nunca funcionar (como parece
ser o caso pelo log), o fallback SEMPRE roda — vira efetivamente
IDA → RESET → tenta REAPPLY (falha) → VOLTA → REAPPLY. Um passo extra
inútil, mas garante correção. Se algum dia a Vivo mudar comportamento,
o caminho feliz volta a funcionar.

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
      await sleep(1500); // v10.0.0: era 2500
    }
    return { ok: false, motivo: 'não confluiu em ' + Math.round(timeout / 1000) + 's (' + resumo + ')' };
  }

  /* v9.9.0 — validar (poll) pra roundtrip GD (portada do ui2ui):
     confirma que N MSISDNs esperados estão em expectGroupId E emptyGroupId
     está funcionalmente vazio (só ativas contam). */
  async function validarRoundtrip(sess, expectGroupId, expectMsisdns, expectCount, emptyGroupId, opt) {
    opt = opt || {};
    const timeout  = opt.timeout  || 45000;
    const interval = opt.interval || 1500; // v10.0.0: era 2500
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

  /* v9.11.0 — ROUNDTRIP ILIMITADO puro (ui2ui default)
     Naldo (19/07/26 13:26): pra ilimitado, só movimentação. Sem tocar
     em cota. Move pro GD, valida, devolve. Idêntico ao roundtripManual
     do ui2ui rodando com defaults (ignoraReset=true, ignoraCotaIlim=true).

     Fluxo:
       1. Encontra GD único
       2. GATE 0: GD funcionalmente vazio (só ativas travam)
       3. IDA origem → GD (100% cliques UI)
       4. Valida IDA (todas no GD, origem vazia)
       5. VOLTA GD → origem (100% cliques UI)
       6. Valida VOLTA (todas na origem, GD vazio)

     Sem RESET, sem REAPPLY, sem herança de nome/cota. Renova a franquia
     Vivo pelo próprio round-trip. */
  async function roundtripIlimitado(sess, gid, nome) {
    fecharModais(); colapsarGrupos(); await sleep(300);

    log('  · lendo grupos (loadView)…');
    const all = await loadViewUI(sess);
    const g = all.find(x => String(x.id) === String(gid));
    if (!g) return { halt: true, motivo: 'grupo [' + gid + '] não encontrado no loadView' };

    // GD único
    const gds = all.filter(ehGD_ui);
    if (gds.length !== 1) {
      return { halt: true, motivo: gds.length === 0 ? 'GD não encontrado' : 'achei ' + gds.length + ' grupos GD (' + gds.map(x => x.name).join(', ') + ') — esperado exatamente 1' };
    }
    const gd = gds[0];
    const gdid = String(gd.id);

    // Origem: valida linhas ativas + identidade
    const ativas = activeLines(g);
    const N = ativas.length;
    if (N === 0) return { skip: true, motivo: 'origem sem ativas' };
    const msisdnsOrigem = new Set(ativas.map(msisdnOf).filter(Boolean));
    if (msisdnsOrigem.size !== N) {
      return { halt: true, motivo: 'origem tem ' + N + ' ativas mas só ' + msisdnsOrigem.size + ' MSISDNs únicos — não dá pra validar por identidade' };
    }

    // GATE 0: GD funcionalmente vazio (só ativas travam; históricas bcs='1' ignoradas)
    const gdAtivasAntes = activeLines(gd);
    const gdHistoricas = (gd.lines || []).length - gdAtivasAntes.length;
    if (gdAtivasAntes.length > 0) {
      return { halt: true, motivo: 'GD "' + gd.name + '" NÃO vazio (' + gdAtivasAntes.length + ' ativa[s]' + (gdHistoricas ? ' + ' + gdHistoricas + ' histórica[s]' : '') + ') — risco de MISTURA' };
    }
    if (gdHistoricas > 0) log('  · GD "' + gd.name + '": ' + gdHistoricas + ' histórica[s] (bcs=1) ignoradas no GATE 0');

    // ① IDA: origem → GD (100% cliques UI). GD não casa TARGET_DEST_PATTERN,
    // então o interceptor NÃO dispara postMoveFlow — não precisa escudo.
    log('  ═══ ① IDA: "' + nome + '" → GD (' + N + ' linha[s]) ═══', 'hl');
    const ida = await moverPorCliques(gid, nome, gdid, gd.name);
    if (!ida.ok) return { halt: true, motivo: 'IDA falhou — ' + ida.motivo };

    log('  · validando IDA (todas no GD? origem vazia?)…', 'hl');
    const v1 = await validarRoundtrip(sess, gdid, msisdnsOrigem, N, gid);
    if (!v1.ok) return { halt: true, motivo: 'IDA incompleta — ' + v1.motivo };
    log('  ✓ IDA validada: ' + N + ' no GD, origem vazia', 'ok');

    // ② VOLTA: GD → origem (100% cliques UI)
    fecharModais(); colapsarGrupos(); await sleep(300);
    log('  ═══ ② VOLTA: GD → "' + nome + '" ═══', 'hl');
    const volta = await moverPorCliques(gdid, gd.name, gid, nome);
    if (!volta.ok) return { halt: true, motivo: 'VOLTA falhou — ' + volta.motivo + ' (linhas ficaram no GD!)' };

    log('  · validando VOLTA (todas de volta na origem? GD vazio?)…', 'hl');
    const v2 = await validarRoundtrip(sess, gid, msisdnsOrigem, N, gdid);
    if (!v2.ok) return { halt: true, motivo: 'VOLTA incompleta — ' + v2.motivo };
    log('  ✓ CONCILIAÇÃO: ' + N + ' de volta em "' + nome + '", GD vazio', 'ok');

    return { ok: true, N };
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
        // v11.0.0 — sem pílula no id · sem sufixo "linha(s)" · marcador de estado no fim
        row.innerHTML = `<input type="checkbox" class="mlq-cb" value="${g.id}" checked><span class="nm"></span><span class="id">${g.id}</span><span class="ct">${g.n || 0}</span><span class="mlq-g-st"></span>`;
        row.querySelector('.nm').textContent = g.name;
        row.querySelector('.nm').title       = g.name; // tooltip com nome completo
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

  // v11.0.0 — sem contadores. Só nome atual + fração + porcentagem + barra.
  function setProgresso(feitos, total, nomeAtual, counters) {
    void counters; // ignorado — mantido na assinatura pra compat com executarLote
    const p = document.getElementById('mlq-progress');
    if (!p) return;
    const pct = total > 0 ? Math.round(feitos / total * 100) : 0;
    p.classList.add('on');
    const cEl = p.querySelector('.mlq-pg-count');
    const tEl = p.querySelector('.mlq-pg-total');
    const pctEl = p.querySelector('.mlq-pg-pct');
    const fEl = p.querySelector('.mlq-pg-fill');
    const aEl = p.querySelector('.mlq-pg-atual');
    if (cEl) cEl.textContent = feitos;
    if (tEl) tEl.textContent = total;
    if (pctEl) pctEl.textContent = '· ' + pct + '%';
    if (fEl) fEl.style.width = pct + '%';
    if (aEl) aEl.textContent = nomeAtual || (feitos === total ? 'Lote finalizado' : 'Aguardando…');
  }

  // v11.0.0 — timer só decorrido (sem ETA). Formato MM:SS ou HH:MM:SS.
  let progressTimer = null;
  function iniciarProgressoTimer(tsStart) {
    pararProgressoTimer();
    const fmt = (s) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      const pad = n => String(n).padStart(2, '0');
      return h > 0 ? pad(h) + ':' + pad(m) + ':' + pad(ss) : pad(m) + ':' + pad(ss);
    };
    const tick = () => {
      const p = document.getElementById('mlq-progress');
      if (!p) return;
      const dec = Math.round((Date.now() - tsStart) / 1000);
      const decEl = p.querySelector('.mlq-pg-timer .dec');
      if (decEl) decEl.textContent = fmt(dec);
    };
    tick(); // primeiro tick imediato
    progressTimer = setInterval(tick, 1000);
  }
  function pararProgressoTimer() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  }
  // v11.0.0 — troca barra pra vermelho quando termina com falha
  function marcarProgressoErro(temFalha) {
    const p = document.getElementById('mlq-progress');
    if (!p) return;
    p.classList.toggle('err', !!temFalha);
  }

  // v10.0.0 — highlight visual do grupo na lista
  function marcarGrupoLista(gid, estado) {
    const row = document.querySelector('#mlq-list .mlq-cb[value="' + gid + '"]');
    if (!row) return;
    const label = row.closest('label.mlq-g');
    if (!label) return;
    label.classList.remove('processing', 'done-ok', 'done-fail', 'done-skip');
    if (estado) label.classList.add(estado);
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

    // v10.0.0 — limpa highlights de batch anterior
    qsa('#mlq-list label.mlq-g').forEach(el => el.classList.remove('processing', 'done-ok', 'done-fail', 'done-skip'));

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
    setProgresso(0, total, 'Iniciando…', { ok: 0, fail: 0, skip: 0 });

    // v10.0.0 — timer + retry
    let skip = 0;
    const falhasTentaveis = []; // { gid, nome, motivo } · pra retry F1 no fim
    iniciarProgressoTimer(tsInicio);

    // v10.0.0 — extrai o processamento de 1 grupo pra função pura (facilita retry)
    // result: 'ok' | 'skip' | 'fail-retry' | 'fail-halt'
    async function processarGrupo(gid, nome) {
      if (isIlimitado(nome)) {
        log('  · rota ILIMITADO → roundtrip GD (fluxo ui2ui, 100% UI)');
        const rt = await roundtripIlimitado(sess, gid, nome);
        if (rt.skip) return { result: 'skip', motivo: rt.motivo };
        if (rt.halt) return { result: 'fail-halt', motivo: rt.motivo };
        log('  ✅ ilimitado concluído · ' + rt.N + ' linha(s) · round-trip validado (sem tocar em cota)', 'ok');
        return { result: 'ok' };
      }
      // NORMAL: herança 3-em-3 via "GRUPO SEM LINHAS"
      log('  · GATE 0: validando "GRUPO SEM LINHAS" vazio…');
      const g0 = await gateDestinoVazio(sess);
      if (!g0.ok) return { result: 'fail-halt', motivo: 'GATE 0 — ' + g0.motivo };
      if (g0.historicas > 0) log('    (' + g0.historicas + ' histórica[s] no destino — ignoradas)');
      const destId = g0.destId, destName = g0.destName;

      const allPre = await loadViewUI(sess);
      const origemPre = allPre.find(x => String(x.id) === String(gid));
      if (!origemPre) return { result: 'fail-halt', motivo: 'origem [' + gid + '] não encontrada no loadView' };
      const ativasPre = activeLines(origemPre);
      const N = ativasPre.length;
      if (N === 0) return { result: 'skip', motivo: 'origem sem linhas ativas' };
      const msisdnsEsperados = new Set(ativasPre.map(msisdnOf).filter(Boolean));
      if (msisdnsEsperados.size !== N) {
        return { result: 'fail-halt', motivo: 'origem tem ' + N + ' ativas mas só ' + msisdnsEsperados.size + ' MSISDNs únicos' };
      }
      log('  · ' + N + ' linha(s) esperada(s) · destino "' + destName + '" [' + destId + ']');

      const r = await moverPorCliques(gid, nome, destId, destName);
      if (!r.ok) return { result: 'fail-halt', motivo: 'move falhou — ' + r.motivo };
      log('  ✓ move disparado — aguardando renomeio+cota…');

      const finalizou = await aguardarPostMove(90000);
      if (!finalizou) return { result: 'fail-retry', motivo: 'timeout no postMoveFlow (90s) · transiente' };

      log('  · GATE 1: validando linhas no destino + novo vazio…');
      const g1 = await gatePosMove(sess, msisdnsEsperados, N, nome);
      if (!g1.ok) return { result: 'fail-retry', motivo: 'GATE 1 — ' + g1.motivo + ' · transiente' };
      log('  ✅ concluído · ' + N + ' linha(s) · GATE 1 ok · ' + (g1.resumo || ''), 'ok');
      return { result: 'ok' };
    }

    for (let i = 0; i < marcados.length; i++) {
      if (parou) break;
      const gid = marcados[i];
      const g   = gruposCache.find(x => x.id === gid);
      const nome = g ? g.name : gid;
      setProgresso(i, total, 'Processando: ' + nome, { ok, fail, skip });
      marcarGrupoLista(gid, 'processing');
      log('▶ ' + nome + ' [' + gid + ']', 'hl');

      let r;
      try {
        r = await processarGrupo(gid, nome);
      } catch (e) {
        r = { result: 'fail-halt', motivo: 'erro inesperado: ' + (e && e.message || e) };
      }

      if (r.result === 'ok') {
        ok++;
        marcarGrupoLista(gid, 'done-ok');
      } else if (r.result === 'skip') {
        skip++;
        log('  ↷ ' + r.motivo + ' — pulando', 'hl');
        marcarGrupoLista(gid, 'done-skip');
      } else if (r.result === 'fail-retry') {
        fail++;
        log('  ⚠ falha transiente — ' + r.motivo + ' · marcado pra RETRY no fim', 'err');
        falhasTentaveis.push({ gid, nome, motivo: r.motivo });
        marcarGrupoLista(gid, 'done-fail');
      } else { // fail-halt
        fail++;
        log('  ⛔ ' + r.motivo, 'err');
        log('═══════ ⛔ INTERROMPIDO em "' + nome + '" — ' + ok + ' ok antes. Corrija e rode de novo. ═══════', 'err');
        marcarGrupoLista(gid, 'done-fail');
        parou = true;
      }

      setProgresso(i + 1, total, i + 1 === total ? 'Concluído.' : 'Próximo…', { ok, fail, skip });
      fecharModais();
      colapsarGrupos();
      await sleep(600); // v10.0.0: era 1200
    }

    // v10.0.0 — F1: RETRY automático das falhas transientes (só se batch não foi interrompido)
    if (!parou && falhasTentaveis.length > 0) {
      const failAntesRetry = fail;
      log('', 'hl');
      log('═══════ RETRY · ' + falhasTentaveis.length + ' falha(s) transiente(s) ═══════', 'hl');
      for (let k = 0; k < falhasTentaveis.length; k++) {
        const { gid, nome, motivo: motivoOriginal } = falhasTentaveis[k];
        setProgresso(total, total, 'RETRY ' + (k + 1) + '/' + falhasTentaveis.length + ': ' + nome, { ok, fail, skip });
        marcarGrupoLista(gid, 'processing');
        log('↻ RETRY · ' + nome + ' [' + gid + '] · motivo original: ' + motivoOriginal, 'hl');
        let r;
        try {
          r = await processarGrupo(gid, nome);
        } catch (e) {
          r = { result: 'fail-halt', motivo: 'erro inesperado no retry: ' + (e && e.message || e) };
        }
        if (r.result === 'ok') {
          ok++; fail--; // recupera contadores
          log('  ✓ RETRY OK · falha recuperada', 'ok');
          marcarGrupoLista(gid, 'done-ok');
        } else if (r.result === 'skip') {
          log('  ↷ RETRY SKIP · ' + r.motivo, 'hl');
          marcarGrupoLista(gid, 'done-skip');
        } else {
          log('  ⛔ RETRY FALHOU · ' + r.motivo + ' — falha permanece', 'err');
          marcarGrupoLista(gid, 'done-fail');
        }
        fecharModais(); colapsarGrupos(); await sleep(600);
      }
      log('═══════ fim RETRY · recuperadas: ' + (failAntesRetry - fail) + '/' + falhasTentaveis.length + ' ═══════', 'hl');
    }

    pararProgressoTimer();

    log('═══════ fim · ' + ok + ' ok · ' + fail + ' falha · ' + skip + ' skip' + (parou ? ' · INTERROMPIDO' : '') + ' ═══════', parou ? 'err' : 'hl');
    setProgresso(total, total, parou ? 'Interrompido' : 'Lote finalizado', { ok, fail, skip });
    marcarProgressoErro(fail > 0 || parou);
    // v11.0.0 — estado final do dot
    const estadoFinal = (fail > 0 || parou) ? 'err' : 'ok';
    atualizarStatusUI(parou ? 'Interrompido' : (fail > 0 ? 'Concluído com falhas' : 'Concluído · aguardando próximo…'), estadoFinal);

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
  const CC_LARGURA = 330;
  // v11.0.0 — fontes: DM Sans (interface) + JetBrains Mono (números técnicos).
  // Se as fontes não carregarem, o fallback do sistema entra sem quebrar layout.
  const FONT_LINK = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">';
  const CSS = `
    :root {
      --mlq-bg: #ffffff;
      --mlq-surface: #f7f8fa;
      --mlq-line: #e6e9ef;
      --mlq-text: #1a1d24;
      --mlq-text-2: #6b7280;
      --mlq-text-3: #9aa1ad;
      --mlq-blue: #2f6bff;
      --mlq-green: #16a34a;
      --mlq-amber: #e08600;
      --mlq-red: #dc2626;
      --mlq-r-sm: 5px;
      --mlq-fs-xs: 10.5px;
      --mlq-fs-sm: 11.5px;
      --mlq-fs-md: 12.5px;
      --mlq-fs-lg: 14px;
    }

    body.mlq-aberto { margin-left: ${CC_LARGURA}px !important; transition: margin-left .3s ease; }

    #mlq-tab { position: fixed; top: 50%; left: 0; transform: translateY(-50%); z-index: 2147483640;
      background: var(--mlq-blue); color: #fff; border: none; border-radius: 0 var(--mlq-r-sm) var(--mlq-r-sm) 0;
      padding: 14px 8px; cursor: pointer; box-shadow: 2px 0 10px rgba(20,25,40,.2);
      font: 700 11px/1 "DM Sans", -apple-system, "Segoe UI", Roboto, sans-serif;
      writing-mode: vertical-rl; display: none;
    }
    body:not(.mlq-aberto) #mlq-tab { display: inline-block; }
    #mlq-tab:hover { background: #1f57e0; }

    #mlq-panel { position: fixed; top: 12px; left: 12px; width: ${CC_LARGURA}px; max-height: calc(100vh - 24px); z-index: 2147483641;
      background: var(--mlq-bg); border: 1px solid var(--mlq-line); border-radius: 10px;
      box-shadow: 0 6px 24px rgba(20,25,40,.12);
      display: flex; flex-direction: column; overflow: hidden;
      font: var(--mlq-fs-md)/1.45 "DM Sans", -apple-system, "Segoe UI", Roboto, "Inter", sans-serif;
      color: var(--mlq-text);
      transition: transform .3s ease;
    }
    body:not(.mlq-aberto) #mlq-panel { transform: translateX(calc(-100% - 20px)); }
    #mlq-panel * { box-sizing: border-box; }

    /* ============ CABEÇALHO (empresa + conta) ============ */
    #mlq-hd { display: flex; align-items: center; gap: 8px;
      padding: 9px 10px 9px 12px; background: var(--mlq-blue); color: #fff; flex-shrink: 0;
    }
    #mlq-hd .hd-txt { flex: 1; min-width: 0; }
    #mlq-hd .hd-empresa {
      font-size: var(--mlq-fs-lg); font-weight: 700; line-height: 1.15; letter-spacing: -0.01em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #mlq-hd .hd-conta {
      font: 400 var(--mlq-fs-xs)/1.3 "JetBrains Mono", ui-monospace, monospace;
      opacity: 0.85; margin-top: 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #mlq-close { width: 22px; height: 22px; flex: none; border: 0; border-radius: var(--mlq-r-sm);
      background: rgba(255,255,255,.16); color: #fff; font-size: 12px; cursor: pointer;
      display: grid; place-items: center; transition: background .15s;
    }
    #mlq-close:hover { background: rgba(255,255,255,.30); }

    /* ============ CONFIGURAÇÕES (lado a lado) ============ */
    #mlq-cfg { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--mlq-line); flex-shrink: 0; }
    #mlq-cfg label.cb {
      flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;
      padding: 6px 7px; background: var(--mlq-surface); border-radius: var(--mlq-r-sm);
      cursor: pointer; user-select: none;
    }
    #mlq-cfg label.cb input[type=checkbox] {
      -webkit-appearance: checkbox !important;
      -moz-appearance: checkbox !important;
      appearance: checkbox !important;
      width: 14px !important; height: 14px !important;
      min-width: 14px !important; min-height: 14px !important;
      opacity: 1 !important; visibility: visible !important;
      display: inline-block !important; position: static !important;
      pointer-events: auto !important; margin: 0 !important; flex: none;
      accent-color: var(--mlq-blue); cursor: pointer;
      border: 1px solid #c8cdd7; background: #fff;
    }
    #mlq-cfg label.cb span.txt {
      flex: 1; min-width: 0; font-size: var(--mlq-fs-sm); line-height: 1.2; color: var(--mlq-text);
    }
    #mlq-cfg .hint {
      width: 14px; height: 14px; flex: none; border: 0; border-radius: 50%; padding: 0;
      background: #dde1e9; color: #6b7280;
      font: 700 9px/1 "DM Sans", sans-serif; cursor: help;
      display: grid; place-items: center; position: relative;
    }
    #mlq-cfg .hint:hover { background: var(--mlq-blue); color: #fff; }

    /* v11.0.3 — tooltip flutuante fora do overflow do painel (não corta) */
    #mlq-tooltip {
      position: fixed; z-index: 2147483645; max-width: 240px;
      padding: 8px 10px; background: #1a1d24; color: #fff;
      border-radius: 6px; box-shadow: 0 8px 24px rgba(20,25,40,.25);
      font: 400 var(--mlq-fs-xs)/1.4 "DM Sans", -apple-system, sans-serif;
      text-align: left; pointer-events: none; display: none; white-space: normal;
    }
    #mlq-tooltip.show { display: block; }

    /* ============ BARRA DA LISTA ============ */
    #mlq-tools {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px 6px; flex-shrink: 0;
    }
    #mlq-tools .master {
      display: flex; align-items: center; gap: 7px; cursor: pointer; user-select: none;
    }
    #mlq-tools .master:hover .lbl { color: var(--mlq-text-2); }
    #mlq-tools .master input[type=checkbox] {
      -webkit-appearance: checkbox !important;
      -moz-appearance: checkbox !important;
      appearance: checkbox !important;
      width: 14px !important; height: 14px !important;
      min-width: 14px !important; min-height: 14px !important;
      opacity: 1 !important; visibility: visible !important;
      display: inline-block !important; position: static !important;
      pointer-events: auto !important; margin: 0 !important; flex: none;
      accent-color: var(--mlq-blue); cursor: pointer;
      border: 1px solid #c8cdd7; background: #fff;
    }
    #mlq-tools .lbl {
      font-size: var(--mlq-fs-xs); color: var(--mlq-text-3);
      text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500;
      transition: color .15s;
    }
    #mlq-reload-btn {
      margin-left: auto; display: flex; align-items: center; gap: 5px;
      height: 24px; padding: 0 9px;
      border: 1px solid #cfd9f5; border-radius: var(--mlq-r-sm); background: #eef3ff;
      color: var(--mlq-blue); font: 700 var(--mlq-fs-sm)/1 "DM Sans", sans-serif;
      cursor: pointer; transition: background .15s, border-color .15s, color .15s;
    }
    #mlq-reload-btn:hover { background: var(--mlq-blue); border-color: var(--mlq-blue); color: #fff; }
    #mlq-reload-btn svg { width: 12px; height: 12px; }
    #mlq-reload-btn.loading svg { animation: mlq-spin 0.8s linear infinite; }
    @keyframes mlq-spin { to { transform: rotate(360deg); } }

    /* ============ LISTA DE GRUPOS ============ */
    #mlq-list {
      max-height: 180px; overflow-y: auto; padding: 0 8px 8px;
      display: flex; flex-direction: column; gap: 1px; flex-shrink: 0;
    }
    #mlq-list::-webkit-scrollbar { width: 5px; }
    #mlq-list::-webkit-scrollbar-thumb { background: #ccd2dc; border-radius: 3px; }
    .mlq-g {
      display: flex; align-items: center; gap: 7px;
      padding: 5px 8px; border-radius: var(--mlq-r-sm);
      cursor: pointer; transition: background .12s; background: transparent;
    }
    .mlq-g:hover { background: var(--mlq-surface); }
    .mlq-cb {
      -webkit-appearance: checkbox !important;
      -moz-appearance: checkbox !important;
      appearance: checkbox !important;
      width: 14px !important; height: 14px !important;
      min-width: 14px !important; min-height: 14px !important;
      opacity: 1 !important; visibility: visible !important;
      display: inline-block !important; position: static !important;
      pointer-events: auto !important; margin: 0 !important; flex: none;
      accent-color: var(--mlq-blue); cursor: pointer;
      border: 1px solid #c8cdd7; background: #fff;
    }
    .mlq-g .nm {
      flex: 1; min-width: 0;
      font: 500 var(--mlq-fs-sm)/1.2 "DM Sans", sans-serif; color: var(--mlq-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .mlq-g .id {
      flex: none; font: 400 var(--mlq-fs-xs)/1 "JetBrains Mono", ui-monospace, monospace;
      color: var(--mlq-text-3);
    }
    .mlq-g .ct {
      flex: none; font-size: var(--mlq-fs-xs); color: var(--mlq-text-2);
      min-width: 20px; text-align: right; font-variant-numeric: tabular-nums;
    }
    .mlq-g-st {
      flex: none; width: 13px; height: 13px;
      display: grid; place-items: center;
      font: 700 9px/1 "DM Sans", sans-serif; color: transparent;
    }
    .mlq-g-st::before { content: ''; display: block; }
    .mlq-g.processing .nm { font-weight: 700; }
    .mlq-g.processing .mlq-g-st::before {
      width: 6px; height: 6px; border-radius: 50%; background: var(--mlq-amber);
      animation: mlq-pulse 1.1s infinite;
    }
    .mlq-g.done-ok .mlq-g-st { color: var(--mlq-green); }
    .mlq-g.done-ok .mlq-g-st::before { content: '✓'; }
    .mlq-g.done-fail .mlq-g-st { color: var(--mlq-red); }
    .mlq-g.done-fail .mlq-g-st::before { content: '✕'; }
    .mlq-g.done-skip .mlq-g-st { color: var(--mlq-text-3); }
    .mlq-g.done-skip .mlq-g-st::before { content: '↷'; }
    .mlq-g.done-skip .nm { color: var(--mlq-text-3); }
    @keyframes mlq-pulse { 50% { opacity: .25; } }

    /* ============ EXECUÇÃO (status + progresso) ============ */
    #mlq-exec { padding: 8px 12px; border-top: 1px solid var(--mlq-line); flex-shrink: 0; }
    #mlq-status-line { display: flex; align-items: center; gap: 7px; }
    #mlq-status-dot {
      width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--mlq-text-3);
    }
    #mlq-status-dot.run { background: var(--mlq-amber); animation: mlq-pulse 1.1s infinite; }
    #mlq-status-dot.ok  { background: var(--mlq-green); }
    #mlq-status-dot.err { background: var(--mlq-red); }
    #mlq-status-msg {
      flex: 1; min-width: 0; font-size: var(--mlq-fs-sm); color: var(--mlq-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #mlq-log-count {
      flex: none; font-size: var(--mlq-fs-xs); color: var(--mlq-text-3);
      font-variant-numeric: tabular-nums;
    }

    #mlq-progress { margin-top: 7px; display: none; }
    #mlq-progress.on { display: block; }
    .mlq-pg-line1 {
      display: flex; align-items: baseline; gap: 6px;
      font-size: var(--mlq-fs-xs); color: var(--mlq-text-2); font-variant-numeric: tabular-nums;
    }
    .mlq-pg-atual {
      flex: 1; min-width: 0; font-size: var(--mlq-fs-sm); font-weight: 500; color: var(--mlq-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .mlq-pg-frac { font-weight: 700; color: var(--mlq-text); }
    .mlq-pg-pct { color: var(--mlq-text-2); }
    .mlq-pg-bar {
      height: 3px; background: var(--mlq-line); border-radius: 2px; overflow: hidden;
      margin: 6px 0 5px;
    }
    .mlq-pg-fill { height: 100%; background: var(--mlq-blue); border-radius: 2px; width: 0%; transition: width .4s; }
    #mlq-progress.err .mlq-pg-fill { background: var(--mlq-red); }
    .mlq-pg-timer {
      display: flex; align-items: center; gap: 5px;
      font-size: var(--mlq-fs-xs); color: var(--mlq-text-2); font-variant-numeric: tabular-nums;
    }
    .mlq-pg-timer svg { width: 11px; height: 11px; flex: none; }
    .mlq-pg-timer .dec {
      font: 700 11px/1 "JetBrains Mono", ui-monospace, monospace; color: var(--mlq-text);
    }

    /* ============ AÇÕES ============ */
    #mlq-actions { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--mlq-line); flex-shrink: 0; }
    #mlq-go {
      flex: 1; height: 32px; border: 0; border-radius: var(--mlq-r-sm);
      background: var(--mlq-blue); color: #fff;
      font: 700 var(--mlq-fs-md)/1 "DM Sans", sans-serif; letter-spacing: 0.01em;
      cursor: pointer; transition: background .15s;
    }
    #mlq-go:hover:not(:disabled) { background: #1f57e0; }
    #mlq-go:disabled { background: #c8cdd7; color: #fff; cursor: default; }
    #mlq-clear, #mlq-copy {
      width: 32px; height: 32px; flex: none;
      border: 1px solid var(--mlq-line); border-radius: var(--mlq-r-sm);
      background: var(--mlq-bg); color: var(--mlq-text-2);
      display: grid; place-items: center; cursor: pointer; transition: background .15s, color .15s, border-color .15s;
    }
    #mlq-clear:hover, #mlq-copy:hover { background: var(--mlq-surface); color: var(--mlq-text); border-color: #d3d8e2; }
    #mlq-clear svg, #mlq-copy svg { width: 14px; height: 14px; }

    /* ============ LOG RECOLHÍVEL ============ */
    #mlq-log-hd {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-top: 1px solid var(--mlq-line);
      cursor: pointer; user-select: none;
      font: 700 var(--mlq-fs-sm)/1 "DM Sans", sans-serif;
      color: var(--mlq-text-2); text-transform: uppercase; letter-spacing: 0.06em;
      flex-shrink: 0; background: var(--mlq-surface);
      transition: background .15s, color .15s;
    }
    #mlq-log-hd:hover { background: #eef1f6; color: var(--mlq-text); }
    #mlq-log-hd .chev {
      margin-left: auto;
      display: grid; place-items: center;
      width: 22px; height: 22px; border-radius: var(--mlq-r-sm);
      background: var(--mlq-bg); color: var(--mlq-blue);
      font-size: 12px; font-weight: 700;
      border: 1px solid var(--mlq-line);
      transition: transform .2s, background .15s;
    }
    #mlq-log-hd:hover .chev { background: #eef3ff; }
    #mlq-log-hd.closed .chev { transform: rotate(-90deg); }
    #mlq-log {
      flex: 0 0 auto; height: 180px; overflow-y: auto;
      background: #12141a; padding: 10px 12px;
      font: 400 11px/1.55 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre-wrap;
    }
    #mlq-log.hide { display: none; }
    #mlq-log::-webkit-scrollbar { width: 5px; }
    #mlq-log::-webkit-scrollbar-thumb { background: #3a3f4b; border-radius: 3px; }
    #mlq-log > div { display: flex; gap: 7px; color: #8b93a3; }
    #mlq-log > div .ts { color: #565d6c; flex: none; }
    #mlq-log > div.ok  { color: #4ade80; }
    #mlq-log > div.err { color: #f87171; }
    #mlq-log > div.hl  { color: #7aa2ff; font-weight: 700; }
    #mlq-log > div.dbg { color: #4a5060; font-style: italic; }
  `;

  // v11.0.0 — dot com 4 estados: neutro (sem classe) · run · ok · err
  function atualizarStatusUI(msg, estado) {
    const el = document.getElementById('mlq-status-msg');
    const dot = document.getElementById('mlq-status-dot');
    if (el) el.textContent = msg || 'Aguardando movimento…';
    if (dot) {
      dot.classList.remove('run', 'ok', 'err');
      if (estado) {
        dot.classList.add(estado);
      } else {
        // heurística automática: mensagem contém "aguardando" → neutro; senão → run
        if (msg && !/aguardando/i.test(msg)) dot.classList.add('run');
      }
    }
  }

  // v11.0.2 — lê conta (e empresa quando disponível) do portal Vivo.
  // Fonte primária: div.item-option com <p>Conta</p> + <p class="item-desc">NNN</p>.
  // Fallbacks: a.dropdown-toggle, ou qualquer texto com \d{10} no header.
  function obterEmpresaConta() {
    try {
      let empresa = null, conta = null;

      // Fonte primária: item-option (padrão observado no portal)
      const itens = document.querySelectorAll('div.item-option');
      for (const it of itens) {
        const ps = it.querySelectorAll('p');
        if (ps.length < 2) continue;
        const label = (ps[0].textContent || '').trim().toLowerCase();
        const desc  = (it.querySelector('.item-desc')?.textContent || ps[1].textContent || '').trim();
        if (!desc) continue;
        if (/^conta/i.test(label) && /^\d{6,}$/.test(desc)) conta = desc;
        else if (/^(empresa|raz[aã]o|cliente|nome)/i.test(label) && !conta && !empresa) empresa = desc;
        else if (/^(empresa|raz[aã]o|cliente|nome)/i.test(label)) empresa = desc;
      }

      // Fallback 1: dropdown-toggle (versão antiga do portal)
      if (!conta) {
        const toggle = document.querySelector('a.dropdown-toggle');
        if (toggle) {
          const txt = (toggle.textContent || '').trim().replace(/\s+/g, ' ');
          const mConta = txt.match(/\d{10}/);
          if (mConta) {
            conta = mConta[0];
            if (!empresa) {
              const rest = txt.replace(conta, '').replace(/^[\s\-·|]+|[\s\-·|]+$/g, '').trim();
              if (rest) empresa = rest;
            }
          }
        }
      }

      // Fallback 2: qualquer \d{10} num header/menu do portal
      if (!conta) {
        const headerTxt = (document.querySelector('header, .header, .navbar')?.textContent || '').trim();
        const m = headerTxt.match(/\d{10}/);
        if (m) conta = m[0];
      }

      return { empresa, conta };
    } catch (_) { return { empresa: null, conta: null }; }
  }

  function atualizarHeaderConta() {
    const eEl = document.querySelector('#mlq-hd .hd-empresa');
    const cEl = document.querySelector('#mlq-hd .hd-conta');
    if (!eEl || !cEl) return;
    const { empresa, conta } = obterEmpresaConta();
    // v11.0.3 — se tem conta, tenta enriquecer com empresa do mapa `abasPorConta`
    // (mais confiável que scraping do dropdown do portal).
    const empresaDoMapa = (conta && abasPorConta[conta]) ? abasPorConta[conta] : null;
    const empresaFinal  = empresaDoMapa || empresa || null;

    if (conta && empresaFinal) {
      // v11.0.4 — nome da empresa primeiro, número depois
      eEl.textContent = empresaFinal + ' · ' + conta;
      eEl.title = empresaFinal + ' · ' + conta;
      cEl.textContent = '';
      cEl.style.display = 'none';
    } else if (conta) {
      eEl.textContent = 'Conta ' + conta;
      eEl.title = conta;
      cEl.textContent = '';
      cEl.style.display = 'none';
    } else if (empresaFinal) {
      eEl.textContent = empresaFinal;
      eEl.title = empresaFinal;
      cEl.textContent = '';
      cEl.style.display = 'none';
    } else {
      eEl.textContent = 'Carregando…';
      cEl.textContent = '';
      cEl.style.display = 'none';
    }
  }

  function mount() {
    if (document.getElementById('mlq-panel')) return;
    if (!document.body) { window.addEventListener('DOMContentLoaded', mount); return; }

    // v11.0.0 — injeta link das fontes (idempotente)
    if (!document.getElementById('mlq-fonts')) {
      const wrap = document.createElement('div');
      wrap.innerHTML = FONT_LINK;
      wrap.querySelectorAll('link').forEach((l, i) => {
        if (i === 0) l.id = 'mlq-fonts';
        document.head.appendChild(l);
      });
    }

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // v11.0.3 — Tooltip flutuante (position: fixed no body, não corta pelo overflow do painel)
    const tt = document.createElement('div');
    tt.id = 'mlq-tooltip';
    document.body.appendChild(tt);

    // Tab lateral (só aparece quando ocultado)
    const tab = document.createElement('button');
    tab.id = 'mlq-tab';
    tab.title = 'Abrir MoveLines + Cota';
    tab.textContent = '▶ Renovação';
    document.body.appendChild(tab);

    // v11.0.0 — Textos curtos dos checkboxes (labels do painel; o CFG_UI mantém texto longo pra logs)
    const CFG_UI_LABEL_CURTO = {
      colorir: 'Colorir linhas',
      gravarPlanilha: 'Gravar planilha',
    };
    const CFG_UI_TIP_CURTO = {
      colorir: 'Pinta de verde as linhas concluídas com sucesso e de vermelho as que falharam.',
      gravarPlanilha: 'Registra início e fim do lote em uma planilha do Google Sheets.',
    };

    // Sidebar
    const panel = document.createElement('div');
    panel.id = 'mlq-panel';
    let cfgHtml = '';
    for (const [k, v] of Object.entries(CFG_UI)) {
      const checked = cfgUI[k] ? 'checked' : '';
      const label = CFG_UI_LABEL_CURTO[k] || v.label;
      const tip   = CFG_UI_TIP_CURTO[k]   || v.tip || '';
      cfgHtml += `<label class="cb"><input type="checkbox" data-cfg="${k}" ${checked}><span class="txt">${label}</span><button type="button" class="hint" data-tip="${tip.replace(/"/g,'&quot;')}">?</button></label>`;
    }

    // SVG icons (inline, currentColor)
    const SVG_RELOAD = '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>';
    const SVG_STOPWATCH = '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="7"/><path d="M12 14V10"/><path d="M12 14l3 2.5"/><path d="M9 3h6"/><path d="M18 5l1.5-1.5"/></svg>';
    const SVG_TRASH = '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 4h6l1 3H8l1-3z"/><path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12"/></svg>';
    const SVG_COPY = '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1"/></svg>';

    panel.innerHTML = `
      <div id="mlq-hd">
        <div class="hd-txt">
          <div class="hd-empresa">Carregando…</div>
          <div class="hd-conta"></div>
        </div>
        <button id="mlq-close" title="Ocultar">✕</button>
      </div>
      <div id="mlq-cfg">${cfgHtml}</div>
      <div id="mlq-tools">
        <label class="master" title="Selecionar todos"><input type="checkbox" id="mlq-master" checked><span class="lbl">Grupos</span></label>
        <button id="mlq-reload-btn" type="button">${SVG_RELOAD}Atualizar</button>
      </div>
      <div id="mlq-list"></div>
      <div id="mlq-exec">
        <div id="mlq-status-line">
          <span id="mlq-status-dot"></span>
          <span id="mlq-status-msg">Aguardando movimento…</span>
          <span id="mlq-log-count">0 logs</span>
        </div>
        <div id="mlq-progress">
          <div class="mlq-pg-line1">
            <span class="mlq-pg-atual">Aguardando…</span>
            <span class="mlq-pg-frac"><span class="mlq-pg-count">0</span>/<span class="mlq-pg-total">0</span></span>
            <span class="mlq-pg-pct">· 0%</span>
          </div>
          <div class="mlq-pg-bar"><div class="mlq-pg-fill"></div></div>
          <div class="mlq-pg-timer">${SVG_STOPWATCH}<span class="dec">00:00</span></div>
        </div>
      </div>
      <div id="mlq-actions">
        <button id="mlq-go" title="Iniciar automação em lote">▶ INICIAR</button>
        <button id="mlq-clear" title="Limpar log">${SVG_TRASH}</button>
        <button id="mlq-copy" title="Copiar log">${SVG_COPY}</button>
      </div>
      <div id="mlq-log-hd"><span>Log</span><span class="chev">▼</span></div>
      <div id="mlq-log"></div>
    `;
    document.body.appendChild(panel);

    // v11.0.0 — preenche header com conta ativa (agora + polling a cada 5s)
    atualizarHeaderConta();
    setInterval(atualizarHeaderConta, 5000);

    const logBox = panel.querySelector('#mlq-log');
    const logHd  = panel.querySelector('#mlq-log-hd');
    const countEl = panel.querySelector('#mlq-log-count');

    // v11.0.0 — expande log ao chegar 1ª linha; count no formato "N logs"
    uiLogFn = (linha, cls) => {
      const div = document.createElement('div');
      if (cls) div.className = cls;
      // separa timestamp (primeiros 8 chars: HH:MM:SS)
      const m = linha.match(/^(\d{2}:\d{2}:\d{2})\s+(.*)$/s);
      if (m) {
        div.innerHTML = '<span class="ts">' + m[1] + '</span><span>' + escapeHtml(m[2]) + '</span>';
      } else {
        div.textContent = linha;
      }
      logBox.appendChild(div);
      logBox.scrollTop = logBox.scrollHeight;
      if (countEl) countEl.textContent = logBox.children.length + ' logs';
    };
    // Despeja o buffer de logs anteriores
    logBuffer.forEach(({ msg, cls }) => uiLogFn(msg, cls));

    // Handlers
    const listEl = panel.querySelector('#mlq-list');
    panel.querySelector('#mlq-close').onclick = () => document.body.classList.remove('mlq-aberto');
    tab.onclick = () => document.body.classList.add('mlq-aberto');
    panel.querySelector('#mlq-clear').onclick = () => {
      logBox.innerHTML = ''; logBuffer.length = 0;
      if (countEl) countEl.textContent = '0 logs';
      // v11.0.1 — não mexe mais no toggle do log (usuário controla via chevron)
      const pg = document.getElementById('mlq-progress');
      if (pg) { pg.classList.remove('on', 'err'); }
    };
    panel.querySelector('#mlq-copy').onclick = () => {
      const txt = logBuffer.map(l => l.msg).join('\n');
      navigator.clipboard.writeText(txt).then(() => log('(log copiado)', 'ok')).catch(() => log('não consegui copiar', 'err'));
    };
    // v11.0.3 — checkbox mestre (substitui todos/nenhum)
    const masterCb = panel.querySelector('#mlq-master');
    function sincronizarMaster() {
      const boxes = qsa('#mlq-list .mlq-cb');
      if (!boxes.length) { masterCb.checked = false; masterCb.indeterminate = false; return; }
      const marcados = boxes.filter(c => c.checked).length;
      masterCb.checked      = marcados === boxes.length;
      masterCb.indeterminate = marcados > 0 && marcados < boxes.length;
    }
    masterCb.addEventListener('change', () => {
      const val = masterCb.checked;
      qsa('#mlq-list .mlq-cb').forEach(c => c.checked = val);
      masterCb.indeterminate = false;
    });
    // sincroniza quando o usuário marca/desmarca item individual
    listEl.addEventListener('change', (e) => {
      if (e.target && e.target.classList.contains('mlq-cb')) sincronizarMaster();
    });
    // expõe função pra sincronizar depois de recargas
    panel.__mlqSyncMaster = sincronizarMaster;

    // v11.0.0 — botão Atualizar com estado de loading
    const reloadBtn = panel.querySelector('#mlq-reload-btn');
    reloadBtn.onclick = async () => {
      if (executando) return;
      reloadBtn.classList.add('loading');
      try { await montarLista(listEl); sincronizarMaster(); }
      finally { reloadBtn.classList.remove('loading'); }
    };
    panel.querySelector('#mlq-go').onclick = () => executarLote();

    // v11.0.0 — Log recolhível
    logHd.onclick = () => {
      logHd.classList.toggle('closed');
      logBox.classList.toggle('hide');
    };

    // Carrega lista com pequeno delay pra dar tempo do portal capturar sessão
    setTimeout(async () => { await montarLista(listEl); sincronizarMaster(); }, 1200);

    // Checkboxes
    panel.querySelectorAll('input[data-cfg]').forEach(inp => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.cfg;
        setCfg(k, inp.checked);
        log((inp.checked ? '✓ ' : '⏭ ') + CFG_UI[k].label + ': ' + (inp.checked ? 'ON' : 'OFF'), 'hl');
      });
    });

    // v11.0.3 — tooltip flutuante nos "?" (position:fixed no body, sem corte)
    panel.querySelectorAll('#mlq-cfg .hint').forEach(h => {
      const mostrar = () => {
        const txt = h.dataset.tip || '';
        if (!txt) return;
        tt.textContent = txt;
        tt.classList.add('show');
        // Posiciona: prefere ACIMA do "?" com alinhamento à ESQUERDA do painel
        // (evita corte à direita). Se não couber acima, coloca abaixo.
        const r = h.getBoundingClientRect();
        const ttW = Math.min(240, tt.offsetWidth || 240);
        const margin = 8;
        // horizontal: alinha à direita do "?" ancorando a borda direita do tooltip com a direita do "?"
        let left = r.right - ttW;
        if (left < margin) left = margin;
        if (left + ttW > window.innerWidth - margin) left = window.innerWidth - ttW - margin;
        // vertical: acima se cabe, senão abaixo
        let top = r.top - tt.offsetHeight - 6;
        if (top < margin) top = r.bottom + 6;
        tt.style.left = left + 'px';
        tt.style.top  = top + 'px';
      };
      const esconder = () => tt.classList.remove('show');
      h.addEventListener('mouseenter', mostrar);
      h.addEventListener('mouseleave', esconder);
      h.addEventListener('focus', mostrar);
      h.addEventListener('blur', esconder);
    });
  }

  // v11.0.0 — util pro log
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
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
    log('✅ MoveLines + Cota v11.0.4 (header: empresa · conta) carregado', 'ok');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();

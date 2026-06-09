// ==UserScript==
// @name         Conciliação de Cobranças — ConectaChip
// @namespace    naldo.conectachip.cobrancas
// @version      1.5.7
// @description  v1.5.7: auto-update migrado do gist para o repo tm-scripts-private-mirror
// @match        https://portal.conectachip.com.br/financeiro/movimentacoes_financeiras/index_recebimento*
// @match        https://portal.conectachip.com.br/contratos/gestao_assinaturas/servicos_recorrentes*
// @updateURL    https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/conciliacao-cobrancas.user.js
// @downloadURL  https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/conciliacao-cobrancas.user.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @run-at       document-idle
// ==/UserScript==

/*
CHANGELOG v1.5.6
────────────────────────────────────────────────────────
1. PUBLICAÇÃO EM GIST + AUTO-UPDATE
   - @updateURL e @downloadURL apontam pro gist secreto:
     https://gist.github.com/naldo-sat/ad5af71d0745289051bf909894e91511
   - Tampermonkey verifica atualização diariamente; quando @version bumpa,
     todos os PCs com o script instalado recebem update automático.
   - Fluxo pra atualizar daqui pra frente:
     1. Editar gist (cola novo conteúdo)
     2. Bumpar @version no header
     3. Aguardar até 24h (ou forçar via Tampermonkey → Installed → "Check for updates")

CHANGELOG v1.5.5
────────────────────────────────────────────────────────
1. BOTÃO "FILTRO" — toggle dos filtros de visualização
   - Botão azul "Filtro" injetado ao lado do "Gerar boletos/Pix"
     (Recebimento) e "Gerar faturas" (Serviços Recorrentes)
   - Por padrão, os botões "Todos/Verdes/Amarelos/Falhas/Sem cor"
     ficam ocultos (envoltos em #cr-filtros-wrapper)
   - Clique no botão → expande o wrapper na lateral
   - Clique de novo → recolhe
   - Botão muda visual (preenchido vs outline) conforme estado

CHANGELOG v1.5.4
────────────────────────────────────────────────────────
1. ITERAÇÃO DINÂMICA POR CHAVE — não usa mais snapshot de <tr>
   - Problema: em Serviços Recorrentes, gerar a fatura faz a linha sumir
     (filtro de data). O BootstrapVue re-renderiza a tabela e todos os <tr>
     da snapshot viram detached → "menu-nao-abriu" em série.
   - Fix: a cada iteração, busca a primeira linha cuja chave "Nº da assinatura"
     ainda não está em `processados` (Set por execução). Tolera re-render,
     reordenação e sumiço.
   - Não tenta mais aplicarCor() em <tr> desconectado (.isConnected check)

2. PERSISTÊNCIA — sobrevive a reload da página
   - GM_setValue('cr:faturas:run', {ativo, processados, res, paginaAtual})
     atualizado após cada linha
   - No init(): se houver run ativo da página atual, retoma automaticamente
     a partir do próximo Nº não processado
   - Limpa o storage ao finalizar normalmente ou ao clicar "Parar"

3. ZERO INTERFERÊNCIA NO USO MANUAL
   - initModalAutoConfirm com gating no topo: sai imediato se !gerandoBoletos
     && !gerandoFaturas. Modal de erro e modal de confirmação ficam intocados
     quando o usuário está usando a interface manualmente.
   - Comportamento: durante batch, intercepta erros e classifica. Fora do batch,
     o ERP se comporta exatamente como sem o script.

CHANGELOG v1.5.3
────────────────────────────────────────────────────────
1. "JÁ EXISTE RECEBIMENTO" — não é mais tratado como falha
   - initModalAutoConfirm classifica o texto do modal de erro:
     • regex /j[aá] existe.{0,40}recebimento/i → flag ultimoErroFoiJaGerado
     • qualquer outro erro → errosNaUltimaOp++ (continua sendo falha)
   - tentarGerarFaturaLinha retorna { ok:true, jaGerado:true } nesse caso
   - gerarFaturaLinha: SEM retry quando é jaGerado (evita loop e quebra de fluxo)
   - Linha marcada visualmente VERDE na tabela
   - Contador separado no modal de resumo (Já gerados / Sucessos / Falhas)
   - Painel de log mostra status "ja-gerado" em cinza-azulado

2. DELAY_POS_CONFIRM aumentado para 1800ms
   - Dá folga pro backend abrir o modal de erro antes da próxima linha

CHANGELOG v1.5.2
────────────────────────────────────────────────────────
1. RACE FIX — modal-confirmacao-nao-abriu mesmo quando funcionava
   - Causa: auto-confirm clicava "Sim" antes do polling detectar o modal
   - Fix: MutationObserver registrado ANTES do clique (captura abertura instantânea)
   - Fix: auto-confirm NÃO age mais em confirmações durante gerandoFaturas;
     o clique no "Sim" é feito explicitamente dentro do fluxo, depois que
     já confirmamos que o modal abriu. O auto-confirm continua fechando
     modais de ERRO normalmente.

2. NOVOS MOTIVOS DE FALHA
   - botao-sim-nao-encontrado: modal abriu mas sem botão value="true"

CHANGELOG v1.5.1
────────────────────────────────────────────────────────
1. ESPERA CONDICIONAL — sem timing chumbado
   - aguardarCondicao() faz polling até a condição valer ou estourar timeout
   - Cada etapa do fluxo de fatura espera o estado correto antes de prosseguir:
     • dropdown aberto (aria-expanded=true + .dropdown-menu presente)
     • submenu "Gerar" expandido (item "Fatura" presente no DOM)
     • modal de confirmação visível
     • modal sumiu (auto-confirm já clicou "Sim")

2. RETRY AUTOMÁTICO — 1 tentativa de fallback por linha
   - Se a primeira tentativa falhar (qualquer etapa), fecha dropdowns, espera 800ms,
     reabre o menu e tenta de novo
   - Se a segunda também falhar, ignora a linha, registra o motivo e segue
   - Nunca trava o batch inteiro

3. INTERVALO ENTRE LINHAS — 1000ms (era 350ms)
   - Dá folga pro backend GestãoClick processar antes do próximo trigger

4. LOGS VISÍVEIS — console + painel ao final
   - console.log estruturado por linha: nome do cliente, tentativa, status, motivo
   - Painel flutuante exibido ao final do batch com cada linha processada
   - Lista de falhas com motivo (menu-nao-abriu, item-fatura-nao-apareceu,
     modal-nao-fechou, erro-sistema-apos-confirm, etc)

CHANGELOG v1.5.0
────────────────────────────────────────────────────────
1. GERAR FATURAS EM MASSA — novo botão em Serviços Recorrentes
   - Posicionado ao lado de Buscar/Limpar (mesmo lugar do "Gerar Boletos/Pix" em Recebimento)
   - Itera todas as linhas de todas as páginas
   - Por linha: abre dropdown "Mais ações" → expande "Gerar" → clica "Fatura"
   - Modal "Deseja gerar?" auto-confirmado (initModalAutoConfirm estendido)
   - Detecção de falha: se modal de erro abrir após confirmação, conta como falha
   - Resumo final no mesmo modal usado pelo "Gerar Boletos"
   - Botão "Parar" interrompe entre linhas/páginas

CHANGELOG v1.4.0
────────────────────────────────────────────────────────
1. MULTI-PÁGINA — agora roda em Recebimento E Serviços Recorrentes
   - Detecta automaticamente a página pela URL (PAGES[])
   - Config por página: coluna do nome, seletor do valor, botão Gerar
   - "Recebimento": comportamento idêntico ao v1.3 (com botão Gerar Boletos/Pix)
   - "Serviços Recorrentes": coluna "Cliente" (em vez de "Entidade"), SEM botão Gerar

2. PAGINAÇÃO — robusta a layouts diferentes
   - Aceita <button class="page-link"> além de <a class="page-link">
   - Procura especificamente o botão "next" (›) ignorando "last page" (»)

3. NOME — renomeado para "Conciliação de Cobranças" (era "Contas a Receber")
   - @name e @namespace atualizados; storage do v1.3 fica órfão
     (re-importe a planilha após instalar)

CHANGELOG v1.3.0
────────────────────────────────────────────────────────
1. PERFORMANCE — planilha deixou de travar o sistema
2. GERAR BOLETOS — seletor e clique corrigidos
3. DIVERGÊNCIA INLINE — visível na tabela sem precisar de hover
4. PAGINAÇÃO COM FILTRO — painel flutuante multi-página
5. EXPORTAR NÃO ENCONTRADOS — entradas da planilha sem match no ERP
6. AUTO-CONFIRM MODAL — distingue erro × confirmação
────────────────────────────────────────────────────────
*/

(function () {
  'use strict';

  // ============================================================
  // CONFIG POR PÁGINA — detecta automaticamente pela URL
  // ============================================================
  const PAGES = [
    {
      id: 'recebimento',
      test: () => /\/financeiro\/movimentacoes_financeiras\/index_recebimento/.test(location.pathname),
      label: 'Recebimento',
      colNomeRegex: /^entidade$/i,
      colNomeFallbackSelector: 'td[aria-colindex="2"]',
      valorSelector: 'td.valor_soma, td[aria-colindex="8"]',
      hasGerarBoletos: true,
      exportName: 'Conciliações de recebimento',
    },
    {
      id: 'servicos',
      test: () => /\/contratos\/gestao_assinaturas\/servicos_recorrentes/.test(location.pathname),
      label: 'Serviços Recorrentes',
      colNomeRegex: /^cliente$/i,
      colNomeFallbackSelector: 'td[aria-colindex="3"]',
      valorSelector: 'td[aria-colindex="8"]',
      hasGerarBoletos: false,
      hasGerarFaturas: true,
      exportName: 'Conciliações de serviços recorrentes',
    },
  ];

  const PAGE = PAGES.find(p => p.test()) || PAGES[0];

  // ============================================================
  // SELETORES
  // ============================================================
  const SEL = {
    TABLE:      'table.b-table',
    ROWS:       'table.b-table tbody tr',
    BTN_BUSCAR: 'button[type="submit"].btn.mr-1.btn-success',
    PAGINATION: 'ul.b-pagination, ul.pagination',
  };

  const KEY_XLSX        = 'cr:planilha';
  const KEY_FATURAS_RUN = 'cr:faturas:run'; // persistência do batch de faturas
  const PFX_AUTO        = 'cr:auto:';
  const PFX_MANUAL      = 'cr:manual:';
  const PFX_FALHA       = 'cr:falha:';
  const MARKER_ENR = 'cr-enriched';
  const CLS_VERDE  = 'cr-match-verde';
  const CLS_AMAREL = 'cr-match-amarelo';
  const CLS_VERMELHO = 'cr-boleto-falha';
  const TOLERANCIA = 0.05;
  const FUZZY_MIN  = 0.85;

  // ──────────── Estado global ────────────
  let planilhaAtiva  = [];
  let planMap        = new Map();
  let matchCache     = new Map();
  let matchedPlanNomes = new Set();
  let cachedColNome  = -1;
  let gerandoBoletos = false;
  let gerandoFaturas = false;
  let errosNaUltimaOp = 0;          // incrementado pelo initModalAutoConfirm em erros reais
  let ultimoErroFoiJaGerado = false;// setado quando o modal de erro diz "Já existe recebimento"
  const RE_JA_GERADO = /j[aá] existe.{0,40}recebimento/i;
  let filtroVis      = 'todos';
  let carregandoPags = false;

  const IC_GERAR_ALL = 'i[title="Gerar cobrança na Asaas"], i[title="Gerar pix na Asaas"]';

  // ============================================================
  // COLUNAS DINÂMICAS — usa regex da config da página
  // ============================================================
  function detectarColunas() {
    const ths = [...document.querySelectorAll(`${SEL.TABLE} thead th`)];
    cachedColNome = -1;
    ths.forEach((th, i) => {
      const txt = th.textContent.trim().replace(/\s+/g,' ').split('(')[0].trim();
      if (PAGE.colNomeRegex.test(txt)) cachedColNome = i;
    });
  }

  function getTDNome(tr)  {
    if (cachedColNome >= 0 && tr.cells[cachedColNome]) return tr.cells[cachedColNome];
    return tr.querySelector(PAGE.colNomeFallbackSelector) || tr.cells[1] || null;
  }
  function getTDValor(tr) {
    return tr.querySelector(PAGE.valorSelector) || null;
  }
  function getCellText(td) {
    if (!td) return '';
    const clone = td.cloneNode(true);
    clone.querySelectorAll('.cr-diverg').forEach(el => el.remove());
    return clone.textContent.trim();
  }
  const getNomeERP  = tr => getCellText(getTDNome(tr))  || '';
  const getValorERP = tr => getCellText(getTDValor(tr)) || '0';

  // ============================================================
  // HASH
  // ============================================================
  function hashLinha(tr) {
    const nome = getNomeERP(tr);
    const val  = getValorERP(tr);
    const dat  = [...tr.cells].find(td => /^\d{2}\/\d{2}\/\d{4}$/.test(td.textContent.trim()))?.textContent.trim() || '';
    return `${nome}|${val}|${dat}`;
  }

  // ============================================================
  // NORMALIZAÇÃO
  // ============================================================
  const normNome = s =>
    String(s || '').toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim();

  const normValorNum = s =>
    parseFloat(String(s || '0').replace(/\./g, '').replace(',', '.')) || 0;

  function extractValorPlano(text) {
    const m = String(text || '').match(/\d+[.,]\d{2}/);
    if (m) return parseFloat(m[0].replace(',', '.'));
    const m2 = String(text || '').match(/\d+[.,]\d+/);
    return m2 ? parseFloat(m2[0].replace(',', '.')) : null;
  }

  // ============================================================
  // LEVENSHTEIN
  // ============================================================
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const curr = [i];
      for (let j = 1; j <= b.length; j++)
        curr[j] = a[i-1] === b[j-1] ? prev[j-1] : 1 + Math.min(prev[j], curr[j-1], prev[j-1]);
      prev = curr;
    }
    return prev[b.length];
  }

  function nomeSimilar(a, b) {
    if (!a || !b) return false;
    const maxLen = Math.max(a.length, b.length);
    return maxLen > 0 && (1 - levenshtein(a, b) / maxLen) >= FUZZY_MIN;
  }

  // ============================================================
  // PLAN MAP
  // ============================================================
  function buildPlanMap() {
    planMap.clear();
    matchCache.clear();
    matchedPlanNomes.clear();
    planilhaAtiva.forEach(row => {
      const key = normNome(row.nome);
      if (!planMap.has(key)) planMap.set(key, row);
    });
  }

  // ============================================================
  // MATCH
  // ============================================================
  function matchComPlanilha(tr) {
    if (!planilhaAtiva.length) return { estado: null };

    const h = hashLinha(tr);
    if (matchCache.has(h)) return matchCache.get(h);

    const erpNome = normNome(getNomeERP(tr));
    const erpVal  = normValorNum(getValorERP(tr));

    let row = null, exactNome = false;

    if (planMap.has(erpNome)) {
      row = planMap.get(erpNome);
      exactNome = true;
    } else {
      for (const [planNome, r] of planMap) {
        if (nomeSimilar(planNome, erpNome)) { row = r; exactNome = false; break; }
      }
    }

    if (!row) {
      const result = { estado: null };
      matchCache.set(h, result);
      return result;
    }

    matchedPlanNomes.add(normNome(row.nome));

    const planVal  = row.valorNum;
    let valorOk    = false;
    if (planVal !== null) {
      const avg = (Math.abs(planVal) + Math.abs(erpVal)) / 2;
      valorOk   = avg > 0 ? Math.abs(planVal - erpVal) / avg <= TOLERANCIA : Math.abs(planVal - erpVal) < 0.005;
    }

    const estado  = (exactNome && valorOk) ? 'verde' : 'amarelo';
    const result  = { estado, planNome: row.nome, planVal: row.planRaw, exactNome, valorOk };
    matchCache.set(h, result);
    return result;
  }

  // ============================================================
  // STORAGE
  // ============================================================
  function getAutoState(tr)  { try { return GM_getValue(PFX_AUTO   + hashLinha(tr))?.state || null; } catch { return null; } }
  function isManual(tr)      { try { return !!GM_getValue(PFX_MANUAL + hashLinha(tr))?.marked; } catch { return false; } }

  function setAutoState(tr, state) {
    const h = hashLinha(tr);
    try { state ? GM_setValue(PFX_AUTO+h,{state,savedAt:Date.now()}) : GM_deleteValue(PFX_AUTO+h); } catch {}
  }
  function toggleManual(tr) {
    const h = hashLinha(tr);
    try { isManual(tr) ? GM_deleteValue(PFX_MANUAL+h) : GM_setValue(PFX_MANUAL+h,{marked:true,savedAt:Date.now()}); } catch {}
  }

  function corFinal(tr) { return isManual(tr) ? 'verde' : (getAutoState(tr) || null); }

  function limparAutoStates() { try { GM_listValues().forEach(k=>{ if(k.startsWith(PFX_AUTO)) GM_deleteValue(k); }); } catch {} }
  function limparTudo() {
    try { GM_listValues().forEach(k=>{ if(k.startsWith(PFX_AUTO)||k.startsWith(PFX_MANUAL)||k.startsWith(PFX_FALHA)) GM_deleteValue(k); }); } catch {}
    try { GM_deleteValue(KEY_XLSX); } catch {}
    planilhaAtiva=[]; planMap.clear(); matchCache.clear(); matchedPlanNomes.clear();
  }

  function setFalha(tr, motivo) {
    const h = hashLinha(tr);
    try { GM_setValue(PFX_FALHA+h, {motivo:motivo||'', savedAt:Date.now()}); } catch {}
    tr.classList.add(CLS_VERMELHO);
    tr.dataset.crFalha = '1';
  }
  function isFalha(tr)      { try { return !!GM_getValue(PFX_FALHA+hashLinha(tr)); } catch { return false; } }
  function getMotivoFalha(tr){ try { return GM_getValue(PFX_FALHA+hashLinha(tr))?.motivo||''; } catch { return ''; } }
  function restaurarFalhas() {
    document.querySelectorAll(SEL.ROWS).forEach(tr => {
      if(isFalha(tr)){ tr.classList.add(CLS_VERMELHO); tr.dataset.crFalha='1'; }
    });
  }

  function carregarPlanilha() { try { const v=GM_getValue(KEY_XLSX); return v?JSON.parse(v):[]; } catch { return []; } }
  function salvarPlanilha(d)  { try { GM_setValue(KEY_XLSX,JSON.stringify(d)); } catch {} }

  // ============================================================
  // VISUAL
  // ============================================================
  function aplicarCor(tr, cor) {
    if (!tr || !tr.isConnected) return; // <tr> pode estar detached após re-render da tabela
    tr.classList.remove(CLS_VERDE, CLS_AMAREL);
    if (cor === 'verde')   tr.classList.add(CLS_VERDE);
    if (cor === 'amarelo') tr.classList.add(CLS_AMAREL);
    tr.dataset.crCor = cor || 'none';
  }

  function aplicarDivergInline(tr, matchResult) {
    tr.querySelectorAll('.cr-diverg').forEach(el => el.remove());
    if (!matchResult || matchResult.estado !== 'amarelo') return;

    const { exactNome, valorOk, planNome, planVal } = matchResult;

    if (!exactNome && planNome) {
      const td = getTDNome(tr);
      if (td) {
        const div = document.createElement('div');
        div.className = 'cr-diverg';
        div.textContent = planNome;
        td.appendChild(div);
        td.title = `📋 Planilha: "${planNome}"`;
      }
    }
    if (!valorOk && planVal) {
      const td = getTDValor(tr);
      if (td) {
        const div = document.createElement('div');
        div.className = 'cr-diverg';
        div.textContent = planVal;
        td.appendChild(div);
        td.title = `📋 Planilha: ${planVal}`;
      }
    }
  }

  function contarVerdes()   { return [...document.querySelectorAll(`${SEL.ROWS}.${CLS_VERDE}`)].length; }
  function contarAmarelos() { return [...document.querySelectorAll(`${SEL.ROWS}.${CLS_AMAREL}`)].length; }
  function contarVermelhos(){ return [...document.querySelectorAll(`${SEL.ROWS}.${CLS_VERMELHO}`)].length; }

  function atualizarBadge() {
    const bV=document.getElementById('cr-badge-verde'), bA=document.getElementById('cr-badge-amarelo'), bR=document.getElementById('cr-badge-vermelho');
    const v=contarVerdes(), a=contarAmarelos(), r=contarVermelhos();
    if(bV){bV.textContent=`✓ ${v}`;bV.style.display=v?'inline-block':'none';}
    if(bA){bA.textContent=`⚠ ${a}`;bA.style.display=a?'inline-block':'none';}
    if(bR){bR.textContent=`✕ ${r}`;bR.style.display=r?'inline-block':'none';}
  }

  // ============================================================
  // TOAST
  // ============================================================
  function toast(msg,ok=true){
    let t=document.querySelector('.cr-toast');
    if(!t){t=document.createElement('div');t.className='cr-toast';document.body.appendChild(t);}
    t.innerHTML=msg;t.style.background=ok?'#28a745':'#dc3545';
    t.classList.add('show');clearTimeout(t._t);
    t._t=setTimeout(()=>t.classList.remove('show'),4500);
  }

  // ============================================================
  // ENRIQUECER LINHAS
  // ============================================================
  function enriquecerLinha(tr) {
    const match     = matchComPlanilha(tr);
    const autoSalvo = getAutoState(tr);
    if (match.estado !== autoSalvo) setAutoState(tr, match.estado);

    aplicarCor(tr, corFinal(tr));
    aplicarDivergInline(tr, match);

    if (tr.classList.contains(MARKER_ENR)) return;
    tr.classList.add(MARKER_ENR);

    tr.addEventListener('click', ev => {
      if (ev.target.closest('button,a.btn,.btn-group,input[type="checkbox"]')) return;
      toggleManual(tr);
      aplicarCor(tr, corFinal(tr));
      atualizarBadge();
    });
  }

  function enriquecerNovasLinhas() {
    const novas = [...document.querySelectorAll(`${SEL.ROWS}:not(.${MARKER_ENR})`)];
    if (!novas.length) return;
    detectarColunas();
    novas.forEach(enriquecerLinha);
    aplicarFiltroVis();
    atualizarBadge();
  }

  function enriquecerTabela() {
    detectarColunas();
    document.querySelectorAll(SEL.ROWS).forEach(enriquecerLinha);
  }

  function reaplicarTodasLinhas() {
    matchCache.clear();
    detectarColunas();
    document.querySelectorAll(SEL.ROWS).forEach(tr => {
      const match = matchComPlanilha(tr);
      setAutoState(tr, match.estado);
      aplicarCor(tr, corFinal(tr));
      aplicarDivergInline(tr, match);
    });
    aplicarFiltroVis();
    atualizarBadge();
  }

  // ============================================================
  // FILTRO DE VISUALIZAÇÃO
  // ============================================================
  function deveExibir(tr) {
    const cor = tr.dataset.crCor;
    const falha = tr.dataset.crFalha === '1';
    if (filtroVis === 'verde')    return cor === 'verde'   && !falha;
    if (filtroVis === 'amarelo')  return cor === 'amarelo' && !falha;
    if (filtroVis === 'sem-cor')  return (!cor || cor === 'none') && !falha;
    if (filtroVis === 'falha')    return falha;
    return true;
  }

  function aplicarFiltroVis() {
    document.querySelectorAll(SEL.ROWS).forEach(tr => {
      tr.style.display = deveExibir(tr) ? '' : 'none';
    });
    ['todos','verde','amarelo','sem-cor','falha'].forEach(k => {
      document.getElementById(`cr-fviz-${k}`)?.classList.toggle('cr-fviz-ativo', filtroVis===k);
    });
  }

  // ============================================================
  // PAINEL MULTI-PÁGINA
  // ============================================================
  const esperar = ms => new Promise(r => setTimeout(r, ms));

  function aguardarAtualizacaoTabela(ms=3500) {
    return new Promise(res => {
      const tbody=document.querySelector(`${SEL.TABLE} tbody`);
      if(!tbody){setTimeout(res,ms);return;}
      let ok=false;
      const obs=new MutationObserver(()=>{if(!ok){ok=true;obs.disconnect();setTimeout(res,400);}});
      obs.observe(tbody,{childList:true,subtree:true});
      setTimeout(()=>{obs.disconnect();res();},ms);
    });
  }

  // Procura especificamente o botão "next" (›) ignorando "last page" (»)
  function proximaPaginaBtn() {
    const pag = document.querySelector(SEL.PAGINATION);
    if (!pag) return null;
    const items = [...pag.querySelectorAll('li.page-item:not(.disabled)')];
    if (!items.length) return null;

    for (const li of items) {
      const btn = li.querySelector('a.page-link, button.page-link');
      if (!btn) continue;
      const txt = btn.textContent.trim();
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (txt === '›') return btn;
      if (/next/.test(label) && !/last/.test(label)) return btn;
      if (/próx/.test(label) && !/últim/.test(label)) return btn;
    }

    // Fallback: último item habilitado não-numérico e não-«/‹/»
    const lastLi = items[items.length-1];
    const last = lastLi?.querySelector('a.page-link, button.page-link');
    if (!last) return null;
    const txt = last.textContent.trim();
    if (!/^\d+$/.test(txt) && txt !== '«' && txt !== '‹' && txt !== '»') return last;
    return null;
  }

  function coletarLinhasAtivas() {
    const dados=[];
    document.querySelectorAll(SEL.ROWS).forEach(tr=>{
      if(!deveExibir(tr))return;
      const cor=tr.dataset.crCor;
      const row={nome:getNomeERP(tr),valor:getValorERP(tr),cor};
      if(cor==='amarelo'){
        const m=matchComPlanilha(tr);
        row.planNome  = m?.planNome  || '';
        row.planVal   = m?.planVal   || '';
        row.exactNome = m?.exactNome !== false;
        row.valorOk   = m?.valorOk   !== false;
      }
      dados.push(row);
    });
    return dados;
  }

  function mostrarPainelResultados(tipo, rows) {
    document.getElementById('cr-painel')?.remove();

    const isAmarelo = tipo === 'amarelo';
    const icon = isAmarelo ? '⚠' : '○';
    const tit  = isAmarelo ? 'Linhas com divergência' : 'Sem correspondência';

    const thHtml = isAmarelo
      ? '<th>Nome no ERP</th><th>Valor ERP</th><th>Na planilha</th>'
      : '<th>Nome no ERP</th><th>Valor</th>';

    const trHtml = rows.map(r => {
      if (isAmarelo) {
        const nomeCell = r.nome + (!r.exactNome && r.planNome
          ? `<div class="cr-painel-sub">${r.planNome}</div>` : '');
        const vERP  = `<span${!r.valorOk?' style="color:#c0392b;font-weight:600"':''}>${r.valor}</span>`;
        const vPlan = `<span${!r.valorOk?' style="color:#155724;font-weight:600"':''}>${r.planVal||'—'}</span>`;
        return `<tr><td>${nomeCell}</td><td>${vERP}</td><td>${vPlan}</td></tr>`;
      } else {
        return `<tr><td>${r.nome}</td><td>${r.valor}</td></tr>`;
      }
    }).join('');

    const panel = document.createElement('div');
    panel.id = 'cr-painel';
    panel.innerHTML = `
      <div class="cr-painel-header">
        <span>${icon} ${tit} — <b>${rows.length}</b> encontrada${rows.length!==1?'s':''} em todas as páginas</span>
        <button class="cr-painel-close" title="Fechar">✕</button>
      </div>
      <div class="cr-painel-body">
        <table class="cr-painel-table">
          <thead><tr>${thHtml}</tr></thead>
          <tbody>${trHtml}</tbody>
        </table>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector('.cr-painel-close').addEventListener('click', () => panel.remove());
  }

  async function ativarFiltroComCarregamento(tipo) {
    filtroVis = tipo;

    if (tipo !== 'amarelo' && tipo !== 'sem-cor') {
      aplicarFiltroVis();
      return;
    }

    if (carregandoPags) return;
    carregandoPags = true;

    const btnFiltro = document.getElementById(`cr-fviz-${tipo}`);
    if (btnFiltro) { btnFiltro.innerHTML = '⏳'; btnFiltro.disabled = true; }

    const allRows = [];
    let paginas = 0;

    enriquecerTabela();
    aplicarFiltroVis();
    allRows.push(...coletarLinhasAtivas());

    while (paginas < 15) {
      const nextBtn = proximaPaginaBtn();
      if (!nextBtn) break;
      nextBtn.click();
      await aguardarAtualizacaoTabela(4000);
      enriquecerTabela();
      aplicarFiltroVis();
      allRows.push(...coletarLinhasAtivas());
      paginas++;
    }

    carregandoPags = false;
    if (btnFiltro) {
      const labels = {'amarelo':'⚠ Amarelos','sem-cor':'○ Sem cor'};
      btnFiltro.innerHTML = labels[tipo] || tipo;
      btnFiltro.disabled = false;
    }

    atualizarBadge();

    if (allRows.length > 0) {
      mostrarPainelResultados(tipo, allRows);
      toast(`${allRows.length} item${allRows.length!==1?'s':''} encontrado${allRows.length!==1?'s':''}${paginas>0?` em ${paginas+1} páginas`:''}`);
    } else {
      toast(`Nenhum item "${tipo}" encontrado`);
    }
  }

  // ============================================================
  // IMPORTAR XLSX — detecção robusta de cabeçalho
  // ============================================================
  function importarXLSX() {
    if(typeof XLSX==='undefined'){toast('SheetJS não carregado',false);return;}
    const input=document.createElement('input');
    input.type='file';input.accept='.xlsx,.xls';input.style.display='none';
    document.body.appendChild(input);
    input.addEventListener('change',()=>{
      const file=input.files?.[0];if(!file){input.remove();return;}
      const reader=new FileReader();
      reader.onload=e=>{
        try{
          const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
          const ws=wb.Sheets[wb.SheetNames[0]];
          const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
          if(rows.length<2){toast('Planilha vazia',false);return;}

          // Correspondência parcial em até 10 linhas — tolera títulos mesclados no topo
          let hRow=-1, iNome=-1, iValor=-1;

          for(let i=0;i<Math.min(10,rows.length);i++){
            const h=rows[i].map(c=>String(c==null?'':c).toLowerCase().trim());
            const n=h.findIndex(c=>c&&/empresa|^nome$|cliente|entidade|favorecido/.test(c));
            const v=h.findIndex(c=>c&&/^plano$|^valor$|mensalidade|^vlr$|^total$/.test(c));
            if(n>=0&&v>=0){hRow=i;iNome=n;iValor=v;break;}
          }

          // Fallback: cabeçalho não nomeado → detectar por conteúdo
          if(hRow<0){
            for(let i=0;i<Math.min(10,rows.length);i++){
              const r=rows[i].filter(c=>c!==''&&c!==null&&c!==undefined);
              if(r.length>=2){hRow=i;break;}
            }
            hRow=Math.max(hRow,0);
            iNome=0;
            const dRow=rows[hRow+1]||[];
            iValor=1;
            for(let c=1;c<dRow.length;c++){
              const v=parseFloat(String(dRow[c]||'').replace(',','.'));
              if(!isNaN(v)&&v>0){iValor=c;break;}
            }
          }

          const data=[];
          for(let i=hRow+1;i<rows.length;i++){
            const row=rows[i];
            const nome=String(row[iNome]||'').trim();
            const planRaw=String(row[iValor]||'').trim();
            if(!nome)continue;
            data.push({nome,planRaw,valorNum:extractValorPlano(planRaw)});
          }
          if(!data.length){toast('Nenhum dado encontrado na planilha',false);return;}
          limparAutoStates();
          planilhaAtiva=data;
          buildPlanMap();
          salvarPlanilha(data);
          reaplicarTodasLinhas();
          const v=contarVerdes(),a=contarAmarelos();
          toast(`${data.length} registros importados · ✓ ${v} verde${v!==1?'s':''} · ⚠ ${a} amarelo${a!==1?'s':''}`);
        }catch(err){console.error('[CR]',err);toast('Erro ao ler o arquivo',false);}
        input.remove();
      };
      reader.readAsArrayBuffer(file);
    });
    input.click();
  }

  // ============================================================
  // EXPORTAR NÃO ENCONTRADOS
  // ============================================================
  function exportarNaoEncontrados(){
    if(typeof XLSX==='undefined'){toast('SheetJS não carregado',false);return;}
    if(!planilhaAtiva.length){toast('Nenhuma planilha importada',false);return;}

    const naoEncontrados=planilhaAtiva.filter(row=>!matchedPlanNomes.has(normNome(row.nome)));
    if(!naoEncontrados.length){
      toast('Todos os registros da planilha foram encontrados no ERP!');
      return;
    }

    const aoa=[['Nome do cliente','Valor na planilha']];
    naoEncontrados.forEach(row=>aoa.push([row.nome,row.planRaw]));

    const ws=XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols']=[{wch:40},{wch:18}];
    const hS={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'495057'},patternType:'solid'}};
    const rS={fill:{fgColor:{rgb:'F8F9FA'},patternType:'solid'}};
    for(let c=0;c<2;c++){const r=XLSX.utils.encode_cell({r:0,c});if(ws[r])ws[r].s={...hS};}
    for(let r=1;r<aoa.length;r++)for(let c=0;c<2;c++){
      const ref=XLSX.utils.encode_cell({r,c});if(!ws[ref])ws[ref]={v:'',t:'s'};ws[ref].s={...rS};
    }

    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Não encontrados');
    const out=XLSX.write(wb,{bookType:'xlsx',type:'array',cellStyles:true});
    const dataFiltro=getDataFiltro();
    const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement('a'),{
      href:url,download:`Não encontrados — ${dataFiltro}.xlsx`,style:'display:none',
    });
    document.body.appendChild(a);a.click();
    setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1000);
    toast(`${naoEncontrados.length} não encontrado${naoEncontrados.length!==1?'s':''} exportado${naoEncontrados.length!==1?'s':''}`);
  }

  function getDataFiltro() {
    try {
      const url = new URL(location.href);
      const di  = decodeURIComponent(url.searchParams.get('data_inicio') || '');
      const df  = decodeURIComponent(url.searchParams.get('data_fim')    || '');
      if (di && df && di === df) return di.replace(/\//g, '-');
      if (di && df) return `${di.replace(/\//g,'-')} a ${df.replace(/\//g,'-')}`;
      if (di) return di.replace(/\//g, '-');
      if (df) return df.replace(/\//g, '-');
    } catch {}
    return `${String(new Date().getDate()).padStart(2,'0')}-${String(new Date().getMonth()+1).padStart(2,'0')}-${new Date().getFullYear()}`;
  }

  function situacaoParaTexto(tr) {
    if (tr.dataset.crFalha === '1') {
      const motivo = getMotivoFalha(tr);
      return motivo ? `Falha: ${motivo}` : 'Falha na geração';
    }
    const cor = tr.dataset.crCor;
    if (cor === 'verde') return 'Conciliado';
    if (cor === 'amarelo') {
      const match = matchComPlanilha(tr);
      if (match.estado === 'amarelo') {
        const parts = [];
        if (!match.exactNome) parts.push('nome');
        if (!match.valorOk)   parts.push('valor');
        return parts.length ? `Divergente (${parts.join(' e ')})` : 'Divergente';
      }
    }
    return '';
  }

  function exportarXLSX(){
    if(typeof XLSX==='undefined'){toast('SheetJS não carregado',false);return;}
    const rows=[
      ...document.querySelectorAll(`${SEL.ROWS}.${CLS_VERDE}`),
      ...document.querySelectorAll(`${SEL.ROWS}.${CLS_AMAREL}`),
      ...document.querySelectorAll(`${SEL.ROWS}.${CLS_VERMELHO}`),
    ];
    if(!rows.length){toast('Nenhuma linha para exportar',false);return;}

    const aoa=[['Nome do cliente','Valor','Situação']];
    rows.forEach(tr=>aoa.push([
      getNomeERP(tr),
      getValorERP(tr),
      situacaoParaTexto(tr),
    ]));

    const ws=XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols']=[{wch:40},{wch:12},{wch:34}];

    const hS={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'2157D9'},patternType:'solid'}};
    const vS={fill:{fgColor:{rgb:'D4EDDA'},patternType:'solid'}};
    const aS={fill:{fgColor:{rgb:'FFF3CD'},patternType:'solid'}};
    const rS={fill:{fgColor:{rgb:'F8D7DA'},patternType:'solid'}};

    for(let c=0;c<3;c++){const r=XLSX.utils.encode_cell({r:0,c});if(ws[r])ws[r].s={...hS};}
    for(let r=1;r<aoa.length;r++){
      const sit=aoa[r][2];
      const rowStyle=sit==='Conciliado'?vS:sit.startsWith('Divergente')?aS:sit.startsWith('Falha')?rS:{};
      for(let c=0;c<3;c++){
        const ref=XLSX.utils.encode_cell({r,c});
        if(!ws[ref])ws[ref]={v:'',t:'s'};
        if(Object.keys(rowStyle).length)ws[ref].s={...rowStyle};
      }
    }

    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Conciliações');
    const out=XLSX.write(wb,{bookType:'xlsx',type:'array',cellStyles:true});
    const dataFiltro=getDataFiltro();
    const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement('a'),{
      href:url,download:`${PAGE.exportName} — ${dataFiltro}.xlsx`,style:'display:none',
    });
    document.body.appendChild(a);a.click();
    setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1000);
    toast('Excel exportado!');
  }

  // ============================================================
  // GERAR BOLETOS (só usado em Recebimento)
  // ============================================================
  function mostrarModalResumo(res) {
    document.getElementById('cr-modal-resumo')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'cr-modal-resumo';
    overlay.innerHTML = `
      <div class="cr-resumo-box">
        <div class="cr-resumo-header">Resumo da geração</div>
        <div class="cr-resumo-body">
          <div class="cr-resumo-item cr-resumo-verde">✅ Gerados com sucesso: <b>${res.sucesso}</b></div>
          <div class="cr-resumo-item cr-resumo-vermelho">❌ Falhas: <b>${res.falha}</b></div>
          <div class="cr-resumo-item cr-resumo-cinza">⏭ Já gerados (ignorados): <b>${res.jaGerado}</b></div>
        </div>
        <div class="cr-resumo-footer">
          <button class="btn btn-primary" id="cr-resumo-fechar">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('cr-resumo-fechar').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  async function detectarMotivoErro(ic) {
    await esperar(200);
    if (ic.title && ic.title !== 'Gerar cobrança na Asaas' && ic.title !== 'Gerar pix na Asaas')
      return ic.title.trim();
    const erros = [...document.querySelectorAll('.alert-danger, .b-toaster .b-toast, .toast-body')];
    for (const el of erros) {
      const txt = el.textContent.trim();
      if (txt && txt.length < 300) return txt;
    }
    const modalBody = document.querySelector('.modal-body');
    if (modalBody) {
      const txt = modalBody.textContent.trim();
      if (txt && !txt.includes('Deseja gerar') && txt.length < 300) return txt;
    }
    return '';
  }

  async function aguardarMudancaIcone(ic, ms=4500) {
    return new Promise(res => {
      const obs = new MutationObserver(() => {
        if (ic.classList.contains('text-success') || ic.classList.contains('text-danger') ||
            !ic.classList.contains('cursor-pointer')) {
          obs.disconnect(); res();
        }
      });
      obs.observe(ic, { attributes: true, attributeFilter: ['class','title'] });
      setTimeout(() => { obs.disconnect(); res(); }, ms);
    });
  }

  async function gerarCobranças() {
    if(gerandoBoletos){
      gerandoBoletos=false;
      atualizarBtnGerar('<i class="fa fa-file-text-o"></i> Gerar boletos / Pix','#2157d9');
      toast('Processo interrompido');
      return;
    }
    gerandoBoletos=true;
    atualizarBtnGerar('<i class="fa fa-stop"></i> Parar','#dc3545');

    const res = { sucesso:0, falha:0, jaGerado:0 };
    let totalPaginas = 0;

    while(gerandoBoletos){
      totalPaginas++;

      const jaGeradosNaPag = [...document.querySelectorAll('i[title^="Cobrança gerada"], i[title^="Pix gerado"]')].length;
      res.jaGerado += jaGeradosNaPag;

      const icones = [...document.querySelectorAll(IC_GERAR_ALL)]
        .filter(ic => !ic.classList.contains('text-success') && !ic.classList.contains('text-danger'));

      toast(`Página ${totalPaginas}: ${icones.length} cobrança${icones.length!==1?'s':''} a gerar...`);

      for(const ic of icones){
        if(!gerandoBoletos)break;

        ic.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,composed:true}));
        await aguardarMudancaIcone(ic, 4500);

        if (ic.classList.contains('text-success')) {
          res.sucesso++;
        } else if (ic.classList.contains('text-danger')) {
          res.falha++;
          const motivo = (ic.title && ic.title !== 'Gerar cobrança na Asaas' && ic.title !== 'Gerar pix na Asaas')
            ? ic.title.trim()
            : await detectarMotivoErro(ic);
          const tr = ic.closest('tr');
          if (tr) setFalha(tr, motivo);
        }
        await esperar(300);
      }

      if(!gerandoBoletos)break;

      const nextBtn=proximaPaginaBtn();
      if(!nextBtn)break;
      nextBtn.click();
      await aguardarAtualizacaoTabela(3500);
    }

    gerandoBoletos=false;
    atualizarBtnGerar('<i class="fa fa-file-text-o"></i> Gerar boletos / Pix','#2157d9');
    atualizarBadge();
    mostrarModalResumo(res);
  }

  function initModalAutoConfirm() {
    const obs = new MutationObserver(() => {
      // GATING: zero interferência se nenhum batch está rodando
      // Isso permite ao usuário usar o ERP manualmente sem intercepção.
      if (!gerandoBoletos && !gerandoFaturas) return;

      const modal = document.querySelector('#modal-dialog___BV_modal_content_');
      if (!modal) return;

      const isError   = !!modal.querySelector('.modal-title.text-danger');
      const isConfirm = !!modal.querySelector('.modal-title.text-primary');

      if (isError) {
        // Classificar o motivo pelo texto do modal — "Já existe recebimento" NÃO é falha
        const txt = (modal.querySelector('.modal-body')?.textContent || '').trim();
        const jaGerado = RE_JA_GERADO.test(txt);

        if (gerandoBoletos || gerandoFaturas) {
          if (jaGerado) ultimoErroFoiJaGerado = true;
          else errosNaUltimaOp++;
        }

        const okBtn = modal.querySelector('button[value="true"], button.btn-primary');
        if (okBtn && !okBtn.dataset.crAutoClose) {
          okBtn.dataset.crAutoClose = '1';
          setTimeout(() => okBtn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})), 200);
        }
      } else if (isConfirm && gerandoBoletos) {
        // Boletos: auto-confirm legado (clique automático no "Sim")
        // Faturas: NÃO tratamos aqui — o clique no "Sim" é explícito dentro do fluxo
        //         (evita race entre auto-confirm e detecção do modal)
        const simBtn = modal.querySelector('button[value="true"]');
        if (simBtn && !simBtn.dataset.crAuto) {
          simBtn.dataset.crAuto = '1';
          setTimeout(() => simBtn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})), 150);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function atualizarBtnGerar(html, bg) {
    const btn = document.getElementById('cr-btn-gerar');
    if (!btn) return;
    btn.innerHTML = html;
    btn.style.background = bg; btn.style.borderColor = bg;
  }

  function atualizarBtnGerarFaturas(html, bg) {
    const btn = document.getElementById('cr-btn-gerar-faturas');
    if (!btn) return;
    btn.innerHTML = html;
    btn.style.background = bg; btn.style.borderColor = bg;
  }

  // ============================================================
  // GERAR FATURAS EM MASSA (Serviços Recorrentes) — v1.5.1
  // Espera condicional + retry + log estruturado
  // ============================================================

  const DELAY_ENTRE_LINHAS = 1000; // ms entre tentativas (cliente -> cliente)
  const DELAY_RETRY        = 800;  // ms antes de tentar de novo após falha
  const TIMEOUT_MENU       = 2000; // ms aguardando dropdown abrir
  const TIMEOUT_SUBMENU    = 2500; // ms aguardando item "Fatura" aparecer
  const TIMEOUT_MODAL_OPEN = 4000; // ms aguardando modal de confirmação
  const TIMEOUT_MODAL_CLOSE= 10000;// ms aguardando modal sumir após auto-confirm
  const DELAY_POS_CONFIRM  = 1800; // ms esperando possível modal de erro do backend

  // Log estruturado por linha (visível no console + painel ao final)
  let logFaturas = []; // [{nome, status:'ok'|'falha'|'ja-gerado', tentativas, motivo}]

  // Chave única da linha — número da assinatura (coluna 2)
  // Tolerante a re-render: a chave é o conteúdo da célula, não a referência DOM.
  function chaveLinha(tr) {
    if (!tr) return '';
    const td = tr.querySelector('td[aria-colindex="2"]');
    return (td?.textContent || '').trim();
  }

  // Persistência leve do batch de faturas (sobrevive a reload)
  function salvarProgressoFaturas(state) {
    try { GM_setValue(KEY_FATURAS_RUN, JSON.stringify(state)); } catch {}
  }
  function carregarProgressoFaturas() {
    try { const v = GM_getValue(KEY_FATURAS_RUN); return v ? JSON.parse(v) : null; }
    catch { return null; }
  }
  function limparProgressoFaturas() {
    try { GM_deleteValue(KEY_FATURAS_RUN); } catch {}
  }

  function aguardarCondicao(check, ms, interval = 80) {
    return new Promise(async res => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const r = check();
        if (r) return res(r);
        await esperar(interval);
      }
      res(null);
    });
  }

  function buscarItemFatura(scope) {
    const candidatos = [
      ...(scope ? scope.querySelectorAll('a.dropdown-item') : []),
      ...document.querySelectorAll('.btn-mais-acoes .dropdown-menu a.dropdown-item, .b-dropdown .dropdown-menu a.dropdown-item'),
    ];
    return candidatos.find(a => a.textContent.trim() === 'Fatura' && a.offsetParent !== null) || null;
  }

  async function abrirDropdownLinha(tr) {
    const trigger = tr.querySelector('.btn-mais-acoes button.dropdown-toggle');
    if (!trigger) return { trigger: null, menu: null };

    if (trigger.getAttribute('aria-expanded') !== 'true') {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    const menu = await aguardarCondicao(() => {
      if (trigger.getAttribute('aria-expanded') !== 'true') return null;
      return tr.querySelector('.btn-mais-acoes .dropdown-menu');
    }, TIMEOUT_MENU);

    return { trigger, menu };
  }

  async function expandirSubmenuGerar(menu) {
    if (!menu) return null;
    const headerGerar = [...menu.querySelectorAll('header.dropdown-header')]
      .find(h => /Gerar/i.test(h.textContent.trim()));
    if (!headerGerar) return null;
    const liGerar = headerGerar.closest('li') || headerGerar;
    liGerar.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    return aguardarCondicao(() => buscarItemFatura(menu), TIMEOUT_SUBMENU);
  }

  // Detecta abertura do modal via MutationObserver — registrar ANTES do clique
  // para capturar até modais que abrem e fecham em milissegundos.
  function criarWatcherModal() {
    let modalAtual = document.querySelector('#modal-dialog___BV_modal_content_');
    let abriuDepoisDeRegistrar = !!modalAtual;
    let fechouDepoisDeAbrir = false;

    const obs = new MutationObserver(() => {
      const m = document.querySelector('#modal-dialog___BV_modal_content_');
      if (m && !modalAtual) { modalAtual = m; abriuDepoisDeRegistrar = true; }
      else if (!m && modalAtual) { modalAtual = null; fechouDepoisDeAbrir = true; }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return {
      getModal: () => modalAtual,
      apareceuAlgumaVez: () => abriuDepoisDeRegistrar,
      fechouAposAbrir: () => fechouDepoisDeAbrir,
      stop: () => obs.disconnect(),
    };
  }

  async function aguardarUsando(watcher, predicate, ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (predicate()) return true;
      await esperar(60);
    }
    return false;
  }

  function fecharTodosDropdowns() {
    document.querySelectorAll('.btn-mais-acoes button.dropdown-toggle[aria-expanded="true"]').forEach(b => {
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  // Uma tentativa de gerar fatura para uma linha. Retorna {ok, motivo}.
  async function tentarGerarFaturaLinha(tr, tentativa) {
    const nome = getNomeERP(tr) || '(sem nome)';

    const { trigger, menu } = await abrirDropdownLinha(tr);
    if (!menu) {
      console.warn(`[CR][Fatura] ${nome} · tent.${tentativa} · menu-nao-abriu`);
      return { ok: false, motivo: 'menu-nao-abriu' };
    }

    const faturaItem = await expandirSubmenuGerar(menu);
    if (!faturaItem) {
      console.warn(`[CR][Fatura] ${nome} · tent.${tentativa} · item-fatura-nao-apareceu`);
      return { ok: false, motivo: 'item-fatura-nao-apareceu' };
    }

    // Registrar watcher de modal ANTES de clicar — evita race
    // (o initModalAutoConfirm também não age mais em confirmações de fatura)
    errosNaUltimaOp = 0;
    ultimoErroFoiJaGerado = false;
    const watcher = criarWatcherModal();

    faturaItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // 1. Aguarda modal aparecer
    const apareceu = await aguardarUsando(watcher, () => watcher.apareceuAlgumaVez(), TIMEOUT_MODAL_OPEN);
    if (!apareceu) {
      watcher.stop();
      console.warn(`[CR][Fatura] ${nome} · tent.${tentativa} · modal-confirmacao-nao-abriu`);
      return { ok: false, motivo: 'modal-confirmacao-nao-abriu' };
    }

    // 2. Clicar manualmente em "Sim" (não dependemos mais do auto-confirm)
    //    Pequena espera para garantir que o botão está renderizado/clicável.
    await esperar(120);
    const modal = watcher.getModal() || document.querySelector('#modal-dialog___BV_modal_content_');
    const simBtn = modal?.querySelector('button[value="true"]');
    if (!simBtn) {
      watcher.stop();
      console.warn(`[CR][Fatura] ${nome} · tent.${tentativa} · botao-sim-nao-encontrado`);
      return { ok: false, motivo: 'botao-sim-nao-encontrado' };
    }
    simBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // 3. Aguarda modal fechar
    const fechou = await aguardarUsando(watcher, () => watcher.fechouAposAbrir(), TIMEOUT_MODAL_CLOSE);
    watcher.stop();
    if (!fechou) {
      console.warn(`[CR][Fatura] ${nome} · tent.${tentativa} · modal-nao-fechou`);
      return { ok: false, motivo: 'modal-nao-fechou' };
    }

    // 4. Aguardar resposta do backend (pode abrir modal de erro)
    await esperar(DELAY_POS_CONFIRM);

    if (ultimoErroFoiJaGerado) {
      console.log(`[CR][Fatura] ${nome} · tent.${tentativa} · já existe recebimento (sem retry)`);
      return { ok: true, jaGerado: true, motivo: 'ja-gerado' };
    }
    if (errosNaUltimaOp > 0) {
      console.warn(`[CR][Fatura] ${nome} · tent.${tentativa} · erro-sistema-apos-confirm`);
      return { ok: false, motivo: 'erro-sistema-apos-confirm' };
    }

    console.log(`[CR][Fatura] ${nome} · tent.${tentativa} · OK`);
    return { ok: true, motivo: null };
  }

  // Gera fatura para uma linha, com 1 retry em caso de falha real.
  // "Já existe recebimento" NÃO dispara retry — marca verde e segue.
  async function gerarFaturaLinha(tr) {
    const nome = getNomeERP(tr) || '(sem nome)';

    fecharTodosDropdowns();
    await esperar(250);

    let r = await tentarGerarFaturaLinha(tr, 1);

    if (r.jaGerado) {
      aplicarCor(tr, 'verde');
      logFaturas.push({ nome, status: 'ja-gerado', tentativas: 1, motivo: 'já existe recebimento' });
      atualizarBadge();
      return r;
    }
    if (r.ok) {
      aplicarCor(tr, 'verde');
      logFaturas.push({ nome, status: 'ok', tentativas: 1, motivo: null });
      atualizarBadge();
      return r;
    }

    // Fallback: limpar estado e tentar de novo (só pra falhas reais)
    fecharTodosDropdowns();
    await esperar(DELAY_RETRY);

    r = await tentarGerarFaturaLinha(tr, 2);

    if (r.jaGerado) {
      aplicarCor(tr, 'verde');
      logFaturas.push({ nome, status: 'ja-gerado', tentativas: 2, motivo: 'já existe recebimento' });
    } else if (r.ok) {
      aplicarCor(tr, 'verde');
      logFaturas.push({ nome, status: 'ok', tentativas: 2, motivo: null });
    } else {
      logFaturas.push({ nome, status: 'falha', tentativas: 2, motivo: r.motivo });
    }
    atualizarBadge();
    return r;
  }

  // Loop principal — iteração dinâmica por chave da linha.
  // estadoInicial?: {processados, res, totalPaginas} para retomar após reload.
  async function gerarFaturas(estadoInicial) {
    if (gerandoFaturas) {
      // Já está rodando → clique no botão "Parar"
      gerandoFaturas = false;
      atualizarBtnGerarFaturas('<i class="fa fa-refresh"></i> Gerar faturas', '#2157d9');
      limparProgressoFaturas();
      toast('Processo interrompido');
      return;
    }

    gerandoFaturas = true;
    atualizarBtnGerarFaturas('<i class="fa fa-stop"></i> Parar', '#dc3545');

    // Estado: retomada de reload OU run novo
    const processados = new Set(estadoInicial?.processados || []);
    const res = estadoInicial?.res || { sucesso: 0, falha: 0, jaGerado: 0 };
    let totalPaginas = estadoInicial?.totalPaginas || 0;
    logFaturas = []; // log não persiste entre reloads (só contadores)

    if (estadoInicial) {
      console.log(`[CR][Fatura] === RETOMANDO run — ${processados.size} já processados ===`);
      toast(`Retomando: ${processados.size} já processados`);
    } else {
      console.log('[CR][Fatura] === Início da execução em massa ===');
    }

    while (gerandoFaturas) {
      totalPaginas++;
      let linhasNaPagina = 0;

      while (gerandoFaturas) {
        // SEMPRE pega a primeira linha não-processada do DOM atual.
        // Tolera re-render, reordenação e sumiço de linha.
        const tr = [...document.querySelectorAll(SEL.ROWS)].find(t => {
          const k = chaveLinha(t);
          return k && !processados.has(k);
        });
        if (!tr) break; // todas as linhas visíveis dessa página já processadas

        const chave = chaveLinha(tr);
        const nome  = getNomeERP(tr) || '(sem nome)';
        processados.add(chave);
        linhasNaPagina++;

        if (linhasNaPagina === 1) {
          toast(`Página ${totalPaginas} — processando assinaturas...`);
          console.log(`[CR][Fatura] -- Página ${totalPaginas} --`);
        }

        const r = await gerarFaturaLinha(tr);
        if (r.jaGerado)      res.jaGerado++;
        else if (r.ok)       res.sucesso++;
        else                 res.falha++;

        // Persistir progresso após cada linha
        salvarProgressoFaturas({
          ativo: true,
          processados: [...processados],
          res,
          totalPaginas,
          atualizadoEm: Date.now(),
        });

        await esperar(DELAY_ENTRE_LINHAS);
      }

      if (!gerandoFaturas) break;
      const nextBtn = proximaPaginaBtn();
      if (!nextBtn) break;
      nextBtn.click();
      await aguardarAtualizacaoTabela(3500);
    }

    gerandoFaturas = false;
    atualizarBtnGerarFaturas('<i class="fa fa-refresh"></i> Gerar faturas', '#2157d9');
    limparProgressoFaturas();
    console.log('[CR][Fatura] === Fim. Resumo:', res, '===');
    console.table(logFaturas);
    mostrarModalResumo(res);
    mostrarPainelLogFaturas(logFaturas);
  }

  // Painel flutuante com log linha-a-linha — fica visível pra diagnóstico
  function mostrarPainelLogFaturas(log) {
    document.getElementById('cr-painel-log')?.remove();
    if (!log.length) return;

    const STATUS_STYLE = {
      'ok':        { icone: '✓', cor: '#155724', bg: '#d4edda' },
      'ja-gerado': { icone: '↻', cor: '#0c5460', bg: '#d1ecf1' },
      'falha':     { icone: '✕', cor: '#721c24', bg: '#f8d7da' },
    };

    const trHtml = log.map(l => {
      const st = STATUS_STYLE[l.status] || STATUS_STYLE.falha;
      const motivo   = l.motivo ? `<span class="cr-painel-sub">${l.motivo}</span>` : '';
      const tentMark = l.tentativas > 1 ? ` <span style="color:#856404">(retry)</span>` : '';
      return `<tr>
        <td style="background:${st.bg};color:${st.cor};text-align:center;font-weight:600">${st.icone}</td>
        <td>${l.nome}${tentMark}</td>
        <td>${motivo}</td>
      </tr>`;
    }).join('');

    const sucessos  = log.filter(l => l.status === 'ok').length;
    const jaGerados = log.filter(l => l.status === 'ja-gerado').length;
    const falhas    = log.filter(l => l.status === 'falha').length;

    const panel = document.createElement('div');
    panel.id = 'cr-painel-log';
    panel.innerHTML = `
      <div class="cr-painel-header">
        <span>📋 Log da geração — <b>${sucessos}</b> ok · <b>${jaGerados}</b> já gerado${jaGerados!==1?'s':''} · <b>${falhas}</b> falha${falhas!==1?'s':''}</span>
        <button class="cr-painel-close" title="Fechar">✕</button>
      </div>
      <div class="cr-painel-body">
        <table class="cr-painel-table">
          <thead><tr><th style="width:40px">St</th><th>Cliente</th><th>Motivo</th></tr></thead>
          <tbody>${trHtml}</tbody>
        </table>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector('.cr-painel-close').addEventListener('click', () => panel.remove());
  }

  // ============================================================
  // TOOLBAR — 1ª linha (.botoes): botões de ação + badges
  // ============================================================
  function injetarToolbarPrincipal(){
    if(document.getElementById('cr-btn-import'))return;
    const tb=document.querySelector('.mb-2.col.col-sm-auto.botoes, div.botoes');
    if(!tb)return;
    tb.style.cssText+=';display:flex;align-items:center;flex-wrap:wrap;gap:4px;';

    const sep=document.createElement('span');
    sep.style.cssText='width:1px;height:28px;background:#dee2e6;margin:0 6px;flex-shrink:0;';
    tb.appendChild(sep);

    [{id:'cr-btn-import',html:'<i class="fa fa-upload"></i> Conciliar',cls:'btn btn-primary btn-sm',fn:importarXLSX},
     {id:'cr-btn-export',html:'<i class="fa fa-file-excel-o"></i> Exportar',cls:'btn btn-success btn-sm',fn:exportarXLSX},
     {id:'cr-btn-nao',html:'<i class="fa fa-search"></i> Não encontrados',cls:'btn btn-secondary btn-sm',fn:exportarNaoEncontrados,title:'Exporta registros da planilha sem correspondência no ERP'},
     {id:'cr-btn-clear', html:'<i class="fa fa-times"></i> Limpar',cls:'btn btn-danger btn-sm',
      fn:()=>{
        limparTudo();
        document.querySelectorAll(`${SEL.ROWS}.${CLS_VERDE},.${CLS_AMAREL},.${CLS_VERMELHO}`).forEach(tr=>{
          aplicarCor(tr,null);
          tr.classList.remove(CLS_VERMELHO);
          tr.dataset.crFalha='0';
          getTDNome(tr)&&(getTDNome(tr).title='');getTDValor(tr)&&(getTDValor(tr).title='');
        });
        document.querySelectorAll('.cr-diverg').forEach(el=>el.remove());
        document.getElementById('cr-painel')?.remove();
        document.getElementById('cr-modal-resumo')?.remove();
        atualizarBadge();toast('Conciliação limpa');
      }},
    ].forEach(({id,html,cls,fn,title})=>{
      const b=document.createElement('button');b.id=id;b.type='button';b.className=cls;
      b.innerHTML=html;if(title)b.title=title;b.addEventListener('click',fn);tb.appendChild(b);
    });

    ['verde','amarelo','vermelho'].forEach(cor=>{
      const b=document.createElement('span');b.id=`cr-badge-${cor}`;b.className=`cr-badge-${cor} badge`;
      b.style.cssText='display:none;padding:4px 8px;border-radius:4px;font-size:.8rem;';
      tb.appendChild(b);
    });
    atualizarBadge();
  }

  // ============================================================
  // CONTROLES — 2ª linha (ao lado de Buscar/Limpar): Gerar + filtros
  // ============================================================
  function injetarControlesBuscarLimpar(){
    if(document.getElementById('cr-fviz-todos'))return;
    const buscarBtn=document.querySelector(SEL.BTN_BUSCAR);
    const container=buscarBtn?.parentElement;
    if(!container)return;

    // Botão "Gerar boletos / Pix" — só na página de Recebimento
    if (PAGE.hasGerarBoletos && !document.getElementById('cr-btn-gerar')) {
      const btnG=document.createElement('button');
      btnG.id='cr-btn-gerar';btnG.type='button';btnG.className='btn ml-2';
      btnG.style.cssText='background:#2157d9;border:1px solid #2157d9;color:#fff;';
      btnG.innerHTML='<i class="fa fa-file-text-o"></i> Gerar boletos / Pix';
      btnG.title='Gera boletos e Pix em todas as páginas (confirma modal automaticamente)';
      btnG.addEventListener('click',gerarCobranças);
      container.appendChild(btnG);
    }

    // Botão "Gerar faturas" — só na página de Serviços Recorrentes
    if (PAGE.hasGerarFaturas && !document.getElementById('cr-btn-gerar-faturas')) {
      const btnF=document.createElement('button');
      btnF.id='cr-btn-gerar-faturas';btnF.type='button';btnF.className='btn ml-2';
      btnF.style.cssText='background:#2157d9;border:1px solid #2157d9;color:#fff;';
      btnF.innerHTML='<i class="fa fa-refresh"></i> Gerar faturas';
      btnF.title='Gera a próxima fatura de todas as assinaturas em todas as páginas (confirma modal automaticamente)';
      btnF.addEventListener('click',gerarFaturas);
      container.appendChild(btnF);
    }

    // Botão "Filtro" — toggle do wrapper de filtros
    const btnFiltroToggle = document.createElement('button');
    btnFiltroToggle.id = 'cr-btn-filtro-toggle';
    btnFiltroToggle.type = 'button';
    btnFiltroToggle.className = 'btn ml-2';
    btnFiltroToggle.style.cssText = 'background:#2157d9;border:1px solid #2157d9;color:#fff;';
    btnFiltroToggle.innerHTML = '<i class="fa fa-filter"></i> Filtro';
    btnFiltroToggle.title = 'Mostrar/ocultar filtros de visualização';
    container.appendChild(btnFiltroToggle);

    // Wrapper colapsível dos filtros (oculto por padrão)
    const wrapper = document.createElement('span');
    wrapper.id = 'cr-filtros-wrapper';
    wrapper.style.display = 'none';

    const sep=document.createElement('span');
    sep.style.cssText='display:inline-block;width:1px;height:26px;background:#dee2e6;margin:0 8px;vertical-align:middle;';
    wrapper.appendChild(sep);

    const lbl=document.createElement('span');
    lbl.style.cssText='font-size:.8rem;color:#6c757d;margin-right:4px;white-space:nowrap;';
    lbl.textContent='Exibir:';
    wrapper.appendChild(lbl);

    [{id:'todos',label:'Todos'},{id:'verde',label:'✓ Verdes'},{id:'amarelo',label:'⚠ Amarelos'},{id:'falha',label:'✕ Falhas'},{id:'sem-cor',label:'○ Sem cor'}]
    .forEach(f=>{
      const b=document.createElement('button');
      b.id=`cr-fviz-${f.id}`;b.type='button';b.className='btn btn-sm cr-fviz-btn';
      b.innerHTML=f.label;
      b.classList.toggle('cr-fviz-ativo',f.id===filtroVis);
      b.addEventListener('click',()=>ativarFiltroComCarregamento(f.id));
      wrapper.appendChild(b);
    });

    container.appendChild(wrapper);

    // Toggle: alterna visibilidade do wrapper e estilo do botão (preenchido ↔ outline)
    btnFiltroToggle.addEventListener('click', () => {
      const aberto = wrapper.style.display !== 'none';
      if (aberto) {
        wrapper.style.display = 'none';
        btnFiltroToggle.style.cssText = 'background:#2157d9;border:1px solid #2157d9;color:#fff;';
      } else {
        wrapper.style.display = 'inline';
        btnFiltroToggle.style.cssText = 'background:#fff;border:1px solid #2157d9;color:#2157d9;';
      }
    });
  }

  // ============================================================
  // CSS
  // ============================================================
  function injetarCSS(){
    if(document.getElementById('cr-styles'))return;
    const s=document.createElement('style');s.id='cr-styles';
    s.textContent=`
      table.b-table tbody tr.${CLS_VERDE}    > td { background-color:#d4edda!important; }
      table.b-table tbody tr.${CLS_AMAREL}   > td { background-color:#fff3cd!important; }
      table.b-table tbody tr.${CLS_VERMELHO} > td { background-color:#f8d7da!important; }
      table.b-table tbody tr.${CLS_VERDE}:hover    > td { filter:brightness(.95); }
      table.b-table tbody tr.${CLS_AMAREL}:hover   > td { filter:brightness(.95); }
      table.b-table tbody tr.${CLS_VERMELHO}:hover > td { filter:brightness(.95); }
      table.b-table tbody tr { cursor:pointer; }

      .cr-diverg {
        font-size:.72rem; color:#6c757d; font-style:italic;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        margin-top:2px; line-height:1.2;
      }

      .cr-badge-verde   { background:#28a745;color:#fff; }
      .cr-badge-amarelo { background:#e6a817;color:#fff; }
      .cr-badge-vermelho { background:#dc3545;color:#fff; }

      .cr-fviz-btn {
        background:#fff;border:1.5px solid #ced4da;color:#495057;
        padding:3px 9px;font-size:.78rem;margin-left:3px;
        border-radius:5px;cursor:pointer;transition:all .15s;white-space:nowrap;
      }
      .cr-fviz-btn:hover { border-color:#2157d9;color:#2157d9; }
      .cr-fviz-btn.cr-fviz-ativo { background:#2157d9;border-color:#2157d9;color:#fff; }
      .cr-fviz-btn:disabled { opacity:.6;cursor:not-allowed; }

      #cr-painel, #cr-painel-log {
        position:fixed; right:20px; top:80px; z-index:9999;
        width:680px; max-height:70vh;
        background:#fff; border-radius:8px;
        box-shadow:0 8px 32px rgba(0,0,0,.22);
        display:flex; flex-direction:column;
        border:1px solid #dee2e6;
      }
      /* Se ambos os painéis estiverem abertos, o de log fica um pouco mais abaixo */
      #cr-painel + #cr-painel-log,
      #cr-painel-log:not(:only-of-type) { top:130px; }
      .cr-painel-header {
        display:flex; justify-content:space-between; align-items:center;
        padding:10px 16px; background:#f8f9fa; border-bottom:1px solid #dee2e6;
        border-radius:8px 8px 0 0; font-size:.9rem; font-weight:600;
      }
      .cr-painel-close {
        background:none;border:none;cursor:pointer;font-size:1rem;color:#6c757d;padding:0 4px;
      }
      .cr-painel-close:hover { color:#dc3545; }
      .cr-painel-body { overflow-y:auto; padding:8px; }
      .cr-painel-table { width:100%; border-collapse:collapse; font-size:.8rem; }
      .cr-painel-table th { background:#2157d9;color:#fff;padding:6px 8px;text-align:left;position:sticky;top:0; }
      .cr-painel-table td { padding:5px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top; }
      .cr-painel-table tr:hover td { background:#f8f9fa; }
      .cr-painel-sub { font-size:.73rem;color:#999;font-style:italic;margin-top:2px; }
      .cr-painel-div { color:#6c757d;font-style:italic; }

      .cr-toast {
        position:fixed;bottom:24px;right:24px;background:#28a745;color:#fff;
        padding:10px 18px;border-radius:6px;z-index:10000;opacity:0;
        transition:opacity .3s;pointer-events:none;font-size:14px;
        max-width:500px;box-shadow:0 4px 14px rgba(0,0,0,.22);
      }
      .cr-toast.show { opacity:1; }

      #cr-modal-resumo {
        position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10001;
        display:flex;align-items:center;justify-content:center;
      }
      .cr-resumo-box {
        background:#fff;border-radius:10px;min-width:320px;max-width:420px;
        box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;
      }
      .cr-resumo-header {
        background:#2157d9;color:#fff;font-weight:700;font-size:1rem;
        text-align:center;padding:14px 20px;
      }
      .cr-resumo-body { padding:20px 24px; }
      .cr-resumo-item { padding:8px 0;font-size:.95rem;border-bottom:1px solid #f0f0f0; }
      .cr-resumo-item:last-child { border:none; }
      .cr-resumo-verde   { color:#155724; }
      .cr-resumo-vermelho{ color:#721c24; }
      .cr-resumo-cinza   { color:#6c757d; }
      .cr-resumo-footer  { padding:14px 20px;text-align:center;background:#f8f9fa;border-top:1px solid #e9ecef; }
    `;
    document.head.appendChild(s);
  }

  // ============================================================
  // MUTATION OBSERVER
  // ============================================================
  function observar(){
    let pending=false;
    new MutationObserver(()=>{
      if(pending)return;pending=true;
      requestAnimationFrame(()=>{
        pending=false;
        injetarToolbarPrincipal();
        injetarControlesBuscarLimpar();
        enriquecerNovasLinhas();
      });
    }).observe(document.body,{childList:true,subtree:true});
  }

  // ============================================================
  // INIT
  // ============================================================
  function init(){
    console.log(`[CR] Página detectada: ${PAGE.label} (${PAGE.id})`);
    injetarCSS();
    planilhaAtiva=carregarPlanilha();
    if(planilhaAtiva.length) buildPlanMap();

    const tick=setInterval(()=>{
      if(!document.querySelector(SEL.TABLE))return;
      clearInterval(tick);
      detectarColunas();
      injetarToolbarPrincipal();
      injetarControlesBuscarLimpar();
      enriquecerTabela();
      restaurarFalhas();
      aplicarFiltroVis();
      atualizarBadge();
      if (PAGE.hasGerarBoletos || PAGE.hasGerarFaturas) initModalAutoConfirm();
      observar();

      // Retomar run de faturas se houve reload no meio do batch
      if (PAGE.hasGerarFaturas) {
        const run = carregarProgressoFaturas();
        if (run?.ativo) {
          const idade = Date.now() - (run.atualizadoEm || 0);
          // Só retoma se for recente (< 5 min) — evita pegar lixo de sessão antiga
          if (idade < 5 * 60 * 1000) {
            console.log(`[CR][Fatura] Detectado run ativo (${run.processados?.length||0} processados) — retomando em 2s...`);
            setTimeout(() => gerarFaturas(run), 2000);
          } else {
            console.warn('[CR][Fatura] Run antigo (>5min) descartado');
            limparProgressoFaturas();
          }
        }
      }
    },300);
  }

  if(document.readyState==='complete'||document.readyState==='interactive')init();
  else document.addEventListener('DOMContentLoaded',init);
})();

// ==UserScript==
// @name         VG 2026 - MoveLines + Quota (Auto)
// @namespace    https://vivogestao.vivoempresas.com.br/
// @version      8.14.0
// @updateURL    https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/vg-movelines-quota.user.js
// @downloadURL  https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/vg-movelines-quota.user.js
// @description  Detecta moveLines para "GRUPO SEM LINHAS", aguarda re-render Angular, renomeia grupos e aplica cota automaticamente.
// @author       Naldo Nascimento
// @match        https://vivogestao.vivoempresas.com.br/Portal/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

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
    LOAD_VIEW_WAIT_MS:    300,   // silêncio após último loadView para considerar tabela estável
                                  // seguro: devtools mostra apenas 1 loadView após moveLines
    LOAD_VIEW_TIMEOUT_MS: 18000, // timeout máximo aguardando o Angular re-renderizar

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
   *  ESTADO GLOBAL
   * ───────────────────────────────────────────────────────── */
  window.__moveGroupMap      = window.__moveGroupMap      || {};
  window.__loadViewListeners = window.__loadViewListeners || [];

  // Parâmetros de sessão capturados do body do moveLines
  const session = {
    sessionId:  null,
    acessLogin: null,
    remoteHost: null,
    remoteIp:   null,
  };

  // Dados da movimentação em curso
  let pendingMove = {
    active:          false,
    sourceGroupId:   null,
    sourceGroupName: null,
    destGroupId:     null,
    lines:           [],
    account:         null,
  };

  let groupQuotaCache = {}; // id → { total, consumed, available }
  let isOwnRequest    = false; // evita que nossas próprias chamadas sejam interceptadas

  /* ─────────────────────────────────────────────────────────
   *  UTILITÁRIOS
   * ───────────────────────────────────────────────────────── */
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Retorna a cota disponível de um grupo pelo id (via groupQuotaCache)
  function getAvailableQuota(id) {
    const c = groupQuotaCache[String(id)];
    if (!c) return 0;
    if (typeof c === 'object') return c.available ?? 0;
    return c;
  }

  // Salva cota no cache: total, consumido e disponível (total − consumido)
  function saveQuotaCache(id, total, consumed) {
    const t = parseFloat(total)    || 0;
    const c = parseFloat(consumed) || 0;
    groupQuotaCache[String(id)] = { total: t, consumed: c, available: Math.max(0, t - c) };
  }

  // Extrai valor numérico de GB do nome do grupo (ex: "10GB" → 10)
  function extractQuotaFromGroupName(name) {
    if (!name) return 0;
    const m = name.match(/(\d+)\s*GB/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  function hasQuotaInGroupName(name) {
    return /\d+\s*GB/i.test(name || '');
  }

  /* ─────────────────────────────────────────────────────────
   *  MAPA DE GRUPOS — populado pelas respostas da API
   *  unallocatedQuota.value = disponível real (confirmado)
   * ───────────────────────────────────────────────────────── */
  function captureGroupMap(text) {
    try {
      const d = JSON.parse(text);
      if (Array.isArray(d?.groupList)) {
        d.groupList.forEach(g => {
          if (!g.id || !g.name) return;
          window.__moveGroupMap[String(g.id)] = { name: g.name };
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
        window.__moveGroupMap[String(d.group.id)] = { name: d.group.name };
      }
    } catch (_) {}
  }

  function resolveGroupName(id) {
    const e = window.__moveGroupMap[String(id)];
    return typeof e === 'string' ? e : (e?.name || '');
  }

  /* ─────────────────────────────────────────────────────────
   *  LEITURA DE COTA VIA getGroupMoveLines
   *
   *  Faz uma chamada fresca ao endpoint, popula groupQuotaCache
   *  para TODOS os grupos retornados (inclui GD) e retorna a
   *  cota disponível do grupo destino especificado.
   *  Uma única chamada de API cobre destino e fallback GD.
   *  Campo confirmado: unallocatedQuota.value = disponível real.
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

      // Popula cache de todos os grupos numa única chamada — cobre destino e GD
      function populateAll(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(populateAll); return; }
        if (obj.id && obj.name) {
          window.__moveGroupMap[String(obj.id)] = { name: obj.name };
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

      return extractAvail(find(d, target));
    } catch (_) { return 0; }
    finally { isOwnRequest = false; }
  }

  /* ─────────────────────────────────────────────────────────
   *  LOCALIZAÇÃO DO GRUPO GD
   *  Busca no groupMap grupo com nome iniciando em "GD",
   *  excluindo origem e destino da movimentação atual.
   *  Retorna { id, name } ou null (garantido único pelo portal).
   * ───────────────────────────────────────────────────────── */
  function findGdGroup(excludeIds = []) {
    for (const [id, entry] of Object.entries(window.__moveGroupMap)) {
      if (excludeIds.includes(id)) continue;
      const name = typeof entry === 'object' ? (entry.name || '') : String(entry);
      if (/^gd\b/i.test(name)) return { id, name };
    }
    return null;
  }

  /* ─────────────────────────────────────────────────────────
   *  CAPTURA DE SESSÃO
   *  Extrai sessionId, acessLogin, remoteHost e remoteIp
   *  diretamente do body do moveLines (sem depender de URLs)
   * ───────────────────────────────────────────────────────── */
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
    // Ignora a chamada de validação (preflight) — só processa o moveLines real
    if (payload.validate) return false;
    const dId   = String(payload.destinationGroup.id || '');
    const dName = payload.destinationGroup.name || resolveGroupName(dId) || '';
    return CFG.TARGET_DEST_PATTERN.test(dName);
  }

  function handleMoveLines(payload) {
    if (pendingMove.active) return; // já monitorando uma movimentação

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

    // Aguarda o Angular re-renderizar a tabela antes de agir
    setTimeout(() => {
      waitForLoadViewBurst().then(() => postMoveFlow());
    }, 0);
  }

  /* ─────────────────────────────────────────────────────────
   *  ESPERA PELO loadView PÓS-MOVIMENTAÇÃO
   *
   *  O Angular dispara uma ou mais chamadas GET loadView ao
   *  re-renderizar a tabela após o moveLines ser processado.
   *  Aguardamos pelo menos 1 chamada + LOAD_VIEW_WAIT_MS de
   *  silêncio antes de iniciar o fluxo pós-movimentação.
   * ───────────────────────────────────────────────────────── */
  function waitForLoadViewBurst() {
    return new Promise(resolve => {
      let count   = 0;
      let quietId = null;

      const onLoadView = () => {
        count++;
        if (quietId) clearTimeout(quietId);
        quietId = setTimeout(() => { unsubscribe(); resolve(); }, CFG.LOAD_VIEW_WAIT_MS);
      };

      window.__loadViewListeners.push(onLoadView);

      const unsubscribe = () => {
        const idx = window.__loadViewListeners.indexOf(onLoadView);
        if (idx !== -1) window.__loadViewListeners.splice(idx, 1);
        if (quietId) clearTimeout(quietId);
      };

      // Segurança: resolve após timeout máximo mesmo sem nenhum loadView
      setTimeout(() => {
        if (count === 0) { unsubscribe(); resolve(); }
      }, CFG.LOAD_VIEW_TIMEOUT_MS);
    });
  }

  /* ─────────────────────────────────────────────────────────
   *  FLUXO PÓS-MOVIMENTAÇÃO — v8.14.0
   *
   *  ETAPA 0 — Leitura prévia (getGroupMoveLines)
   *  ETAPA 1 — Renomeio
   *  ETAPA 2 — Cota (principal → fallback GD)
   *  ETAPA 3 — Coloração + reload (após cota aplicada)
   * ───────────────────────────────────────────────────────── */
  async function postMoveFlow() {
    const { sourceGroupId, sourceGroupName, destGroupId, lines } = pendingMove;

    // ── ETAPA 0: lê cota atual e popula cache de todos os grupos ──
    const destAvail = await fetchDestGroupQuota(destGroupId) || getAvailableQuota(destGroupId);

    // ── ETAPA 1: Renomeio ─────────────────────────────────
    try {
      await renameGroup(sourceGroupId, CFG.EMPTY_NAME);
      await renameGroup(destGroupId, sourceGroupName);
    } catch (err) {
      console.error('%c[VG Auto] ⚠️ Renomeio falhou (fluxo continua):', 'color:#f59e0b;font-weight:bold;', err.message);
    }

    // ── ETAPA 2: Cota ─────────────────────────────────────
    let cotaSuficiente = true;
    let gdUsado        = false;

    if (hasQuotaInGroupName(sourceGroupName)) {
      const quotaPerLine     = extractQuotaFromGroupName(sourceGroupName);
      const quotaNeeded      = quotaPerLine * lines.length;
      const originAvail      = getAvailableQuota(sourceGroupId);
      const neededFromOrigin = Math.max(0, quotaNeeded - destAvail);

      if (originAvail >= neededFromOrigin) {
        // ── Fluxo principal ───────────────────────────────
        const { ok } = await trySetGroupQuota(destGroupId, sourceGroupName, quotaNeeded);
        if (ok && lines.length > 0) {
          await applyQuotaToLines(destGroupId, quotaPerLine, lines);
          logConclusao({ sourceGroupName, lines, quotaPerLine, quotaNeeded, destAvail, neededFromOrigin, gdUsado: false });
        } else if (!ok) {
          cotaSuficiente = false;
        }

      } else {
        // ── Fallback GD ───────────────────────────────────
        const gdRemainder = neededFromOrigin - originAvail;
        const gdGroup     = findGdGroup([String(sourceGroupId), String(destGroupId)]);
        const gdAvail     = gdGroup ? getAvailableQuota(gdGroup.id) : 0;

        if (gdGroup && gdAvail >= gdRemainder) {
          const { ok } = await trySetGroupQuota(destGroupId, sourceGroupName, quotaNeeded);
          if (ok && lines.length > 0) {
            await applyQuotaToLines(destGroupId, quotaPerLine, lines);
            logConclusao({ sourceGroupName, lines, quotaPerLine, quotaNeeded, destAvail, neededFromOrigin, gdUsado: true, gdNome: gdGroup.name, gdRemainder });
          } else if (!ok) {
            cotaSuficiente = false;
          }
        } else {
          console.error(
            `%c[VG Auto] ❌ Cota insuficiente: origem ${originAvail.toFixed(2)} GB + GD ${gdAvail.toFixed(2)} GB < necessário ${neededFromOrigin.toFixed(2)} GB`,
            'color:#ef4444;font-weight:bold;'
          );
          cotaSuficiente = false;
        }
      }
    }

    // ── ETAPA 3: Coloração e reload após cota aplicada ────
    if (cotaSuficiente) {
      saveStatus(destGroupId, 'ok');
      colorirComRetentativa(destGroupId);
    } else {
      saveStatus(destGroupId, 'error');
      colorirVermelhoComRetentativa(destGroupId);
    }

    await sleep(CFG.DELAY_BEFORE_RELOAD);
    clickConsumoDados();

    resetPendingMove();
  }

  /* ─────────────────────────────────────────────────────────
   *  LOG DE CONCLUSÃO — formato narrativo (Opção A)
   * ───────────────────────────────────────────────────────── */
  function logConclusao({ sourceGroupName, lines, quotaPerLine, quotaNeeded, destAvail, neededFromOrigin, gdUsado, gdNome, gdRemainder }) {
    const originUsado = neededFromOrigin.toFixed(2);
    const gdLinha     = gdUsado
      ? `  • GD (${gdNome}): ${gdRemainder.toFixed(2)} GB utilizados`
      : '  • GD: não utilizado';

    console.warn(
      `%c[VG Auto] ✅ Movimentação concluída\n` +
      `  • Grupo:    ${sourceGroupName} → ${lines.length} linha(s) × ${quotaPerLine} GB = ${quotaNeeded} GB necessário\n` +
      `  • Destino:  ${destAvail.toFixed(2)} GB existentes (aproveitados)\n` +
      `  • Origem:   ${originUsado} GB extraídos\n` +
      gdLinha,
      'color:#22c55e;font-weight:bold;'
    );
  }

  function resetPendingMove() {
    pendingMove = {
      active: false, sourceGroupId: null, sourceGroupName: null,
      destGroupId: null, lines: [], account: null,
    };
  }

  /* ─────────────────────────────────────────────────────────
   *  CHAMADAS DE API
   *  Extraídas do Conecta Cheat V11.3, adaptadas para usar
   *  CFG.API_GROUP e a sessão capturada do payload.
   * ───────────────────────────────────────────────────────── */

  // Renomeia um grupo (envia para contexto dados e voz simultaneamente).
  // Lê o body de cada resposta e valida severity === 'info' antes de retornar,
  // eliminando a necessidade de delay fixo entre etapas.
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
      // Lê ambos os bodies — o gate real é a confirmação do servidor
      const [jsonVoice, jsonData] = await Promise.all([
        resVoice.json().catch(() => ({})),
        resData.json().catch(() => ({})),
      ]);
      // severity 'info' = sucesso confirmado pelo backend
      const ok = jsonData.severity === 'info' || jsonVoice.severity === 'info';
      if (!ok) throw new Error(`renameGroup falhou: ${jsonData.severity || jsonVoice.severity || 'sem resposta'}`);
      return true;
    } finally {
      isOwnRequest = false;
    }
  }

  // Tenta atribuir cota ao grupo destino.
  // Retorna { ok: true } se severity='info', { ok: false, json } caso contrário.
  // NÃO lança erro — permite que o chamador decida o fallback.
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
      return { ok, json };
    } catch (err) {
      return { ok: false, json: { error: err.message } };
    } finally {
      isOwnRequest = false;
    }
  }

  // Aplica cota individualmente em cada linha movida (action: saveLines)
  async function applyQuotaToLines(destGroupId, quotaPerLine, lines) {
    isOwnRequest = true;
    const defaultAccount = pendingMove.account || '';

    const linesPayload = lines.map(line => ({
      account:    line.account    || defaultAccount,
      lineNumber: line.lineNumber || line.msisdn || line.numero || '',
      userName:   line.userName   || line.name   || '',
      quota:       { value: String(quotaPerLine), dataPackValueType: 'GB' },
      futureQuota: { value: String(quotaPerLine), dataPackValueType: 'GB' },
      notifyManagerGroup: false,
    }));

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
      await fetch(`https://vivogestao.vivoempresas.com.br${CFG.API_PATH}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
    } finally {
      isOwnRequest = false;
    }
  }

  /* ─────────────────────────────────────────────────────────
   *  CLIQUE EM "CONSUMO DE DADOS"
   *  Recarrega a view do portal para exibir os grupos já
   *  renomeados. Chamado ao final do fluxo pós-movimentação.
   *  Elemento: <a class="anchor-context">
   *              <span class="icon-data-consumption-closed">
   *            </span>Consumo de Dados</a>
   * ───────────────────────────────────────────────────────── */
  function clickConsumoDados() {
    const span = document.querySelector('span.icon-data-consumption-closed');
    if (span) {
      const link = span.closest('a.anchor-context') || span.parentElement;
      if (link) { link.click(); return; }
    }
    // Fallback: varre todos os anchor-context pelo texto
    document.querySelectorAll('a.anchor-context').forEach(a => {
      if (/consumo\s+de\s+dados/i.test(a.textContent)) a.click();
    });
  }

  /* ─────────────────────────────────────────────────────────
   *  COLORAÇÃO — VERDE (ok) e VERMELHO (error)
   *  Ambas persistem no localStorage com campo status.
   *  Verde sobrescreve vermelho se o grupo for reprocessado.
   * ───────────────────────────────────────────────────────── */

  // Salva o resultado da operação no localStorage.
  // status: 'ok' → verde | 'error' → vermelho
  // Verde sobrescreve vermelho automaticamente ao reprocessar.
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

  // Tenta colorir imediatamente; se o DOM ainda não renderizou,
  // usa MutationObserver com timeout de 8s
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

  // Coloração vermelha — cota insuficiente.
  // Persiste no localStorage via saveStatus(id, 'error').
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

  // Restaura cores a partir do localStorage (resiste a re-renders do Angular).
  // Aplica verde (status 'ok') ou vermelho (status 'error') conforme salvo.
  // Entradas sem campo status são tratadas como 'ok' (retrocompatibilidade).
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
   *  INTERCEPTAÇÃO XHR
   * ───────────────────────────────────────────────────────── */
  const _XHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr  = new _XHR();
    const self = this;
    let _method = '', _url = '';

    self.open = function (method, url, ...rest) {
      _method = method.toUpperCase();
      _url    = url;
      return xhr.open(method, url, ...rest);
    };

    self.send = function (body) {
      // Detecta moveLines para "GRUPO SEM LINHAS" (ignora nossas próprias requisições)
      if (!isOwnRequest && _method === 'POST' && _url.includes(CFG.API_PATH) && body) {
        try {
          const parsed = typeof body === 'string' ? JSON.parse(body) : body;
          // Captura nome e cota da origem via body do listLines (request)
          if (parsed.action === 'listLines' && parsed.group?.id && parsed.group?.name) {
            window.__moveGroupMap[String(parsed.group.id)] = { name: parsed.group.name };
            saveQuotaCache(parsed.group.id, parsed.group.quota?.value, parsed.group.quotaConsume?.value);
          }
          if (isTargetMove(parsed)) handleMoveLines(parsed);
        } catch (_) {}
      }

      xhr.addEventListener('load', () => {
        captureGroupMap(xhr.responseText || '');
        if (_method === 'GET' && _url.includes(CFG.API_PATH) && _url.includes('loadView')) {
          window.__loadViewListeners.slice().forEach(fn => { try { fn(); } catch (_) {} });
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
   *  INTERCEPTAÇÃO fetch
   * ───────────────────────────────────────────────────────── */
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url    = typeof input === 'string' ? input : (input?.url || '');
    const method = (init.method || (typeof input === 'object' ? input.method : '') || 'GET').toUpperCase();

    // Detecta moveLines para "GRUPO SEM LINHAS" (ignora nossas próprias requisições)
    if (!isOwnRequest && method === 'POST' && url.includes(CFG.API_PATH) && init.body) {
      try {
        const parsed = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        // Captura nome e cota da origem via body do listLines (request)
        if (parsed.action === 'listLines' && parsed.group?.id && parsed.group?.name) {
          window.__moveGroupMap[String(parsed.group.id)] = { name: parsed.group.name };
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
          window.__loadViewListeners.slice().forEach(fn => { try { fn(); } catch (_) {} });
        }
      }).catch(() => {});
    }

    return response;
  };

  /* ─────────────────────────────────────────────────────────
   *  OBSERVER ANGULAR
   *  — Restaura cores a cada re-render
   *  — FIX: observa o modal <moveconsume> para mapear
   *    id → nome dos grupos destino via DOM dos radio buttons
   *    (necessário pois o payload moveLines só envia o id,
   *     nunca o nome do grupo destino)
   * ───────────────────────────────────────────────────────── */
  function observeAngular() {
    const obs = new MutationObserver(() => {
      restoreColors();

      // Captura nomes dos grupos do modal de movimentação
      const mc = document.querySelector('moveconsume');
      if (!mc) return;

      mc.querySelectorAll('input[type="radio"][id^="rdgroup"]').forEach(radio => {
        const gId   = radio.id.replace('rdgroup', '');
        const label = mc.querySelector(`label[for="${radio.id}"]`);
        // Remove badge "⚡ ..." que o script de badge pode ter adicionado
        const name  = label ? label.textContent.replace(/⚡.*$/, '').trim() : '';
        if (gId && name) {
          window.__moveGroupMap[gId] = { name };
        }
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ─────────────────────────────────────────────────────────
   *  DETECÇÃO DE LOGOUT / SESSÃO EXPIRADA
   *  Limpa o mapa de grupos para evitar nomes desatualizados
   * ───────────────────────────────────────────────────────── */
  function setupLogoutDetection() {
    const obs = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (/sessão expirou|session expired|sessão expirada/i.test(node.textContent || ''))
            window.__moveGroupMap = {};
          const btn = node.querySelector?.('[href*="logout"],[href*="sair"],[onclick*="logout"]');
          if (btn && !btn._vgLogout) {
            btn._vgLogout = true;
            btn.addEventListener('click', () => { window.__moveGroupMap = {}; }, true);
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
          window.__moveGroupMap = {};
      }
    }, 2000);
  }

  /* ─────────────────────────────────────────────────────────
   *  BOOT
   * ───────────────────────────────────────────────────────── */
  function init() {
    setupLogoutDetection();
    observeAngular();
    setTimeout(restoreColors, 300);
    setInterval(restoreColors, 1500);
    console.warn(
      '%c[VG Auto] ✅ v8.14.0 — reload após cota | log narrativo | código limpo',
      'color:#22c55e;font-weight:bold;'
    );
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
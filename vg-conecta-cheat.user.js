// ==UserScript==
// @name         VG 2026 - Conecta Cheat
// @namespace    https://vivogestao.vivoempresas.com.br/
// @version      2.5.0
// @updateURL    https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/vg-conecta-cheat.user.js
// @downloadURL  https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/vg-conecta-cheat.user.js
// @description  Script unificado com painel de controle para automações do portal Vivo Gestão. (sem Ocultar Movidas)
// @author       Naldo Nascimento
// @match        https://*/*Portal*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

// ─────────────────────────────────────────────────────────────────────────────
//  CHANGELOG
//
//  v2.3.0 (2026-06-07)
//  └─ [REMOVE] Ocultar Movidas removida por completo (Naldo decidiu — não era
//     mais útil no fluxo atual). Tudo o que saiu:
//        • FEATURES.ocultarMovidas (toggle do painel)
//        • Flags _linhasMovidas e _debounceOcultar
//        • Funções mergeMovidasFromGroup, captureLoadViewResponse,
//          ocultarLinhasMovidas e o debug window.__ccHide
//        • Constante API_PATH e os blocos do XHR/fetch que capturavam
//          /Portal/api/datapackconsumption só para extrair blockConsumptionStatus
//        • Passo 3 da cadeia pós-"Ver Linhas"
//        • Bloco do MutationObserver que detectava rows novas
//        • Listener de clique no expander
//     PERMANECE o patch XHR/fetch em si (fecharSessao precisa dele para
//     detectar LOGIN_EXPIRED), assim como o helper sleep e pageWindow.
//
//  v2.2.2 (2026-04-21)
//  └─ [NEW] Fechar Sessão Expirada integrado ao painel (toggle ON por default).
//      Baseado no script "VG - Auto-fechar Modal Sessão Expirada v1.0.0".
//      Integração sem duplicar patches:
//        • LOGIN_EXPIRED via XHR: hookado no readystatechange já existente
//        • LOGIN_EXPIRED via fetch: hookado no promise.then já existente
//        • MutationObserver: tryCloseModal() chamado no callback unificado
//      Não cria observers extras nem sobrescreve patches de outros scripts.
//
//  v2.2.1 (2026-04-21)
//  └─ [FIX] Ocultar Movidas reescrita. Quatro problemas identificados:
//      1. Fonte de dados errada: loadView (GET, fetchSize=20) do Angular
//         não traz blockConsumptionStatus por linha de forma confiável.
//         O formato rico vem no listLines (POST), chamado quando o usuário
//         abre um grupo. Agora interceptamos AMBOS (toda chamada ao
//         /datapackconsumption, GET ou POST).
//      2. Strategy clear-then-set perdia dados entre listLines consecutivos.
//         Agora usa MERGE: adiciona se bcs=1, remove se bcs=0.
//      3. Matching no DOM falhava quando o portal formatava o número
//         ("(94) 99102-9675" ≠ "94991029675"). Agora normaliza o texto
//         para apenas dígitos antes de comparar, e como 1ª estratégia
//         procura input[value*=lineNumber] (checkboxes).
//      4. Falta de triggers: só rodava após "Ver Linhas" clicado. Agora:
//         - Após qualquer resposta API (2 timeouts: 600ms e 1500ms)
//         - Clique em expander (span.expander) do grupo
//         - MutationObserver detecta novas rows em panel-body/card-body
//         - Trigger existente pós-"Ver Linhas" mantido
//      Debug: window.__ccHide() força ocultação manual via console.
//
//  v2.2.0 (2026-04-21)
//  └─ [CLEANUP] Script reescrito do zero mantendo apenas 5 funcionalidades:
//        • Cota em Lote
//        • Pesquisa Avançada
//        • Fix Consumo de Dados
//        • Auto-seleção de Linhas
//        • Ocultar Movidas
//      REMOVIDAS (não funcionavam de forma consistente ou ficaram obsoletas):
//        • Auto-Sort (todas as tentativas)
//        • Auto-mover p/ Grupo
//        • Redistribuição Cota
//        • Auto-expand Linhas
//      UI:
//        • Header do modal agora em #2157d9 (azul Vivo)
//        • Título mostra apenas o número da conta (sem "Usuário" prefixo)
//        • Removidas sub-opções (dropdown/radio/input) — não são mais necessárias
//      CÓDIGO:
//        • Removidos ~600 linhas de código não utilizado
//        • Removidas todas as variáveis globais, helpers e funções das features
//          descartadas (scheduleSort, executarSortGrupos, findColumnHeader,
//          estaEmAsc, attachGroupsSortObserver, ensureGroupsSortObserver,
//          autoSelecionarGrupoMover, executarRedistribuicao, expandirTodasLinhas,
//          onExpanderClick, attachExpanderHandlers, scheduleSort, etc.)
//        • Removidos debug helpers: __ccSort, __ccReattachSortObserver, __ccSetDelay
//        • XHR/fetch interception mantida APENAS para capturar blockConsumptionStatus
//          (necessário para Ocultar Movidas)
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
   *  1. FEATURES — REGISTRO E ESTADO
   * ═══════════════════════════════════════════════════════════ */

  const FEATURES = {
    cotaEmLote:       { label: 'Cota em Lote',           default: true  },
    pesquisaAvancada: { label: 'Pesquisa Avançada',      default: true  },
    fixConsumo:       { label: 'Fix Consumo de Dados',   default: true  },
    autoSelLinhas:    { label: 'Auto-seleção de Linhas', default: true  },
    fecharSessao:     { label: 'Fechar Sessão Expirada', default: true  },
    modoPrivacidade:  { label: 'Modo Privacidade',       default: false, sub: 'privacidade' },
    resetCota:        { label: 'Resetar Cota (grupo)',   default: false, sub: 'resetCota' },
  };

  // v2.4.0 — Modo Privacidade: cada item vira classe no <body> quando ativo, e o
  // CSS aplica filter:blur(8px) no seletor correspondente. Preserva layout e
  // interatividade — só borra visualmente. Cada checkbox é independente.
  const PRIVACIDADE_ITENS = {
    consumo:  { label: 'Consumo total da conta (header)', default: true  },
    grupo:    { label: 'Nome do grupo',                    default: true  },
    cliente:  { label: 'Nome do cliente',                  default: true  },
    linha:    { label: 'Número da linha',                  default: true  },
    cota:     { label: 'Cota',                             default: false },
    proxCota: { label: 'Próxima cota',                     default: false },
  };

  const state = {};
  for (const [key, cfg] of Object.entries(FEATURES)) {
    state[key] = GM_getValue('cc_' + key, cfg.default);
  }
  // Sub-estado do Modo Privacidade
  const privState = {};
  for (const [key, cfg] of Object.entries(PRIVACIDADE_ITENS)) {
    privState[key] = GM_getValue('cc_priv_' + key, cfg.default);
  }

  function isOn(key)   { return state[key]; }
  function toggle(key) {
    state[key] = !state[key];
    GM_setValue('cc_' + key, state[key]);
    return state[key];
  }
  function isPrivOn(key)   { return privState[key]; }
  function togglePriv(key) {
    privState[key] = !privState[key];
    GM_setValue('cc_priv_' + key, privState[key]);
    return privState[key];
  }

  // Sincroniza classes no <body> pra ativar/desativar o blur de cada item.
  function aplicarPrivacidade() {
    const ativo = isOn('modoPrivacidade');
    const body  = document.body;
    if (!body) return;
    body.classList.toggle('cc-priv-ativo', !!ativo);
    for (const key of Object.keys(PRIVACIDADE_ITENS)) {
      body.classList.toggle('cc-priv-' + key, !!(ativo && isPrivOn(key)));
    }
  }

  /* ═══════════════════════════════════════════════════════════
   *  2. FLAGS GLOBAIS
   * ═══════════════════════════════════════════════════════════ */

  let _quotaEmAndamento     = false;   // Cota em Lote em execução
  let _verLinhasEmAndamento  = false;  // Cadeia pós-"Ver Linhas" em execução
  let _sanitizing           = false;   // guard do loop de sanitização

  /* ═══════════════════════════════════════════════════════════
   *  3. INTERCEPTAÇÃO XHR/FETCH
   *
   *  Captura respostas para detectar LOGIN_EXPIRED (feature
   *  fecharSessao). Usa unsafeWindow para acessar a janela real
   *  da página, já que Tampermonkey roda em sandbox quando há
   *  @grant GM_*.
   * ═══════════════════════════════════════════════════════════ */

  const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Patch XHR via prototype (compatível com Zone.js do Angular)
  try {
    const _origXhrOpen = pageWindow.XMLHttpRequest.prototype.open;
    const _origXhrSend = pageWindow.XMLHttpRequest.prototype.send;

    pageWindow.XMLHttpRequest.prototype.open = function (method, url) {
      this._ccMethod = (method || '').toUpperCase();
      this._ccUrl    = url || '';
      return _origXhrOpen.apply(this, arguments);
    };

    pageWindow.XMLHttpRequest.prototype.send = function () {
      const self = this;
      // Captura respostas para detectar LOGIN_EXPIRED (fecharSessao).
      self.addEventListener('readystatechange', function () {
        if (self.readyState !== 4) return;
        try {
          const body = JSON.parse(self.responseText);
          if (body && body.code === 'LOGIN_EXPIRED' && isOn('fecharSessao')) {
            console.log('%c[CC] 🔑 LOGIN_EXPIRED via XHR — agendando fechamento', 'color:#f59e0b;font-weight:bold;');
            scheduleClose();
          }
        } catch (_) {}
      });
      return _origXhrSend.apply(self, arguments);
    };

    console.log('%c[CC] ✅ XHR patch aplicado.', 'color:#22c55e;');
  } catch (e) {
    console.error('[CC] ❌ Falha ao patchear XHR:', e);
  }

  // Patch fetch (fallback — Angular HttpClient usa XHR)
  try {
    const _origFetch = pageWindow.fetch;
    if (typeof _origFetch === 'function') {
      pageWindow.fetch = function (input, init) {
        const promise = _origFetch.apply(this, arguments);
        // Detecta LOGIN_EXPIRED em qualquer resposta JSON (fecharSessao).
        promise.then(function (r) {
          try {
            r.clone().json().then(function (body) {
              if (body && body.code === 'LOGIN_EXPIRED' && isOn('fecharSessao')) {
                console.log('%c[CC] 🔑 LOGIN_EXPIRED via fetch — agendando fechamento', 'color:#f59e0b;font-weight:bold;');
                scheduleClose();
              }
            }).catch(function () {});
          } catch (_) {}
        }).catch(function () {});
        return promise;
      };
      console.log('%c[CC] ✅ fetch patch aplicado.', 'color:#22c55e;');
    }
  } catch (e) {
    console.error('[CC] ❌ Falha ao patchear fetch:', e);
  }

  /* ═══════════════════════════════════════════════════════════
   *  4. FEATURES DOM-DEPENDENT
   * ═══════════════════════════════════════════════════════════ */

  function onDomReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onDomReady(() => {

    // ─────────────────────────────────────────────
    //  4A. COTA EM LOTE (preenchimento + salvar)
    // ─────────────────────────────────────────────

    function preencherESalvarCota(modal) {
      if (!isOn('cotaEmLote')) return;
      _quotaEmAndamento = true;

      const boldText = modal.querySelector('p b');
      const match = boldText?.innerText.match(/([\d.]+)\s*GB/i);

      if (!match) {
        console.warn('[CC] Não foi possível ler o valor de GB.');
        _quotaEmAndamento = false;
        return;
      }

      const valorGB = match[1];

      modal.querySelectorAll('input[name="quota"]').forEach(input => {
        input.value = valorGB;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.classList.add('ng-dirty');
        input.classList.remove('ng-pristine');
      });

      console.log(`%c[CC] 📝 Cota: ${valorGB} GB`, 'color:#22c55e;font-weight:bold;');

      setTimeout(() => {
        const footer = modal.parentElement.querySelector('.modal-footer');
        const btnSalvar = footer?.querySelector('button[type="submit"]');
        if (btnSalvar) {
          btnSalvar.removeAttribute('disabled');
          btnSalvar.click();
          console.log('%c[CC] 💾 Salvar clicado', 'color:#22c55e;font-weight:bold;');
        }
        _quotaEmAndamento = false;
      }, 300);
    }

    function aguardarModalCota() {
      const start = Date.now();
      const timer = setInterval(() => {
        const modal = document.querySelector('.modal-body.modal-group');
        if (modal) {
          clearInterval(timer);
          preencherESalvarCota(modal);
        } else if (Date.now() - start > 3000) {
          clearInterval(timer);
        }
      }, 200);
    }

    document.body.addEventListener('click', function (e) {
      if (!isOn('cotaEmLote')) return;
      const btn = e.target.closest('button');
      if (!btn) return;
      const texto = btn.innerText.trim();
      if (texto === 'Editar Cota em Lote' || texto === 'Cancelar') {
        aguardarModalCota();
      }
    });

    // ─────────────────────────────────────────────
    //  4B. PESQUISA AVANÇADA (document-level delegation)
    //
    //  Estratégia: handlers ficam no document, não nos elementos.
    //  Angular destrói/recria inputs e botões ao navegar — handlers
    //  presos a elementos morreriam junto. Document nunca é destruído.
    // ─────────────────────────────────────────────

    function isSearchInput(el) {
      if (!el || el.tagName !== 'INPUT') return false;
      const ph = (el.placeholder || '').toLowerCase();
      return ph.includes('buscar linha') ||
             ph.includes('buscar por') ||
             /buscar.*(linha|n[uú]mero|nome)/i.test(ph);
    }

    function findSearchInputIn(scope) {
      scope = scope || document;
      const inputs = scope.querySelectorAll('input[placeholder]');
      for (const inp of inputs) {
        if (isSearchInput(inp)) return inp;
      }
      return null;
    }

    function isSearchButton(el) {
      if (!el || el.tagName !== 'BUTTON') return false;
      const cls = el.className || '';
      return cls.includes('icon-search') || /\bsearch\b/i.test(cls);
    }

    function sanitizeSearchValue(input, force) {
      if (!input) return false;
      const val = input.value || '';

      let shouldSanitize;
      if (force) {
        shouldSanitize = /\d/.test(val) && /\D/.test(val);
      } else {
        shouldSanitize = /\d/.test(val) && /[^\d\s]/.test(val) && !/^[a-zA-ZÀ-ú\s]+$/.test(val);
      }

      if (!shouldSanitize) return false;

      const sanitized = val.replace(/\D/g, '');
      if (sanitized === val || sanitized.length === 0) return false;

      try {
        _sanitizing = true;
        input.value = sanitized;
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } finally {
        _sanitizing = false;
      }

      console.log(`%c[CC] 🧹 Sanitizado: "${val}" → "${sanitized}"`, 'color:#8b5cf6;');
      return true;
    }

    // Sanitização ao digitar
    document.addEventListener('input', (e) => {
      if (!isOn('pesquisaAvancada')) return;
      if (_sanitizing) return;
      if (!isSearchInput(e.target)) return;
      sanitizeSearchValue(e.target, false);
    }, true);

    // Interceptor do botão de busca (capture phase)
    document.addEventListener('click', (e) => {
      if (!isOn('pesquisaAvancada')) return;
      const btn = e.target.closest('button');
      if (!isSearchButton(btn)) return;

      const group = btn.closest('.input-group, form, div');
      let input = group ? findSearchInputIn(group) : null;
      if (!input) input = findSearchInputIn();

      if (input) sanitizeSearchValue(input, true);
    }, true);

    // Enter no input de busca
    document.addEventListener('keydown', (e) => {
      if (!isOn('pesquisaAvancada')) return;
      if (e.key !== 'Enter') return;
      if (!isSearchInput(e.target)) return;

      e.preventDefault();
      e.stopPropagation();
      sanitizeSearchValue(e.target, true);

      const group = e.target.closest('.input-group, form, div');
      let btn = null;
      if (group) {
        const candidates = group.querySelectorAll('button');
        for (const b of candidates) {
          if (isSearchButton(b)) { btn = b; break; }
        }
      }
      if (!btn) {
        const candidates = document.querySelectorAll('button');
        for (const b of candidates) {
          if (isSearchButton(b)) { btn = b; break; }
        }
      }
      if (btn) btn.click();
    }, true);

    // Backspace fecha modal (também parte da Pesquisa Avançada)
    document.addEventListener('keydown', (e) => {
      if (!isOn('pesquisaAvancada')) return;
      if (e.key !== 'Backspace') return;
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (_quotaEmAndamento || _verLinhasEmAndamento) return;
      if (document.getElementById('cc-overlay')?.classList.contains('cc-open')) return;

      const closeBtn = document.querySelector('.modal-content .close');
      if (closeBtn) closeBtn.click();
    });

    // ─────────────────────────────────────────────
    //  4C. FIX CONSUMO DE DADOS
    // ─────────────────────────────────────────────

    function autoSelectAbaConsumo() {
      if (!isOn('fixConsumo')) return;
      const tab = document.querySelector('#consumeData a.anchor-context');
      if (tab && !tab.parentElement.classList.contains('active')) {
        tab.click();
      }
    }

    // ─────────────────────────────────────────────
    //  4D. AUTO-SELEÇÃO DE LINHAS
    //  (cadeia pós-clique manual em "Ver Linhas")
    // ─────────────────────────────────────────────

    function findBtnByText(text, startsWith) {
      startsWith = (startsWith !== false); // default true
      return Array.from(document.querySelectorAll('button')).find(b => {
        const t = b.textContent.trim();
        return startsWith ? t.startsWith(text) : t.includes(text);
      });
    }

    // ─────────────────────────────────────────────
    //  4E. FECHAR SESSÃO EXPIRADA
    //  Dispara via: XHR/fetch LOGIN_EXPIRED + MutationObserver
    // ─────────────────────────────────────────────

    function tryCloseModal() {
      const headers = document.querySelectorAll('.modal-title');
      for (const h of headers) {
        if (h.textContent.trim().includes('Sessão Expirada')) {
          const modal = h.closest('.modal, ngb-modal-window, [role="dialog"]');
          const btn   = modal
            ? modal.querySelector('button.btn-default, button.btn-primary')
            : document.querySelector('.modal-footer button.btn-default');

          if (btn) {
            console.log('%c[CC] 🔑 Modal "Sessão Expirada" encontrado — clicando OK', 'color:#f59e0b;font-weight:bold;');
            btn.click();
            return true;
          }
        }
      }
      return false;
    }

    function scheduleClose() {
      if (!isOn('fecharSessao')) return;
      let attempts = 0;
      const interval = setInterval(() => {
        const closed = tryCloseModal();
        if (closed || ++attempts >= 20) clearInterval(interval);
      }, 100);
    }

    function attachVerLinhasHandlers() {
      const btns = Array.from(document.querySelectorAll('button'))
        .filter(b => b.textContent.trim().startsWith('Ver Linhas'));

      btns.forEach(btn => {
        if (btn.dataset.ccVerLinhas) return;
        btn.dataset.ccVerLinhas = 'true';

        btn.addEventListener('click', (e) => {
          if (!e.isTrusted) return;

          _verLinhasEmAndamento = true;

          setTimeout(async () => {
            // 1. Expandir "Ver mais linhas"
            await sleep(500);
            const btnVerMais = findBtnByText('Ver mais linhas', true);
            if (btnVerMais) btnVerMais.click();
            await sleep(1100);

            // 2. Auto-seleção de Linhas
            if (isOn('autoSelLinhas')) {
              const chkAll = document.querySelector('thead input[type="checkbox"], .panel-body input[type="checkbox"]');
              if (chkAll) {
                if (!chkAll.checked) chkAll.click();
              } else {
                document.querySelectorAll('tbody input[type="checkbox"]').forEach(cb => {
                  if (!cb.checked) cb.click();
                });
              }
            }

            _verLinhasEmAndamento = false;
          }, 300);
        });
      });
    }

    // ─────────────────────────────────────────────
    //  5. MUTATION OBSERVER ÚNICO (debounced)
    // ─────────────────────────────────────────────

    let _debounceObserver = null;

    const observer = new MutationObserver(() => {
      if (_debounceObserver) clearTimeout(_debounceObserver);
      _debounceObserver = setTimeout(() => {
        autoSelectAbaConsumo();
        attachVerLinhasHandlers();
        // Verifica modal de sessão expirada a cada mutação relevante
        if (isOn('fecharSessao')) tryCloseModal();
      }, 100);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    autoSelectAbaConsumo();
    attachVerLinhasHandlers();

    // ─────────────────────────────────────────────
    //  6. UI — FAB + MODAL
    // ─────────────────────────────────────────────

    function getContaAtual() {
      const el = document.querySelector('a.dropdown-toggle');
      if (el) {
        const text = el.textContent || '';
        // Extrai os 10 dígitos consecutivos da conta
        const match = text.match(/\d{10}/);
        if (match) return match[0];
        // Fallback: qualquer sequência longa de dígitos
        const digits = text.replace(/\D/g, '');
        if (digits.length >= 10) return digits.substring(0, 10);
      }
      return 'Conta';
    }

    /* ─────────────────────────────────────────────
     *  v2.5.0 — RESETAR COTA (portado de vivo-gd-painel v3.0.0)
     * ───────────────────────────────────────────── */
    const RC_API = 'https://vivogestao.vivoempresas.com.br/Portal/api';
    const RC_DP  = RC_API + '/datapackconsumption';
    const RC_MG  = RC_API + '/datapackmanagergroup';
    const rcEhGD = (g) => /(^|\s)GD\b|GD CONNECTA/i.test(g.name || '');
    const rcActiveLines = (g) => (g.lines || []).filter(l => String(l.blockConsumptionStatus) !== '1');

    function rcGetSession() {
      const w = pageWindow;
      let s = (w.VG_AUTO && w.VG_AUTO.getSession && w.VG_AUTO.getSession()) ||
              (w.AVG_AUTO && w.AVG_AUTO.getSession && w.AVG_AUTO.getSession()) || {};
      if (!s.sessionId) {
        const u = performance.getEntriesByType('resource').map(e => e.name)
          .filter(x => x.includes('datapackconsumption') && x.includes('loadView')).pop();
        if (u) {
          const p = new URLSearchParams(u.split('?')[1] || '');
          s = { sessionId: p.get('sessionId'), remoteHost: p.get('remoteHost'), remoteIp: p.get('remoteIp'), acessLogin: p.get('acessLogin') };
        }
      }
      return (s && s.sessionId) ? { sessionId: s.sessionId, remoteHost: s.remoteHost || '', remoteIp: s.remoteIp || '', acessLogin: s.acessLogin || '' } : null;
    }

    async function rcLoadView(sess) {
      const qs = new URLSearchParams({ action: 'loadView', technology: '4G', startRow: '1', fetchSize: '500', ...sess });
      const lv = await (await fetch(RC_DP + '?' + qs, { headers: { Accept: 'application/json' }, credentials: 'include' })).json();
      const all = [];
      (function walk(n) {
        if (!n || typeof n !== 'object') return;
        if (n.id != null && n.name != null) all.push(n);
        for (const c of (Array.isArray(n) ? n : Object.values(n))) if (c && typeof c === 'object') walk(c);
      })(lv);
      return all;
    }

    async function rcEditGroup(sess, id, name, quotaGb) {
      const r = await fetch(RC_MG, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          action: 'edit', id: Number(id), name, isData: true, contextVoice: false, is5GPortifolio: 0,
          quota: { value: String(quotaGb), dataPackValueType: 'GB' },
          limit: { dataPackValueType: 'MIN' }, manager: { login: '' },
          overBalanceAllCallsLimit: { dataPackValueType: 'MIN' }, overBalanceAllCallsLimitNextCycleControll: { dataPackValueType: 'MIN' },
          overBalanceLimit: { dataPackValueType: 'R$' }, overBalanceLimitNextCycleControll: { dataPackValueType: 'R$' },
          overBalanceLocalsLimit: { dataPackValueType: 'MIN' }, overBalanceLocalsLimitNextCycleControll: { dataPackValueType: 'MIN' },
          technology: '4G', ...sess,
        }),
      });
      const json = await r.json().catch(() => ({}));
      return { status: r.status, json };
    }

    async function rcResetGrupo(sess, groupId, groupName) {
      const r = await rcEditGroup(sess, Number(groupId), groupName, 0);
      const ok = !!(r.json && (!r.json.severity || r.json.severity === 'info'));
      if (ok) return { ok: true, motivo: 'cota zerada' };
      const motivo = (r.json && r.json.result) || ('HTTP ' + r.status);
      return { ok: false, motivo };
    }

    // Estado do submenu de reset
    let _rcGrupos = [];
    let _rcCarregando = false;

    async function rcCarregarGrupos(container, logBox) {
      if (_rcCarregando) return;
      _rcCarregando = true;
      container.innerHTML = '<div class="cc-rc-msg">Carregando grupos…</div>';
      try {
        const sess = rcGetSession();
        if (!sess) {
          container.innerHTML = '<div class="cc-rc-msg cc-rc-err">Sessão não encontrada. Abra a tela de Consumo de Dados e tente novamente.</div>';
          return;
        }
        // v2.5.0 — TODOS os grupos (só filtra o próprio GD pra não zerar o pool)
        const all = await rcLoadView(sess);
        _rcGrupos = all
          .filter(g => !rcEhGD(g))
          .map(g => ({ id: String(g.id), name: g.name, n: rcActiveLines(g).length }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt', { numeric: true }));
        if (!_rcGrupos.length) {
          container.innerHTML = '<div class="cc-rc-msg">Nenhum grupo encontrado.</div>';
          return;
        }
        container.innerHTML = _rcGrupos.map(g => `
          <label class="cc-rc-row">
            <input type="checkbox" class="cc-rc-cb" value="${g.id}" data-name="${(g.name || '').replace(/"/g,'&quot;')}">
            <span class="cc-rc-nm">${escapeHtmlCC(g.name)}</span>
            <span class="cc-rc-id">${escapeHtmlCC(g.id)}</span>
            <span class="cc-rc-ct ${g.n ? 'has' : ''}">${g.n ? g.n + ' linha(s)' : 'vazio'}</span>
          </label>
        `).join('');
      } catch (e) {
        container.innerHTML = '<div class="cc-rc-msg cc-rc-err">Erro: ' + escapeHtmlCC(e.message || String(e)) + '</div>';
      } finally {
        _rcCarregando = false;
      }
    }

    async function rcExecutarReset(container, logBox, btn) {
      const alvos = [...container.querySelectorAll('.cc-rc-cb:checked')].map(c => ({ id: c.value, name: c.dataset.name || '' }));
      if (!alvos.length) { alert('Marque ao menos 1 grupo.'); return; }
      const comLinhas = alvos.filter(a => {
        const g = _rcGrupos.find(x => x.id === a.id); return g && g.n > 0;
      });
      let msg = 'Resetar cota de ' + alvos.length + ' grupo(s)?';
      if (comLinhas.length) msg += '\n\n⚠️ ' + comLinhas.length + ' grupo(s) tem linhas ativas — o portal Vivo VAI RECUSAR (editGroup 0 só funciona em grupo VAZIO).';
      if (!confirm(msg)) return;
      const sess = rcGetSession();
      if (!sess) { alert('Sessão perdida. Recarregue a página.'); return; }

      btn.disabled = true; btn.textContent = 'Resetando…';
      logBox.innerHTML = '';
      logBox.style.display = 'block';
      let ok = 0, fail = 0;
      for (const a of alvos) {
        const line = document.createElement('div');
        line.className = 'cc-rc-log-line';
        line.textContent = '⏳ ' + a.name + '…';
        logBox.appendChild(line);
        logBox.scrollTop = logBox.scrollHeight;
        try {
          const r = await rcResetGrupo(sess, a.id, a.name);
          if (r.ok) { ok++; line.className = 'cc-rc-log-line cc-rc-ok'; line.textContent = '✅ ' + a.name + ' — ' + r.motivo; }
          else     { fail++; line.className = 'cc-rc-log-line cc-rc-fail'; line.textContent = '❌ ' + a.name + ' — ' + r.motivo; }
        } catch (e) {
          fail++; line.className = 'cc-rc-log-line cc-rc-fail'; line.textContent = '❌ ' + a.name + ' — ' + (e.message || String(e));
        }
        logBox.scrollTop = logBox.scrollHeight;
      }
      const sum = document.createElement('div');
      sum.className = 'cc-rc-log-sum';
      sum.textContent = 'Fim · ' + ok + ' ok · ' + fail + ' falha' + (fail ? ' — revisar' : '');
      logBox.appendChild(sum);
      logBox.scrollTop = logBox.scrollHeight;
      btn.disabled = false; btn.textContent = 'Resetar selecionados';
    }

    function escapeHtmlCC(s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
    }

    function injectStyles() {
      const css = document.createElement('style');
      css.textContent = `
        #cc-fab {
          position: fixed; bottom: 20px; right: 20px; z-index: 99999;
          width: 44px; height: 44px; border-radius: 50%; border: none;
          background: #1e293b; color: #f8fafc; font-size: 20px;
          cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,0.3);
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.2s, background 0.2s; line-height: 1;
        }
        #cc-fab:hover { background: #334155; transform: scale(1.1); }

        #cc-overlay {
          position: fixed; inset: 0; z-index: 100000;
          background: rgba(0,0,0,0.45); display: none;
          align-items: center; justify-content: center;
        }
        #cc-overlay.cc-open { display: flex; }

        #cc-modal {
          background: #ffffff; border-radius: 12px;
          width: 380px; max-width: 90vw;
          box-shadow: 0 8px 32px rgba(0,0,0,0.25); overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          animation: cc-fadeIn 0.2s ease-out;
        }
        @keyframes cc-fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }

        #cc-modal-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px;
          background: #2157d9;
          color: #ffffff;
        }
        #cc-modal-header .cc-title {
          font-size: 15px; font-weight: 600;
          display: flex; align-items: center; gap: 8px;
        }
        #cc-modal-header .cc-close {
          background: none; border: none;
          color: rgba(255,255,255,0.75);
          font-size: 20px; cursor: pointer; padding: 0; line-height: 1;
          transition: color 0.15s;
        }
        #cc-modal-header .cc-close:hover { color: #ffffff; }

        #cc-modal-body { padding: 4px 0; max-height: 65vh; overflow-y: auto; }

        .cc-toggle-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 11px 18px; transition: background 0.15s;
        }
        .cc-toggle-row:hover { background: #f1f5f9; }
        .cc-toggle-label { font-size: 14px; color: #334155; user-select: none; }

        .cc-switch { position: relative; width: 42px; height: 24px; flex-shrink: 0; }
        .cc-switch input { opacity: 0; width: 0; height: 0; }
        .cc-switch .cc-slider {
          position: absolute; inset: 0; background: #cbd5e1; border-radius: 24px;
          cursor: pointer; transition: background 0.2s;
        }
        .cc-switch .cc-slider::before {
          content: ''; position: absolute; width: 18px; height: 18px;
          left: 3px; bottom: 3px; background: #fff; border-radius: 50%;
          transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .cc-switch input:checked + .cc-slider { background: #22c55e; }
        .cc-switch input:checked + .cc-slider::before { transform: translateX(18px); }

        #cc-modal-footer {
          padding: 10px 18px; text-align: center;
          font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;
        }

        /* v2.4.0 — Sub-menu do Modo Privacidade */
        .cc-submenu {
          background: #f8fafc; border-top: 1px solid #e2e8f0;
          padding: 6px 0 8px; display: none;
        }
        .cc-submenu.cc-submenu-open { display: block; }
        .cc-submenu-title {
          font-size: 11px; font-weight: 600; color: #64748b;
          padding: 6px 18px 4px; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .cc-sub-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 18px 8px 32px; transition: background 0.15s;
        }
        .cc-sub-row:hover { background: #eef2f7; }
        .cc-sub-row .cc-sub-label { font-size: 13px; color: #475569; user-select: none; }
        .cc-sub-row .cc-switch { width: 34px; height: 20px; }
        .cc-sub-row .cc-switch .cc-slider::before { width: 14px; height: 14px; }
        .cc-sub-row .cc-switch input:checked + .cc-slider::before { transform: translateX(14px); }

        /* v2.5.0 — Submenu "Resetar Cota" */
        .cc-rc-sub {
          padding: 8px 12px 12px;
        }
        .cc-rc-sub-title {
          font-size: 11px; font-weight: 600; color: #64748b;
          padding: 2px 2px 6px; text-transform: uppercase; letter-spacing: 0.5px;
          display: flex; align-items: center; gap: 8px;
        }
        .cc-rc-sub-title button {
          margin-left: auto; border: 1px solid #cfd9f5; background: #eef3ff;
          color: #2157d9; font: 600 11px "DM Sans", sans-serif; padding: 4px 9px;
          border-radius: 5px; cursor: pointer; transition: .15s;
        }
        .cc-rc-sub-title button:hover:not(:disabled) { background: #2157d9; color: #fff; border-color: #2157d9; }
        .cc-rc-sub-title button:disabled { opacity: .5; cursor: default; }
        .cc-rc-list {
          max-height: 180px; overflow-y: auto; background: #fff;
          border: 1px solid #e2e8f0; border-radius: 6px;
        }
        .cc-rc-msg {
          padding: 12px; font-size: 12px; color: #64748b; text-align: center;
        }
        .cc-rc-msg.cc-rc-err { color: #dc2626; }
        .cc-rc-row {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 10px; border-bottom: 1px solid #f1f5f9; cursor: pointer;
          font-size: 12px; transition: background .12s;
        }
        .cc-rc-row:hover { background: #f8fafc; }
        .cc-rc-row input[type=checkbox] {
          -webkit-appearance: checkbox !important; appearance: checkbox !important;
          width: 14px !important; height: 14px !important;
          opacity: 1 !important; visibility: visible !important;
          display: inline-block !important; position: static !important;
          margin: 0 !important; flex: none; accent-color: #2157d9; cursor: pointer;
          border: 1px solid #c8cdd7;
        }
        .cc-rc-nm { flex: 1; min-width: 0; color: #0f172a; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cc-rc-id {
          font: 400 10.5px "JetBrains Mono", ui-monospace, monospace; color: #94a3b8;
          flex: none;
        }
        .cc-rc-ct { font-size: 10.5px; color: #94a3b8; flex: none; min-width: 55px; text-align: right; }
        .cc-rc-ct.has { color: #e08600; }
        .cc-rc-actions {
          display: flex; gap: 6px; margin-top: 8px;
        }
        .cc-rc-actions button.cc-rc-all,
        .cc-rc-actions button.cc-rc-none {
          border: 1px solid #e2e8f0; background: #fff; color: #64748b;
          font: 500 11px "DM Sans", sans-serif; padding: 6px 10px;
          border-radius: 5px; cursor: pointer;
        }
        .cc-rc-actions button.cc-rc-all:hover,
        .cc-rc-actions button.cc-rc-none:hover { background: #f1f5f9; color: #334155; }
        .cc-rc-actions button.cc-rc-go {
          margin-left: auto; border: 0; background: #dc2626; color: #fff;
          font: 700 11.5px "DM Sans", sans-serif; padding: 6px 12px;
          border-radius: 5px; cursor: pointer;
        }
        .cc-rc-actions button.cc-rc-go:hover:not(:disabled) { background: #b91c1c; }
        .cc-rc-actions button.cc-rc-go:disabled { background: #94a3b8; cursor: default; }
        .cc-rc-log {
          margin-top: 8px; padding: 8px 10px; background: #0f172a;
          border-radius: 5px; max-height: 140px; overflow-y: auto;
          font: 400 10.5px "JetBrains Mono", ui-monospace, monospace;
          color: #cbd5e1; display: none;
        }
        .cc-rc-log-line { padding: 2px 0; color: #cbd5e1; }
        .cc-rc-log-line.cc-rc-ok { color: #4ade80; }
        .cc-rc-log-line.cc-rc-fail { color: #f87171; }
        .cc-rc-log-sum {
          margin-top: 6px; padding-top: 6px; border-top: 1px solid #334155;
          color: #94a3b8; font-weight: 700;
        }

        /* v2.4.0 — Modo Privacidade: aplica blur nos elementos configurados.
           filter:blur mantém layout e interatividade, borra apenas o visual. */
        body.cc-priv-consumo .total-consume-progress,
        body.cc-priv-consumo .total-consume-div,
        body.cc-priv-consumo .plus-tooltip1,
        body.cc-priv-consumo .plus-tooltip2 { filter: blur(8px) !important; }
        body.cc-priv-grupo    div[style*="max-width: 80%"] { filter: blur(7px) !important; }
        body.cc-priv-cliente  div.col-md-3[style*="16%"] p,
        body.cc-priv-cliente  div.col-md-3[style*="width:16%"] p { filter: blur(7px) !important; }
        body.cc-priv-linha    .col-md-2.nopadding-right p { filter: blur(6px) !important; }
        body.cc-priv-cota     .col-md-1.padding-top-9 { filter: blur(6px) !important; }
        body.cc-priv-proxCota .col-md-2.padding-top-9 { filter: blur(6px) !important; }
        /* Nunca borra o próprio painel (defensivo — caso algum seletor casse dentro dele) */
        body.cc-priv-ativo #cc-modal, body.cc-priv-ativo #cc-overlay, body.cc-priv-ativo #cc-fab { filter: none !important; }
      `;
      document.head.appendChild(css);
    }

    function buildUI() {
      injectStyles();

      const fab = document.createElement('button');
      fab.id = 'cc-fab';
      fab.textContent = '⚙';
      fab.title = 'Conecta Cheat — Painel';
      document.body.appendChild(fab);

      const overlay = document.createElement('div');
      overlay.id = 'cc-overlay';
      document.body.appendChild(overlay);

      const modal = document.createElement('div');
      modal.id = 'cc-modal';

      // Header
      const header = document.createElement('div');
      header.id = 'cc-modal-header';
      header.innerHTML = `
        <span class="cc-title">⚙️ <span id="cc-conta-nome">${getContaAtual()}</span></span>
        <button class="cc-close" id="cc-close-btn">✕</button>
      `;
      modal.appendChild(header);

      // Body — apenas toggles simples, sem sub-opções
      const body = document.createElement('div');
      body.id = 'cc-modal-body';

      for (const [key, cfg] of Object.entries(FEATURES)) {
        const row = document.createElement('div');
        row.className = 'cc-toggle-row';
        row.innerHTML = `
          <span class="cc-toggle-label">${cfg.label}</span>
          <label class="cc-switch">
            <input type="checkbox" data-cc-key="${key}" ${isOn(key) ? 'checked' : ''}>
            <span class="cc-slider"></span>
          </label>
        `;
        body.appendChild(row);

        // v2.4.0 — sub-menu de itens (só o "modoPrivacidade" tem)
        if (cfg.sub === 'privacidade') {
          const sub = document.createElement('div');
          sub.className = 'cc-submenu' + (isOn(key) ? ' cc-submenu-open' : '');
          sub.id = 'cc-submenu-privacidade';
          let subHtml = '<div class="cc-submenu-title">Ocultar (blur) durante gravação</div>';
          for (const [pk, pcfg] of Object.entries(PRIVACIDADE_ITENS)) {
            subHtml += `
              <div class="cc-sub-row">
                <span class="cc-sub-label">${pcfg.label}</span>
                <label class="cc-switch">
                  <input type="checkbox" data-cc-priv="${pk}" ${isPrivOn(pk) ? 'checked' : ''}>
                  <span class="cc-slider"></span>
                </label>
              </div>`;
          }
          sub.innerHTML = subHtml;
          body.appendChild(sub);
        }

        // v2.5.0 — submenu de reset de cota
        if (cfg.sub === 'resetCota') {
          const sub = document.createElement('div');
          sub.className = 'cc-submenu' + (isOn(key) ? ' cc-submenu-open' : '');
          sub.id = 'cc-submenu-resetCota';
          sub.innerHTML = `
            <div class="cc-rc-sub">
              <div class="cc-rc-sub-title">
                <span>Selecione o(s) grupo(s)</span>
                <button class="cc-rc-reload" type="button" title="Recarregar lista">↻ Atualizar</button>
              </div>
              <div class="cc-rc-list" id="cc-rc-list"><div class="cc-rc-msg">Ligue e clique em Atualizar</div></div>
              <div class="cc-rc-actions">
                <button class="cc-rc-all" type="button">todos</button>
                <button class="cc-rc-none" type="button">nenhum</button>
                <button class="cc-rc-go" type="button">Resetar selecionados</button>
              </div>
              <div class="cc-rc-log" id="cc-rc-log"></div>
            </div>
          `;
          body.appendChild(sub);
        }
      }

      modal.appendChild(body);

      const footer = document.createElement('div');
      footer.id = 'cc-modal-footer';
      footer.textContent = 'v2.4.0 — Conecta Cheat';
      modal.appendChild(footer);

      overlay.appendChild(modal);

      // Event handlers
      body.addEventListener('change', (e) => {
        const inp = e.target;
        // Feature principal
        if (inp.dataset.ccKey) {
          const key = inp.dataset.ccKey;
          const newState = toggle(key);
          console.log(`%c[CC] ${FEATURES[key].label}: ${newState ? 'ON' : 'OFF'}`, 'color:#3b82f6;font-weight:bold;');
          // v2.4.0 — Modo Privacidade: mostra/esconde sub-menu e re-aplica
          if (key === 'modoPrivacidade') {
            const sub = document.getElementById('cc-submenu-privacidade');
            if (sub) sub.classList.toggle('cc-submenu-open', newState);
            aplicarPrivacidade();
          }
          // v2.5.0 — Resetar Cota: abre/fecha submenu e carrega lista ao abrir
          if (key === 'resetCota') {
            const sub = document.getElementById('cc-submenu-resetCota');
            if (sub) sub.classList.toggle('cc-submenu-open', newState);
            if (newState) {
              const listEl = document.getElementById('cc-rc-list');
              const logEl  = document.getElementById('cc-rc-log');
              if (listEl) rcCarregarGrupos(listEl, logEl);
            }
          }
        }
        // Sub-checkbox de Privacidade
        if (inp.dataset.ccPriv) {
          const pk = inp.dataset.ccPriv;
          const newState = togglePriv(pk);
          console.log(`%c[CC][Priv] ${PRIVACIDADE_ITENS[pk].label}: ${newState ? 'ON' : 'OFF'}`, 'color:#8b5cf6;font-weight:bold;');
          aplicarPrivacidade();
        }
      });

      // v2.5.0 — Handlers do submenu de reset (click delegado)
      body.addEventListener('click', (e) => {
        const listEl = document.getElementById('cc-rc-list');
        const logEl  = document.getElementById('cc-rc-log');
        if (e.target.matches('.cc-rc-reload')) {
          if (listEl) rcCarregarGrupos(listEl, logEl);
        } else if (e.target.matches('.cc-rc-all')) {
          if (listEl) listEl.querySelectorAll('.cc-rc-cb').forEach(c => c.checked = true);
        } else if (e.target.matches('.cc-rc-none')) {
          if (listEl) listEl.querySelectorAll('.cc-rc-cb').forEach(c => c.checked = false);
        } else if (e.target.matches('.cc-rc-go')) {
          if (listEl && logEl) rcExecutarReset(listEl, logEl, e.target);
        }
      });

      function openPanel() {
        const nomeEl = document.getElementById('cc-conta-nome');
        if (nomeEl) nomeEl.textContent = getContaAtual();
        overlay.querySelectorAll('input[data-cc-key]').forEach(inp => {
          inp.checked = isOn(inp.dataset.ccKey);
        });
        overlay.classList.add('cc-open');
      }

      function closePanel() { overlay.classList.remove('cc-open'); }

      fab.addEventListener('click', openPanel);
      document.getElementById('cc-close-btn').addEventListener('click', closePanel);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('cc-open')) closePanel();
      });

      // v2.4.0 — aplica estado inicial de privacidade (persistido)
      aplicarPrivacidade();
    }

    if (document.body) buildUI();
    else window.addEventListener('load', buildUI);

  }); // fim onDomReady

  /* ═══════════════════════════════════════════════════════════
   *  BOOT
   * ═══════════════════════════════════════════════════════════ */

  console.log('%c[Conecta Cheat] ✅ v2.5.0 — carregado (+ Resetar Cota).', 'color:#22c55e;font-weight:bold;');

})();
// ==UserScript==
// @name         VG 2026 - Conecta Cheat
// @namespace    https://vivogestao.vivoempresas.com.br/
// @version      2.3.0
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
    cotaEmLote:       { label: 'Cota em Lote',           default: true },
    pesquisaAvancada: { label: 'Pesquisa Avançada',      default: true },
    fixConsumo:       { label: 'Fix Consumo de Dados',   default: true },
    autoSelLinhas:    { label: 'Auto-seleção de Linhas', default: true },
    fecharSessao:     { label: 'Fechar Sessão Expirada', default: true },
  };

  const state = {};
  for (const [key, cfg] of Object.entries(FEATURES)) {
    state[key] = GM_getValue('cc_' + key, cfg.default);
  }

  function isOn(key)   { return state[key]; }
  function toggle(key) {
    state[key] = !state[key];
    GM_setValue('cc_' + key, state[key]);
    return state[key];
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
      }

      modal.appendChild(body);

      const footer = document.createElement('div');
      footer.id = 'cc-modal-footer';
      footer.textContent = 'v2.3.0 — Conecta Cheat';
      modal.appendChild(footer);

      overlay.appendChild(modal);

      // Event handlers
      body.addEventListener('change', (e) => {
        const inp = e.target;
        if (inp.dataset.ccKey) {
          const key = inp.dataset.ccKey;
          const newState = toggle(key);
          console.log(`%c[CC] ${FEATURES[key].label}: ${newState ? 'ON' : 'OFF'}`, 'color:#3b82f6;font-weight:bold;');
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
    }

    if (document.body) buildUI();
    else window.addEventListener('load', buildUI);

  }); // fim onDomReady

  /* ═══════════════════════════════════════════════════════════
   *  BOOT
   * ═══════════════════════════════════════════════════════════ */

  console.log('%c[Conecta Cheat] ✅ v2.3.0 — carregado.', 'color:#22c55e;font-weight:bold;');

})();
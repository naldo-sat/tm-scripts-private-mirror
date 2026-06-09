// ==UserScript==
// @name         Bloqueio em Massa — Vivo Móvel
// @namespace    http://tampermonkey.net/
// @version      1.5.0
// @updateURL    https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/bloqueio-em-massa-vivo-movel.user.js
// @downloadURL  https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/bloqueio-em-massa-vivo-movel.user.js
// @description  Bloqueio em massa de linhas corporativas no mve.vivo.com.br via planilha Google Sheets
// @author       ConectaChip
// @match        https://mve.vivo.com.br/sec/gestao-chips*
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── CONFIGURAÇÃO ────────────────────────────────────────────────────────────

  const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxY8CzFHbojBzT7Gk45oJxYfIBPCh6oZQjMZSBl7TmE21pP6wQXAkYhVSrRMPgiaURWjQ/exec';

  const BASE_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQKY-HRPH1Ejl_QOFY_clDKrHrnDV4tzreiW8UbY1wJPIlm8qbdZbis277E8-9RT84puIDWcve0vpbz/pub';

  const ABAS_CSV = {
    'NALDO SAT LTDA':     BASE_CSV + '?gid=1609183220&single=true&output=csv',
    'STUDIO ML LTDA':     BASE_CSV + '?gid=1354824519&single=true&output=csv',
    'F DE ASSIS LTDA':    BASE_CSV + '?gid=1427094854&single=true&output=csv',
    'CN ENGENHARIA LTDA': BASE_CSV + '?gid=1247414308&single=true&output=csv',
    'CONNECTA LTDA':      BASE_CSV + '?gid=552535815&single=true&output=csv',
  };

  const COL_NOME   = 0;   // A
  const COL_CPF    = 1;   // B
  const COL_LINHA  = 3;   // D
  const COL_CONTA  = 4;   // E
  const COL_DATA   = 9;   // J — escrita
  const COL_PROTO  = 10;  // K — escrita
  const COL_STATUS = 11;  // L — leitura/escrita

  const STATUS_BLOQUEADA = 'BLOQUEADA';
  const PAINEL_LARGURA   = 370;

  // ─── ESTADO DE SESSÃO ────────────────────────────────────────────────────────

  const SESSION_KEY    = 'vivo_bloqueio_estado';
  const salvarEstado   = obj => { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj)); } catch (_) {} };
  const carregarEstado = ()  => { try { const r = sessionStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; } catch (_) { return null; } };
  const limparEstado   = ()  => { try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {} };

  // ─── CONTROLE ────────────────────────────────────────────────────────────────

  let execucaoAtiva       = false;
  let cancelarRequisitado = false;
  let timerInterval       = null;
  let dadosAba            = [];
  let dadosFiltrados      = [];

  // ─── HELPERS GERAIS ──────────────────────────────────────────────────────────

  const delay      = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
  const normalizar = str => String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const setText    = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

  // Data apenas: dd/MM/yyyy (sem hora)
  function formatarData(date) {
    const d = date || new Date(), p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function formatarDuracao(ms) {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }

  // ─── DETECÇÃO AUTOMÁTICA DE EMPRESA ──────────────────────────────────────────

  function detectarEmpresaPortal() {
    const el = document.querySelector('p.customer-name, [data-e2e-header-customer-name]');
    if (!el) return null;
    const stopwords = new Set(['ltda', 'sa', 'me', 'eireli', 'de', 'da', 'do', 'dos', 'das', 'e', 'o', 'a', 's']);
    const coreWords = str => normalizar(str).split(/\s+/).filter(w => w.length > 1 && !stopwords.has(w));
    const portalCore = coreWords(el.textContent);
    let melhor = null, melhorScore = 0;
    for (const nomeAba of Object.keys(ABAS_CSV)) {
      const abaCore = coreWords(nomeAba);
      if (!abaCore.length) continue;
      const matches = abaCore.filter(w => portalCore.some(pw => pw.includes(w) || w.includes(pw)));
      const score = matches.length / abaCore.length;
      if (score > melhorScore) { melhorScore = score; melhor = nomeAba; }
    }
    return melhorScore >= 0.5 ? melhor : null;
  }

  // ─── PAINEL LATERAL ──────────────────────────────────────────────────────────

  function abrirPainel() {
    document.getElementById('vbm-painel')?.classList.remove('oculto');
    document.body.classList.add('vbm-aberto');
    tentarAutoSelectEmpresa();
  }

  function fecharPainel() {
    document.getElementById('vbm-painel')?.classList.add('oculto');
    document.body.classList.remove('vbm-aberto');
  }

  function tentarAutoSelectEmpresa() {
    const sel = document.getElementById('vbm-aba');
    if (!sel || sel.value) return;
    const empresa = detectarEmpresaPortal();
    if (!empresa) return;
    sel.value = empresa;
    carregarAba(empresa);
    const badge = document.getElementById('vbm-badge-auto');
    if (badge) { badge.textContent = `✓ Detectado: ${empresa}`; badge.style.display = ''; }
  }

  // ─── HELPERS DOM ─────────────────────────────────────────────────────────────

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('Timeout: ' + selector)); }, timeout);
    });
  }

  function waitForElementWithText(selector, text, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const textNorm = normalizar(text);
      const check = () => { for (const el of document.querySelectorAll(selector)) if (normalizar(el.textContent).includes(textNorm)) return el; return null; };
      const found = check();
      if (found) return resolve(found);
      const obs = new MutationObserver(() => { const el = check(); if (el) { obs.disconnect(); resolve(el); } });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('Timeout texto: ' + text)); }, timeout);
    });
  }

  // Aguarda botão estar habilitado (não disabled). Retorna o botão ou null no timeout.
  async function waitForButtonEnabled(selector, timeout = 5000) {
    const fim = Date.now() + timeout;
    while (Date.now() < fim) {
      const btn = document.querySelector(selector);
      if (btn) {
        const isDisabled = btn.disabled ||
                          btn.hasAttribute('disabled') ||
                          btn.classList.contains('disabled') ||
                          btn.getAttribute('aria-disabled') === 'true';
        if (!isDisabled) return btn;
      }
      await delay(80, 120);
    }
    return document.querySelector(selector);
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressEnter(element) {
    ['keydown', 'keypress', 'keyup'].forEach(type =>
      element.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    );
  }

  // ─── CAPTURA DO PROTOCOLO ────────────────────────────────────────────────────

  async function aguardarProtocolo(timeoutMs = 30000) {
    const fim = Date.now() + timeoutMs;
    while (Date.now() < fim) {
      const el = document.querySelector('p.caption.protocol, p.protocol, [class*="protocol"]');
      if (el) {
        const m = String(el.innerText || el.textContent).match(/\d{10,}/);
        if (m) { console.log('[VBM] Protocolo (elemento):', m[0]); return m[0]; }
      }
      const bodyMatch = document.body?.innerText?.match(/Protocolo\s+(\d{10,})/i);
      if (bodyMatch) { console.log('[VBM] Protocolo (body text):', bodyMatch[1]); return bodyMatch[1]; }
      await delay(400, 500);
    }
    console.warn('[VBM] Protocolo não encontrado dentro do timeout.');
    return '';
  }

  // ─── AGUARDA RESULTADO CORRESPONDENTE AO NÚMERO PESQUISADO ───────────────────
  // Garante que o card exibido é da linha atual, não da iteração anterior

  async function aguardarResultado(numeroEsperado, timeoutMs = 12000) {
    const fim = Date.now() + timeoutMs;
    while (Date.now() < fim) {
      const phoneEl  = document.querySelector('[data-test-lines-list-phone-number]');
      const statusEl = document.querySelector('[data-test-lines-list-status]');
      if (phoneEl && statusEl) {
        const phoneDigits = String(phoneEl.innerText || phoneEl.textContent).replace(/\D/g, '');
        if (phoneDigits === numeroEsperado) {
          console.log('[VBM] Card correspondente encontrado:', phoneDigits);
          return statusEl;
        }
      }
      await delay(200, 300);
    }
    console.warn('[VBM] Card correspondente NÃO apareceu para:', numeroEsperado);
    return null;
  }

  // ─── GRAVAÇÃO NA PLANILHA — GM_xmlhttpRequest (Tampermonkey privileged) ──────

  async function gravarBloqueio(aba, linha, dataBloqueio, protocolo, status) {
    const payload = { tipo: 'bloqueio', aba, linha, dataBloqueio, protocolo, status };
    console.log('[VBM] Gravando na planilha:', payload);

    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const result = await new Promise(resolve => {
        GM_xmlhttpRequest({
          method:  'POST',
          url:     WEB_APP_URL,
          headers: { 'Content-Type': 'application/json' },
          data:    JSON.stringify(payload),
          timeout: 30000,
          onload: r => {
            console.log('[VBM] HTTP', r.status, '| finalUrl:', r.finalUrl);
            try {
              const json = JSON.parse(r.responseText);
              console.log('[VBM] Resposta Apps Script:', json);
              resolve(json);
            } catch (_) {
              console.error('[VBM] Resposta não-JSON (preview):', r.responseText?.slice(0, 200));
              resolve({ success: false, error: 'Resposta não-JSON' });
            }
          },
          onerror:   e => { console.error('[VBM] GM erro:', e); resolve({ success: false, error: 'Erro de rede' }); },
          ontimeout: () => { console.error('[VBM] GM timeout'); resolve({ success: false, error: 'Timeout' }); },
        });
      });

      if (result.success) {
        console.log('[VBM] ✅ Planilha gravada:', linha, '| Row:', result.rowIndex);
        return result;
      }
      console.warn(`[VBM] Tentativa ${tentativa}/2 falhou:`, result.error);
      if (tentativa < 2) await delay(1500, 1500);
    }
    return { success: false, error: 'Todas as tentativas falharam' };
  }

  // ─── CSV ─────────────────────────────────────────────────────────────────────

  function parseCSV(text) {
    const rows = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const cols = []; let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"')         { inQ = !inQ; continue; }
        if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
        cur += c;
      }
      cols.push(cur.trim()); rows.push(cols);
    }
    return rows;
  }

  async function buscarLinhasAba(csvUrl) {
    const response = await fetch(csvUrl);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return [];
    return rows.slice(1)
      .map(cols => ({
        nome:   (cols[COL_NOME]   || '').trim(),
        cpf:    (cols[COL_CPF]    || '').replace(/\D/g, '').trim(),
        linha:  (cols[COL_LINHA]  || '').replace(/\D/g, '').trim(),
        conta:  (cols[COL_CONTA]  || '').replace(/\D/g, '').padStart(10, '0'),
        data:   (cols[COL_DATA]   || '').trim(),
        proto:  (cols[COL_PROTO]  || '').trim(),
        status: (cols[COL_STATUS] || '').trim().toUpperCase(),
      }))
      .filter(r => r.linha.length >= 10);
  }

  function aplicarFiltros(dados, { busca, conta, data, status }) {
    return dados.filter(row => {
      if (busca) {
        const b = normalizar(busca), bD = busca.replace(/\D/g, '');
        const matchNome  = normalizar(row.nome).includes(b);
        const matchCPF   = bD.length >= 3 && row.cpf.includes(bD);
        const matchLinha = bD.length >= 3 && row.linha.includes(bD);
        if (!matchNome && !matchCPF && !matchLinha) return false;
      }
      if (conta  && !row.conta.includes(conta.replace(/\D/g, '')))    return false;
      if (data   && !normalizar(row.data).includes(normalizar(data))) return false;
      if (status && row.status !== status.toUpperCase())              return false;
      return true;
    });
  }

  // ─── CSS ─────────────────────────────────────────────────────────────────────

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    body.vbm-aberto { margin-right: ${PAINEL_LARGURA}px !important; transition: margin-right 0.35s cubic-bezier(.4,0,.2,1); }
    body.vbm-aberto #vbm-fab { display: none; }

    #vbm-fab {
      position: fixed; bottom: 28px; right: 28px; width: 52px; height: 52px; border-radius: 50%;
      background: linear-gradient(135deg, #7B2D8B, #5B0D8B); color: #fff; border: none;
      cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 20px rgba(91,13,139,0.45); z-index: 999998; transition: transform .2s;
    }
    #vbm-fab:hover { transform: scale(1.08); }

    #vbm-painel {
      position: fixed; top: 0; right: 0; width: ${PAINEL_LARGURA}px; height: 100vh;
      background: rgba(246,246,250,0.94); backdrop-filter: blur(30px) saturate(180%);
      -webkit-backdrop-filter: blur(30px) saturate(180%); border-left: 1px solid rgba(200,200,220,0.4);
      box-shadow: -6px 0 32px rgba(0,0,0,0.1); z-index: 999997;
      font-family: 'Inter', -apple-system, sans-serif; display: flex; flex-direction: column;
      transition: transform 0.35s cubic-bezier(.4,0,.2,1);
    }
    #vbm-painel.oculto { transform: translateX(100%); }

    #vbm-header { background: linear-gradient(135deg, #7B2D8B, #5B0D8B); padding: 13px 16px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    #vbm-header h2 { margin: 0; flex: 1; font-size: 14px; font-weight: 700; color: #fff; }
    #vbm-btn-fechar { background: rgba(255,255,255,.15); border: none; color: #fff; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; transition: background .15s; }
    #vbm-btn-fechar:hover { background: rgba(255,255,255,.28); }

    #vbm-corpo { flex: 1; overflow-y: auto; padding: 12px 12px 0; display: flex; flex-direction: column; gap: 10px; }

    .vbm-card { background: rgba(255,255,255,.72); border: 1px solid rgba(255,255,255,.85); border-radius: 14px; padding: 12px; box-shadow: 0 1px 6px rgba(0,0,0,.04); }
    .vbm-card-header { display: flex; align-items: center; margin-bottom: 9px; }
    .vbm-card-header h3 { margin: 0; flex: 1; font-size: 10px; font-weight: 600; color: #8e8e93; text-transform: uppercase; letter-spacing: .6px; }
    .vbm-card-header button { background: rgba(0,0,0,.06); border: none; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 10px; color: #636366; display: flex; align-items: center; justify-content: center; transition: background .15s; }
    .vbm-card-header button:hover { background: rgba(0,0,0,.12); }

    #vbm-badge-auto { display: none; font-size: 11px; font-weight: 500; color: #34c759; padding: 2px 0 4px; }

    .vbm-campo { margin-bottom: 7px; }
    .vbm-campo:last-child { margin-bottom: 0; }
    .vbm-label { display: block; font-size: 11px; font-weight: 500; color: #636366; margin-bottom: 3px; }
    .vbm-input, .vbm-select { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid rgba(0,0,0,.11); border-radius: 8px; font-family: 'Inter', sans-serif; font-size: 12.5px; background: rgba(255,255,255,.9); color: #1d1d1f; outline: none; transition: border-color .2s; }
    .vbm-input:focus, .vbm-select:focus { border-color: #7B2D8B; }
    .vbm-filtros-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }

    #vbm-contador { font-size: 12px; font-weight: 600; color: #7B2D8B; padding: 0 0 8px; display: flex; align-items: center; gap: 6px; }
    #vbm-contador .cnt-num { background: #7B2D8B; color: #fff; border-radius: 20px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
    #vbm-preview { display: flex; flex-direction: column; gap: 3px; max-height: 200px; overflow-y: auto; }

    .vbm-row-preview { display: flex; align-items: center; gap: 8px; background: rgba(123,45,139,.06); border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; transition: background .15s; }
    .vbm-row-preview:hover { background: rgba(123,45,139,.14); }
    .vbm-row-preview .rp-num  { font-weight: 700; color: #1d1d1f; flex-shrink: 0; }
    .vbm-row-preview .rp-nome { color: #636366; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .vbm-row-preview .rp-hint { font-size: 10px; color: #a0a0a0; flex-shrink: 0; }

    #vbm-footer { padding: 12px; border-top: 1px solid rgba(0,0,0,.07); background: rgba(246,246,250,.97); flex-shrink: 0; }
    #vbm-btn-iniciar { width: 100%; padding: 12px; background: linear-gradient(135deg, #7B2D8B, #5B0D8B); color: #fff; border: none; border-radius: 12px; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity .2s, transform .1s; }
    #vbm-btn-iniciar:hover:not(:disabled)  { opacity: .88; }
    #vbm-btn-iniciar:active:not(:disabled) { transform: scale(.98); }
    #vbm-btn-iniciar:disabled { opacity: .38; cursor: not-allowed; }

    #vbm-prog-texto { font-size: 13px; font-weight: 600; color: #1d1d1f; text-align: center; }
    #vbm-prog-linha { font-size: 12px; color: #7B2D8B; text-align: center; font-weight: 500; min-height: 16px; }
    #vbm-prog-barra-wrap { background: rgba(0,0,0,.08); border-radius: 100px; height: 6px; overflow: hidden; margin: 4px 0; }
    #vbm-prog-barra { height: 100%; background: linear-gradient(90deg,#7B2D8B,#a855f7); border-radius: 100px; transition: width .4s ease; width: 0%; }
    #vbm-prog-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; text-align: center; }
    .vbm-stat { background: rgba(255,255,255,.8); border-radius: 10px; padding: 8px 4px; }
    .vbm-stat .v { font-size: 20px; font-weight: 700; line-height: 1; }
    .vbm-stat .l { font-size: 10px; color: #8e8e93; font-weight: 500; margin-top: 2px; }
    .vbm-stat.ok .v { color: #34c759; } .vbm-stat.ig .v { color: #7B2D8B; } .vbm-stat.er .v { color: #ff3b30; }
    #vbm-prog-timer { text-align: center; font-size: 11px; color: #8e8e93; }
    #vbm-btn-cancelar { width: 100%; padding: 9px; margin-top: 8px; background: rgba(255,59,48,.08); color: #ff3b30; border: 1px solid rgba(255,59,48,.18); border-radius: 10px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: background .15s; }
    #vbm-btn-cancelar:hover:not(:disabled) { background: rgba(255,59,48,.15); }
    #vbm-btn-cancelar:disabled { opacity: .5; cursor: not-allowed; }

    .vbm-res-row { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 10px; background: rgba(255,255,255,.75); font-size: 13px; font-weight: 500; color: #1d1d1f; margin-bottom: 6px; }
    .vbm-res-row:last-of-type { margin-bottom: 0; }
    .vbm-res-row .ri { font-size: 15px; }
    .vbm-res-row .rv { margin-left: auto; font-weight: 700; font-size: 18px; }
    .vbm-res-row.ok .rv { color: #34c759; } .vbm-res-row.ig .rv { color: #7B2D8B; }
    .vbm-res-row.er .rv { color: #ff3b30; } .vbm-res-row.ti .rv { color: #636366; }
    #vbm-falhas-box { background: #fff3f3; border: 1px solid rgba(255,59,48,.18); border-radius: 10px; padding: 9px 11px; font-family: monospace; font-size: 12px; color: #636366; max-height: 80px; overflow-y: auto; white-space: pre; margin: 6px 0; }
    #vbm-btn-copiar { width: 100%; padding: 9px; background: #f0e5f5; color: #7B2D8B; border: none; border-radius: 10px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity .15s; }
    #vbm-btn-copiar:hover { opacity: .85; }
  `;

  // ─── HTML ─────────────────────────────────────────────────────────────────────

  function criarFAB() {
    const btn = document.createElement('button');
    btn.id = 'vbm-fab'; btn.title = 'Bloqueio em Massa'; btn.textContent = '🔒';
    return btn;
  }

  function criarPainel() {
    const painel = document.createElement('div');
    painel.id = 'vbm-painel'; painel.className = 'oculto';
    painel.innerHTML = `
      <div id="vbm-header">
        <h2>Bloqueio em Massa</h2>
        <button id="vbm-btn-fechar">✕</button>
      </div>
      <div id="vbm-corpo">

        <div class="vbm-card">
          <div class="vbm-campo">
            <label class="vbm-label">Empresa</label>
            <select id="vbm-aba" class="vbm-select">
              <option value="">— Selecione —</option>
              ${Object.keys(ABAS_CSV).map(k => `<option value="${k}">${k}</option>`).join('')}
            </select>
            <div id="vbm-badge-auto"></div>
          </div>
          <div class="vbm-campo">
            <label class="vbm-label">Buscar por nome, CPF ou número</label>
            <input id="vbm-f-busca" class="vbm-input" placeholder="Nome, CPF ou número..." />
          </div>
          <div class="vbm-filtros-grid">
            <div class="vbm-campo">
              <label class="vbm-label">Conta (parcial)</label>
              <input id="vbm-f-conta" class="vbm-input" placeholder="Ex: 5828..." />
            </div>
            <div class="vbm-campo">
              <label class="vbm-label">Data de Bloqueio</label>
              <input id="vbm-f-data" class="vbm-input" placeholder="Ex: 15/05..." />
            </div>
          </div>
          <div class="vbm-campo">
            <label class="vbm-label">Status</label>
            <select id="vbm-f-status" class="vbm-select">
              <option value="BLOQUEAR">BLOQUEAR</option>
              <option value="">Qualquer</option>
              <option value="ATIVA">ATIVA</option>
              <option value="BLOQUEADA">BLOQUEADA</option>
              <option value="RECUPERAR">RECUPERAR</option>
              <option value="CANCELADA">CANCELADA</option>
            </select>
          </div>
        </div>

        <div class="vbm-card" id="vbm-secao-preview" style="display:none">
          <div id="vbm-contador"><span class="cnt-num">0</span> linhas</div>
          <div id="vbm-preview"></div>
        </div>

        <div class="vbm-card" id="vbm-secao-prog" style="display:none">
          <h3 style="margin:0 0 9px;font-size:10px;font-weight:600;color:#8e8e93;text-transform:uppercase;letter-spacing:.6px">Progresso</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div id="vbm-prog-texto">Aguardando...</div>
            <div id="vbm-prog-linha"></div>
            <div id="vbm-prog-barra-wrap"><div id="vbm-prog-barra"></div></div>
            <div id="vbm-prog-stats">
              <div class="vbm-stat ok"><div class="v" id="vst-ok">0</div><div class="l">Bloqueadas</div></div>
              <div class="vbm-stat ig"><div class="v" id="vst-ig">0</div><div class="l">Sincroniz.</div></div>
              <div class="vbm-stat er"><div class="v" id="vst-er">0</div><div class="l">Falhas</div></div>
            </div>
            <div id="vbm-prog-timer">⏱️ 0s</div>
            <button id="vbm-btn-cancelar">⏹ Cancelar execução</button>
          </div>
        </div>

        <div class="vbm-card" id="vbm-secao-resultado" style="display:none">
          <div class="vbm-card-header">
            <h3>Resultado</h3>
            <button id="vbm-btn-fechar-resultado" title="Fechar">✕</button>
          </div>
          <div id="vbm-resultado-corpo"></div>
        </div>

      </div>
      <div id="vbm-footer">
        <button id="vbm-btn-iniciar" disabled>Iniciar Bloqueio em Massa</button>
      </div>
    `;
    return painel;
  }

  // ─── PRÉVIA ──────────────────────────────────────────────────────────────────

  const obterFiltros = () => ({
    busca:  (document.getElementById('vbm-f-busca')?.value  || '').trim(),
    conta:  (document.getElementById('vbm-f-conta')?.value  || '').trim(),
    data:   (document.getElementById('vbm-f-data')?.value   || '').trim(),
    status: (document.getElementById('vbm-f-status')?.value || '').trim(),
  });

  function atualizarPrevia() {
    dadosFiltrados = aplicarFiltros(dadosAba, obterFiltros());
    const secao   = document.getElementById('vbm-secao-preview');
    const preview = document.getElementById('vbm-preview');
    const btnIni  = document.getElementById('vbm-btn-iniciar');
    const cntNum  = document.querySelector('#vbm-contador .cnt-num');
    if (secao)  secao.style.display = dadosAba.length > 0 ? '' : 'none';
    if (btnIni) btnIni.disabled     = dadosFiltrados.length === 0 || execucaoAtiva;
    if (cntNum) cntNum.textContent  = dadosFiltrados.length;
    if (!preview) return;
    preview.innerHTML = '';
    dadosFiltrados.slice(0, 12).forEach(row => {
      const div = document.createElement('div');
      div.className = 'vbm-row-preview';
      div.title = 'Clique para buscar no portal';
      div.innerHTML = `<span class="rp-num">${row.linha}</span><span class="rp-nome">${row.nome}</span><span class="rp-hint">↗</span>`;
      div.addEventListener('click', () => buscarLinhaNoPortal(row.linha));
      preview.appendChild(div);
    });
    if (dadosFiltrados.length > 12) {
      const mais = document.createElement('div');
      mais.style.cssText = 'text-align:center;font-size:11px;color:#8e8e93;padding:5px 0 2px';
      mais.textContent = `... e mais ${dadosFiltrados.length - 12}`;
      preview.appendChild(mais);
    }
  }

  async function carregarAba(nomeAba) {
    dadosAba = []; dadosFiltrados = [];
    const secao  = document.getElementById('vbm-secao-preview');
    const cntNum = document.querySelector('#vbm-contador .cnt-num');
    const btnIni = document.getElementById('vbm-btn-iniciar');
    if (secao)  secao.style.display  = '';
    if (cntNum) cntNum.textContent   = '…';
    if (btnIni) btnIni.disabled      = true;
    try {
      dadosAba = await buscarLinhasAba(ABAS_CSV[nomeAba]);
      atualizarPrevia();
    } catch (e) {
      if (cntNum) cntNum.textContent = '⚠️';
      console.error('[VBM]', e.message);
    }
  }

  // ─── BUSCAR LINHA NO PORTAL (clique na prévia) ────────────────────────────────

  async function buscarLinhaNoPortal(numero) {
    const input = document.querySelector('input#filterInput, input[data-test-search-input-field]');
    if (!input) return;
    input.focus();
    setInputValue(input, '');
    await delay(100, 150);
    setInputValue(input, numero);
    await delay(250, 400);
    pressEnter(input);
  }

  // ─── LOOP DE EXECUÇÃO ─────────────────────────────────────────────────────────

  async function executarLote(linhas, aba) {
    execucaoAtiva = true; cancelarRequisitado = false;
    const total = linhas.length;
    let ok = 0, ignoradas = 0, falhas = 0;
    const listaFalhas = [];
    const inicio = Date.now();

    const secRes  = document.getElementById('vbm-secao-resultado');
    const secProg = document.getElementById('vbm-secao-prog');
    if (secRes)  secRes.style.display  = 'none';
    if (secProg) secProg.style.display = '';
    const btnIni = document.getElementById('vbm-btn-iniciar');
    if (btnIni) btnIni.disabled = true;

    timerInterval = setInterval(() => setText('vbm-prog-timer', '⏱️ ' + formatarDuracao(Date.now() - inicio)), 1000);
    salvarEstado({ aba, linhasPendentes: linhas.map(r => r.linha), inicio });

    for (let i = 0; i < total; i++) {
      if (cancelarRequisitado) break;
      const row = linhas[i];
      atualizarBarra(i + 1, total, row.linha, ok, ignoradas, falhas);
      const res = await processarLinha(row.linha, aba);
      if      (res === 'ok')       ok++;
      else if (res === 'ignorada') ignoradas++;
      else                         { falhas++; listaFalhas.push(row.linha); }
      atualizarBarra(i + 1, total, row.linha, ok, ignoradas, falhas);

      // Entre linhas: aguarda input estar disponível + delay curto (1.5-2s)
      if (i < total - 1 && !cancelarRequisitado) {
        try { await waitForElement('input#filterInput, input[data-test-search-input-field]', 8000); } catch (_) {}
        await delay(1500, 2000);
      }
    }

    clearInterval(timerInterval);
    limparEstado();
    execucaoAtiva = false; cancelarRequisitado = false;
    exibirResultadoInline({ total, ok, ignoradas, falhas, listaFalhas, duracao: Date.now() - inicio });
  }

  function atualizarBarra(atual, total, linha, ok, ig, er) {
    setText('vbm-prog-texto', `Linha ${atual} de ${total}`);
    setText('vbm-prog-linha', linha);
    const barra = document.getElementById('vbm-prog-barra');
    if (barra) barra.style.width = Math.round((atual / total) * 100) + '%';
    setText('vst-ok', ok); setText('vst-ig', ig); setText('vst-er', er);
  }

  // ─── PROCESSAMENTO DE UMA LINHA ───────────────────────────────────────────────

  async function processarLinha(numero, aba) {
    try {
      const input = await waitForElement('input#filterInput, input[data-test-search-input-field]', 10000);
      input.focus();

      // 1. Limpa o campo (evita resultado residual da iteração anterior)
      setInputValue(input, '');
      await delay(150, 250);

      // 2. Cola o número e pressiona Enter
      setInputValue(input, numero);
      await delay(350, 600);
      pressEnter(input);

      // 3. Aguarda APARECER UM CARD CORRESPONDENTE AO NÚMERO PESQUISADO
      //    (evita ler o status residual da iteração anterior)
      const statusEl = await aguardarResultado(numero, 12000);
      if (!statusEl) {
        console.log('[VBM] Não encontrada no portal:', numero);
        return 'falha';
      }

      const situacao = normalizar(statusEl.innerText || statusEl.textContent);
      console.log('[VBM] Situação lida para', numero, ':', JSON.stringify(situacao));

      // 4. Decisão: comparação exata (não usa includes — evita falsos positivos)
      if (situacao === 'ativa') {
        return await fluxoBloqueio(numero, aba);
      } else if (situacao === 'bloqueada' || situacao === 'bloqueado') {
        const res = await gravarBloqueio(aba, numero, formatarData(new Date()), '', STATUS_BLOQUEADA);
        console.log('[VBM] Já bloqueada — sincronizada:', numero, res?.success ? '✅' : '❌');
        return 'ignorada';
      } else {
        console.log('[VBM] Situação ignorada (' + situacao + '):', numero);
        return 'falha';
      }
    } catch (e) {
      console.error('[VBM] Erro em', numero, ':', e.message);
      return 'falha';
    }
  }

  // ─── FLUXO COMPLETO DE BLOQUEIO ───────────────────────────────────────────────

  async function fluxoBloqueio(numero, aba) {
    // 1. Gerenciar linha
    const btnGerenciar = await waitForElement('[data-test-manage-line-button]', 8000);
    await delay(500, 800);
    btnGerenciar.click();

    // 2. Bloquear por perda ou roubo
    const btnPerda = await waitForElementWithText('p.body-1', 'Bloquear por perda ou roubo', 12000);
    await delay(700, 1100);
    btnPerda.click();

    // 3. Checkbox de declaração
    const checkbox = await waitForElement('input#checkbox-id', 10000);
    await delay(500, 800);
    if (!checkbox.checked) {
      const label = document.querySelector('label[for="checkbox-id"]') || checkbox.closest('label');
      if (label) label.click(); else checkbox.click();
    }

    // 4. Bloquear linha — espera ATIVAR o botão (em vez de delay fixo)
    const btnBloquear = await waitForButtonEnabled('button.mve-button.primary.text-size-button, button.mve-button.primary', 5000);
    if (!btnBloquear) throw new Error('Botão Bloquear linha não habilitou');
    await delay(500, 800); // delay humanizado curto (apenas suavização)
    btnBloquear.click();

    // 5. Captura do protocolo
    const protocolo = await aguardarProtocolo(30000);

    // 6. GRAVA NA PLANILHA imediatamente — antes de navegar
    const dataHoje = formatarData(new Date());
    const resGravacao = await gravarBloqueio(aba, numero, dataHoje, protocolo, STATUS_BLOQUEADA);
    if (resGravacao?.success) {
      console.log('[VBM] ✅ Concluído:', numero, '| Proto:', protocolo, '| Row:', resGravacao.rowIndex);
    } else {
      console.error('[VBM] ❌ Bloqueio OK no portal, mas falha ao gravar:', numero, '| Proto:', protocolo, '| Erro:', resGravacao?.error);
    }

    // 7. Ir para o início
    try {
      const btnInicio = await waitForElement('[data-test-go-home-button]', 8000);
      await delay(600, 1000);
      btnInicio.click();
    } catch (_) { console.warn('[VBM] Botão "Ir para o início" não encontrado:', numero); }

    // 8. Aguarda campo de busca voltar
    try { await waitForElement('input#filterInput, input[data-test-search-input-field]', 10000); } catch (_) {}

    return 'ok';
  }

  // ─── RESULTADO INLINE ─────────────────────────────────────────────────────────

  function exibirResultadoInline({ total, ok, ignoradas, falhas, listaFalhas, duracao }) {
    const secProg = document.getElementById('vbm-secao-prog');
    if (secProg) secProg.style.display = 'none';

    const secRes = document.getElementById('vbm-secao-resultado');
    const corpo  = document.getElementById('vbm-resultado-corpo');
    if (!secRes || !corpo) return;

    const temFalhas = listaFalhas.length > 0;
    corpo.innerHTML = `
      <div class="vbm-res-row ok"><span class="ri">✅</span> Bloqueadas com sucesso    <span class="rv">${ok}</span></div>
      <div class="vbm-res-row ig"><span class="ri">⏭️</span> Já bloqueadas (sincroniz.) <span class="rv">${ignoradas}</span></div>
      <div class="vbm-res-row er"><span class="ri">❌</span> Falhas / puladas           <span class="rv">${falhas}</span></div>
      <div class="vbm-res-row ti"><span class="ri">⏱️</span> Tempo total                <span class="rv">${formatarDuracao(duracao)}</span></div>
      ${temFalhas ? `
        <div style="font-size:11px;font-weight:600;color:#8e8e93;margin-top:6px">Linhas com falha:</div>
        <div id="vbm-falhas-box">${listaFalhas.join('\n')}</div>
        <button id="vbm-btn-copiar">📋 Copiar falhas</button>
      ` : ''}
    `;

    secRes.style.display = '';
    secRes.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    atualizarPrevia();

    if (temFalhas) {
      document.getElementById('vbm-btn-copiar')?.addEventListener('click', () => {
        const texto = listaFalhas.join('\n');
        const fallback = () => { const ta = document.createElement('textarea'); ta.value = texto; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_) {} ta.remove(); };
        if (navigator.clipboard) navigator.clipboard.writeText(texto).catch(fallback); else fallback();
        const btn = document.getElementById('vbm-btn-copiar');
        if (btn) { btn.textContent = '✅ Copiado!'; setTimeout(() => { btn.textContent = '📋 Copiar falhas'; }, 2000); }
      });
    }
  }

  // ─── EVENTOS ──────────────────────────────────────────────────────────────────

  function ligarEventos() {
    document.getElementById('vbm-fab').addEventListener('click', abrirPainel);
    document.getElementById('vbm-btn-fechar').addEventListener('click', fecharPainel);

    document.getElementById('vbm-btn-fechar-resultado').addEventListener('click', () => {
      const secRes = document.getElementById('vbm-secao-resultado');
      if (secRes) secRes.style.display = 'none';
    });

    document.getElementById('vbm-aba').addEventListener('change', e => {
      const badge = document.getElementById('vbm-badge-auto');
      if (badge) badge.style.display = 'none';
      const aba = e.target.value;
      if (aba) { carregarAba(aba); } else {
        dadosAba = []; dadosFiltrados = [];
        const s = document.getElementById('vbm-secao-preview'); if (s) s.style.display = 'none';
        const b = document.getElementById('vbm-btn-iniciar');   if (b) b.disabled = true;
      }
    });

    ['vbm-f-busca', 'vbm-f-conta', 'vbm-f-data', 'vbm-f-status'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.addEventListener('input', atualizarPrevia); el.addEventListener('change', atualizarPrevia); }
    });

    document.getElementById('vbm-btn-iniciar').addEventListener('click', async () => {
      if (dadosFiltrados.length === 0 || execucaoAtiva) return;
      const aba = document.getElementById('vbm-aba')?.value;
      if (!aba) return;
      await executarLote([...dadosFiltrados], aba);
    });

    document.getElementById('vbm-btn-cancelar').addEventListener('click', () => {
      cancelarRequisitado = true;
      const btn = document.getElementById('vbm-btn-cancelar');
      if (btn) { btn.textContent = '⏳ Cancelando...'; btn.disabled = true; }
    });
  }

  // ─── RETOMADA DE SESSÃO ───────────────────────────────────────────────────────

  function verificarRetomada() {
    const estado = carregarEstado();
    if (!estado?.aba || !ABAS_CSV[estado.aba]) return;
    const pendentes = estado.linhasPendentes || [];
    if (!pendentes.length) { limparEstado(); return; }
    if (!confirm(`🔄 Execução interrompida\nEmpresa: ${estado.aba}\nPendentes: ${pendentes.length} linha(s)\n\nDeseja retomar?`)) { limparEstado(); return; }
    const sel = document.getElementById('vbm-aba');
    if (sel) sel.value = estado.aba;
    carregarAba(estado.aba).then(() => {
      const linhasRetomar = dadosFiltrados.filter(r => pendentes.includes(r.linha));
      if (linhasRetomar.length > 0) { abrirPainel(); executarLote(linhasRetomar, estado.aba); }
      else { limparEstado(); alert('Nenhuma linha pendente encontrada.'); }
    });
  }

  // ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────

  function inicializar() {
    if (document.getElementById('vbm-fab')) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    document.body.appendChild(criarFAB());
    document.body.appendChild(criarPainel());
    ligarEventos();
    verificarRetomada();
    console.log('[VBM] 🔒 Bloqueio em Massa v1.5.0 — ConectaChip — pronto');
  }

  if (document.body) { inicializar(); }
  else {
    const obs = new MutationObserver(() => { if (document.body) { obs.disconnect(); inicializar(); } });
    obs.observe(document.documentElement, { childList: true });
  }

})();
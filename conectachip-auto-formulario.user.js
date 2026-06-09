// ==UserScript==
// @name         ConectaChip – Auto formulário
// @namespace    http://tampermonkey.net/
// @version      3.3
// @updateURL    https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/conectachip-auto-formulario.user.js
// @downloadURL  https://raw.githubusercontent.com/naldo-sat/tm-scripts-private-mirror/main/conectachip-auto-formulario.user.js
// @description  Paste distribui dados pelo form; botão Enviar cadastra no GestãoClick e submete ao Perfex.
// @match        https://app.cchip.com.br/forms/quote/*
// @grant        GM_xmlhttpRequest
// @connect      api.gestaoclick.com
// @run-at       document-idle
// ==/UserScript==

// ─────────────────────────────────────────────────────────────────────────────
// ATENÇÃO — INJEÇÃO NO IFRAME
// Tampermonkey → Dashboard → script → Configurações → "Executar em iframes" → Ativado
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Credenciais GestãoClick ──────────────────────────────────────────────────
  const GC_ACCESS_TOKEN = 'a6cadc69e8d51b10268ea0e0abcf795ee32ecf46';
  const GC_SECRET_TOKEN = '128ce0dbf9611a0d5d5aa68162ea4477c0107011';
  const GC_LOJA_ID      = '158520';
  const GC_URL          = `https://api.gestaoclick.com/clientes?loja_id=${GC_LOJA_ID}`;

  // ── Atributos customizados no GestãoClick ────────────────────────────────────
  const ATTR_LINHA      = '38466'; // Nº Linha
  const ATTR_VENCIMENTO = '38625'; // Vencimento
  const ATTR_CONTA      = '38626'; // Conta

  // ── Mapeamento posicional: input[N] → campo da API ───────────────────────────
  // null = campo ignorado no envio ao GestãoClick
  // gc:'addr' → bloco enderecos[0].endereco
  // gc:'attr' → atributo customizado (requer id)
  // demais    → campo direto no payload raiz
  const FIELD_MAP = [
    { gc: 'nome'                     },  // 0  Nome Completo
    { gc: 'cpf'                      },  // 1  CPF
    { gc: 'celular'                  },  // 2  WhatsApp
    { gc: 'email'                    },  // 3  Email
    { gc: 'addr', key: 'cep'         },  // 4  CEP
    { gc: 'addr', key: 'logradouro'  },  // 5  Endereço
    { gc: 'addr', key: 'bairro'      },  // 6  Bairro
    { gc: 'addr', key: 'nome_cidade' },  // 7  Cidade
    { gc: 'addr', key: 'estado'      },  // 8  Estado
    null,                                // 9  CD Afiliado — ignorado
    { gc: 'attr', id: ATTR_LINHA      }, // 10 Nº da linha
    { gc: 'attr', id: ATTR_CONTA      }, // 11 Conta
    { gc: 'attr', id: ATTR_VENCIMENTO }, // 12 Vencimento
    null,                                // 13 Plano — ignorado
    null,                                // 14 Foto — ignorado (file input)
  ];

  const HIGHLIGHT_COLOR    = '#22c55e';
  const HIGHLIGHT_DURATION = 2500;

  // ════════════════════════════════════════════════════════════════════════════
  // BLOCO 1 — PASTE
  // ════════════════════════════════════════════════════════════════════════════

  function getFormInputs() {
    const form = document.querySelector('form');
    if (!form) return [];
    return Array.from(form.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="number"]'
    ));
  }

  // Extrai valores em ordem posicional; ignora o texto das chaves.
  function parseClipboard(text) {
    return text.split(/\r?\n/).map(line => {
      const idx = line.indexOf(':');
      return idx < 0 ? null : line.slice(idx + 1).trim();
    }).filter(v => v !== null);
  }

  function fillForm(values) {
    const inputs = getFormInputs();
    const filled = [];
    values.forEach((val, i) => {
      const input = inputs[i];
      if (!input) return;
      input.value = val;
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (val) filled.push(input);
    });
    if (filled.length) highlightInputs(filled);
  }

  function highlightInputs(inputs) {
    inputs.forEach(input => {
      const oO = input.style.outline;
      const oT = input.style.transition;
      const oS = input.style.boxShadow;
      input.style.transition = 'outline 0.2s ease, box-shadow 0.2s ease';
      input.style.outline    = `2px solid ${HIGHLIGHT_COLOR}`;
      input.style.boxShadow  = `0 0 0 4px ${HIGHLIGHT_COLOR}26`;
      setTimeout(() => {
        input.style.outline    = oO || '';
        input.style.boxShadow  = oS || '';
        input.style.transition = oT || '';
      }, HIGHLIGHT_DURATION);
    });
  }

  function attachPasteListener(input) {
    if (input._ccPasteAttached) return;
    input._ccPasteAttached = true;
    input.addEventListener('paste', e => {
      const raw = (e.clipboardData || window.clipboardData).getData('text');
      if (!raw || !raw.includes(':')) return;
      const values = parseClipboard(raw);
      if (values.length < 2) return;
      e.preventDefault();
      fillForm(values);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BLOCO 2 — SUBMIT → GESTÃOCLICK → PERFEX
  // ════════════════════════════════════════════════════════════════════════════

  // Tenta extrair número da residência do logradouro.
  // Suporta: "Rua X, 35, Bairro" · "Av Y nº 100" · "Rua Z, S/N"
  function extractAddressNumber(logradouro) {
    const parts = logradouro.split(',').map(p => p.trim());
    for (const part of parts) {
      if (/^(\d+[A-Za-z]?|[Ss]\/[Nn])$/.test(part)) return part;
    }
    const m = logradouro.match(/(?:,\s*|[Nn][º°]?\s*)(\d+[A-Za-z]?)\b/);
    return m ? m[1] : '';
  }

  function buildGCPayload() {
    const inputs    = getFormInputs();
    const payload   = { tipo_pessoa: 'PF' };
    const endereco  = {};
    const atributos = [];

    FIELD_MAP.forEach((map, i) => {
      if (!map) return;
      const val = inputs[i] ? inputs[i].value.trim() : '';

      if (map.gc === 'addr') {
        endereco[map.key] = val;
        if (map.key === 'logradouro') {
          const num = extractAddressNumber(val);
          if (num) endereco.numero = num;
        }
        return;
      }

      if (map.gc === 'attr') {
        if (val) atributos.push({ atributo_id: map.id, conteudo: val });
        return;
      }

      payload[map.gc] = val;
    });

    if (Object.keys(endereco).length) payload.enderecos = [{ endereco }];
    if (atributos.length) payload.atributos = atributos.map(a => ({ atributo: a }));
    return payload;
  }

  function postToGC(payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url:    GC_URL,
        headers: {
          'Content-Type':        'application/json',
          'access-token':        GC_ACCESS_TOKEN,
          'secret-access-token': GC_SECRET_TOKEN,
        },
        data:    JSON.stringify(payload),
        timeout: 15000,
        onload(res) {
          console.log('[CC] GC:', res.status, res.responseText);
          if (res.status >= 200 && res.status < 300) { resolve(res); return; }
          let msg = `HTTP ${res.status}`;
          try {
            const b = JSON.parse(res.responseText);
            if (b.message) msg = b.message;
            else if (b.errors) msg = Object.values(b.errors).flat().join('; ');
          } catch (_) {}
          reject(new Error(msg));
        },
        onerror()   { reject(new Error('Falha de rede.')); },
        ontimeout() { reject(new Error('Timeout — GestãoClick não respondeu.')); },
      });
    });
  }

  // ── Div de status (abaixo do botão Enviar) ───────────────────────────────────

  let _statusDiv = null;

  function ensureStatusDiv(btn) {
    if (_statusDiv) return;
    _statusDiv = document.createElement('div');
    Object.assign(_statusDiv.style, {
      marginTop: '10px', padding: '10px 14px', borderRadius: '4px',
      fontSize: '0.875em', lineHeight: '1.4', display: 'none',
    });
    btn.insertAdjacentElement('afterend', _statusDiv);
  }

  function showStatus(msg, type) {
    if (!_statusDiv) return;
    _statusDiv.textContent = msg;
    _statusDiv.style.display = 'block';
    const themes = {
      loading: { background: '#eff6ff', color: '#1e40af', border: '1px solid #93c5fd' },
      error:   { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' },
    };
    if (themes[type]) Object.assign(_statusDiv.style, themes[type]);
  }

  function attachSubmitInterceptor() {
    const form = document.querySelector('form');
    const btn  = document.getElementById('form_submit');
    if (!form || !btn || form._ccSubmitAttached) return;
    form._ccSubmitAttached = true;
    ensureStatusDiv(btn);

    form.addEventListener('submit', async e => {
      if (form._ccGcDone) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      btn.disabled = true;
      const spinner = btn.querySelector('.fa-spinner');
      if (spinner) spinner.classList.remove('hide');
      showStatus('⏳ Cadastrando no GestãoClick…', 'loading');

      const payload = buildGCPayload();
      console.log('[CC] payload:', JSON.stringify(payload, null, 2));

      try {
        await postToGC(payload);
        showStatus('✅ Cadastrado no GestãoClick! Enviando para o Perfex…', 'loading');
        form._ccGcDone = true;
        // btn.click() dispara o submit normalmente → nosso handler vê _ccGcDone=true
        // e sai imediatamente → Perfex processa o envio uma única vez.
        // form.submit() não usa esse caminho e causava duplo envio.
        btn.click();

      } catch (err) {
        console.error('[CC] Erro GC:', err);
        btn.disabled = false;
        if (spinner) spinner.classList.add('hide');
        showStatus(`❌ Falha no GestãoClick: ${err.message} — Dados mantidos.`, 'error');
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════════════════════════

  function init() {
    getFormInputs().forEach(attachPasteListener);
    attachSubmitInterceptor();
  }

  init();

  new MutationObserver(init).observe(document.documentElement, {
    childList: true,
    subtree:   true,
  });

})();
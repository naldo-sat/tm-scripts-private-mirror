// ==UserScript==
// @name         Acessos VG
// @namespace    http://tampermonkey.net/
// @version      1.9.0
// @description  Modal de Acessos + Status da planilha + Registro de status no logout + Extração de dados de consumo
// @author       Videljr
// @match        https://vivogestao.vivoempresas.com.br/Portal/*
// @updateURL    https://raw.githubusercontent.com/Videljr/acesso-vivo-gestao-script/main/Acessos-Vivo-Gestao.user.js
// @downloadURL  https://raw.githubusercontent.com/Videljr/acesso-vivo-gestao-script/main/Acessos-Vivo-Gestao.user.js
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ─── CONFIGURAÇÃO DO WEB APP ─────────────────────────────────────────────────
    // Após publicar o Apps Script no Google, cole a URL gerada abaixo.
    const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyTFeoT4YlDVsMHssirQXUcRf55JyojZymykl9ygY8u9f_xvRBEMZ8nd68Zj3A9Xl6o/exec';

    // ─── ESTADO DE SESSÃO ────────────────────────────────────────────────────────

    // Timestamp de sessão: restaurado do sessionStorage (sobrevive à
    // navegação login → portal) e marcado na detecção do login via XHR
    const _SESSION_TS_KEY = 'vg_loginTimestamp';
    let _loginTimestamp = (function() {
        try {
            const v = sessionStorage.getItem(_SESSION_TS_KEY);
            return v ? parseInt(v, 10) : null;
        } catch(_) { return null; }
    })();

    // Item 3 — status local por conta (tempo real, validade 1h)
    // Sobrescreve o status da planilha quando disponível e fresco
    const _STATUS_KEY    = 'vg_statusLocal';
    const _STATUS_EXPIRY = 60 * 60 * 1000; // 1 hora em ms

    let _statusLocal = (function() {
        try {
            const raw = sessionStorage.getItem(_STATUS_KEY);
            if (!raw) return {};
            const obj  = JSON.parse(raw);
            const agora = Date.now();
            Object.keys(obj).forEach(k => {
                if (agora - (obj[k].ts || 0) > _STATUS_EXPIRY) delete obj[k];
            });
            return obj;
        } catch(_) { return {}; }
    })();

    function salvarStatusLocal(conta, status, observacao) {
        _statusLocal[conta] = {
            status:     status,
            observacao: observacao || '',
            ts:         Date.now()
        };
        try { sessionStorage.setItem(_STATUS_KEY, JSON.stringify(_statusLocal)); } catch(_) {}
    }

    function obterObsLocalFresca(conta) {
        const local = _statusLocal[conta];
        if (!local) return null;
        if (Date.now() - (local.ts || 0) >= _STATUS_EXPIRY) return null;
        return local.observacao || null;
    }

    // ─── CONTAS POR CNPJ (modal de login) ────────────────────────────────────────
    const contasPorCNPJ = {
        "NALDO SAT": [
            { nome: "0455828133" },
            { nome: "0459325639" },
            { nome: "0453979554" },
            { nome: "0444346918" },
            { nome: "0450619128" }
        ],
        "STUDIO MATHEUS": [
            { nome: "0452109744" },
            { nome: "0454860388" },
            { nome: "0444225746" },
            { nome: "0457460616" },
            { nome: "0462105797" },
            { nome: "0466121938" }
        ],
        "F DE ASSIS": [
            { nome: "0463297834" },
            { nome: "0451176465" },
            { nome: "0443889484" },
            { nome: "0461401781" }
        ],
        "CONNECTA": [
            { nome: "0469102728" },
            { nome: "0469103350" }
        ],
        "CN ENGENHARIA": [
            { nome: "0468571160" },
            { nome: "0469296149" },
            { nome: "0469301552" }
        ]
    };

    // ─── MAPEAMENTO CONTA → ABA DA PLANILHA (para escrita) ───────────────────────
    const abasPorConta = {
        "0455828133": "NALDO SAT",
        "0459325639": "NALDO SAT",
        "0453979554": "NALDO SAT",
        "0444346918": "NALDO SAT",
        "0450619128": "NALDO SAT",
        "0452109744": "STUDIO ML",
        "0454860388": "STUDIO ML",
        "0444225746": "STUDIO ML",
        "0457460616": "STUDIO ML",
        "0462105797": "STUDIO ML",
        "0466121938": "STUDIO ML",
        "0463297834": "F DE ASSIS",
        "0451176465": "F DE ASSIS",
        "0443889484": "F DE ASSIS",
        "0461401781": "F DE ASSIS",
        "0469102728": "CONNECTA",
        "0469103350": "CONNECTA",
        "0468571160": "CN Engenharia",
        "0469296149": "CN Engenharia",
        "0469301552": "CN Engenharia",
        "0469288595": "CN Engenharia"
    };

    // ─── DETECÇÃO DE LOGIN VIA XHR ──────────────────────────────────────────────
    (function detectarLogin() {
        // ── open: captura URL e método para uso posterior no send ────────────
        const OrigOpen = unsafeWindow.XMLHttpRequest.prototype.open;
        unsafeWindow.XMLHttpRequest.prototype.open = function(method, url) {
            this._csMethod = (method || '').toUpperCase();
            this._csUrl    = url || '';
            return OrigOpen.apply(this, arguments);
        };

        // ── send: detecta login POST bem-sucedido em datapackcompanyinfo ─────
        // Condição: POST + URL contém datapackcompanyinfo + body.action = "login" + status 200
        // Extrai o número da conta diretamente do response.account — fonte definitiva
        // (evita depender do dropdown, que varia para contas com login textual).
        const OrigSend = unsafeWindow.XMLHttpRequest.prototype.send;
        unsafeWindow.XMLHttpRequest.prototype.send = function(body) {
            if (this._csMethod === 'POST' && this._csUrl.includes('datapackcompanyinfo')) {
                const self = this;
                const sentBody = body;
                this.addEventListener('load', function() {
                    try {
                        if (self.status !== 200) return;
                        // Verifica action=login no payload enviado
                        let bodyObj = {};
                        try { bodyObj = typeof sentBody === 'string' ? JSON.parse(sentBody) : (sentBody || {}); } catch(_) {}
                        if (bodyObj.action !== 'login') return;

                        // Login confirmado — inicia cronômetro
                        _loginTimestamp = Date.now();
                        try { sessionStorage.setItem(_SESSION_TS_KEY, String(_loginTimestamp)); } catch(_) {}
                        console.log('🕐 Login confirmado — cronômetro iniciado: ' + new Date(_loginTimestamp).toLocaleTimeString('pt-BR'));

                        // Extrai conta do response.account e salva em sessionStorage
                        try {
                            const resp = JSON.parse(self.responseText || '{}');
                            if (resp.account && /^\d{10}$/.test(String(resp.account))) {
                                const contaReal = String(resp.account);
                                sessionStorage.setItem('vg_contaAtual', contaReal);
                                console.log('👤 Conta identificada via API:', contaReal);
                            }
                        } catch(_) {}
                    } catch(_) {}
                });
            }
            return OrigSend.apply(this, arguments);
        };
    })();

    const PLANILHA_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTBP7xcGcd3_-ZRJTMzL8nV4ZNRat4idK_lDMFoDi-5aZwXXD_5LhW4xzqhpwCaM0YsJn_VdnO4uDNe/pub?gid=930179876&single=true&output=csv';

    let statusDasContas = {};
    let observacoesDasContas = {};
    let credenciaisDasContas = {};
    let logoutEmAndamento = false;

    // ─── BUSCA DE STATUS NA PLANILHA (leitura) ───────────────────────────────────
    async function buscarStatusContas() {
        try {
            const response = await fetch(PLANILHA_URL);
            const csvText = await response.text();
            const linhas = csvText.split('\n');

            statusDasContas = {};
            observacoesDasContas = {};
            credenciaisDasContas = {};

            for (let i = 0; i < linhas.length; i++) {
                const linha = linhas[i];
                if (!linha.trim()) continue;

                const colunas = [];
                let valorAtual = '';
                let dentroDeAspas = false;

                for (let j = 0; j < linha.length; j++) {
                    const char = linha[j];
                    if (char === '"') {
                        dentroDeAspas = !dentroDeAspas;
                    } else if (char === ',' && !dentroDeAspas) {
                        colunas.push(valorAtual.trim());
                        valorAtual = '';
                    } else {
                        valorAtual += char;
                    }
                }
                colunas.push(valorAtual.trim());

                const conta = colunas[2]?.replace(/"/g, '').trim();
                const usuarioPlanilha = colunas[3]?.replace(/"/g, '').trim() || '';
                const senhaPlanilha = colunas[4]?.replace(/"/g, '').trim() || '';
                const observacao = colunas[6]?.replace(/"/g, '').trim() || '';
                const status = colunas[7]?.replace(/"/g, '').trim() || '';

                if (conta && /^\d{10}$/.test(conta)) {
                    let cor = '#A9A9A9';
                    const statusNormalizado = status ? status.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : '';

                    if (statusNormalizado === 'OK') {
                        cor = '#33CC00';
                    } else if (statusNormalizado === 'RENOVANDO') {
                        cor = '#ECD172';
                    } else if (statusNormalizado !== '' && statusNormalizado.length > 0) {
                        cor = '#CC0000';
                    }

                    statusDasContas[conta] = cor;
                    observacoesDasContas[conta] = observacao;

                    if (usuarioPlanilha && senhaPlanilha) {
                        credenciaisDasContas[conta] = {
                            usuario: usuarioPlanilha,
                            senha: senhaPlanilha
                        };
                    }
                }
            }
            console.log('✅ Status/credenciais carregados:', Object.keys(statusDasContas).length, 'contas');
        } catch (e) {
            console.error('❌ Erro ao buscar status/credenciais:', e);
        }
    }

    // ─── ESTILOS ─────────────────────────────────────────────────────────────────
    const estilos = `<style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        #vivoLoginModal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 999999;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            animation: fadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(40px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }

        #vivoLoginModal .modal-content {
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(30px) saturate(180%);
            -webkit-backdrop-filter: blur(30px) saturate(180%);
            border-radius: 24px;
            padding: 50px;
            max-width: 1400px;
            width: 95%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05), inset 0 0 0 1px rgba(255, 255, 255, 0.8);
            animation: slideUp 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        #vivoLoginModal h2 {
            margin: 0 0 12px 0;
            color: #1d1d1f;
            font-size: 36px;
            font-weight: 700;
            text-align: center;
            letter-spacing: -0.5px;
        }

        #vivoLoginModal .subtitle {
            text-align: center;
            color: #86868b;
            margin-bottom: 40px;
            font-size: 16px;
            font-weight: 500;
        }

        #vivoLoginModal .colunas-container {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 20px;
            margin-bottom: 30px;
        }

        #vivoLoginModal .coluna {
            background: rgba(255, 255, 255, 0.5);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-radius: 18px;
            padding: 24px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06), inset 0 0 0 1px rgba(255, 255, 255, 0.6);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            border: 1px solid rgba(255, 255, 255, 0.3);
            position: relative;
            z-index: 1;
        }

        #vivoLoginModal .coluna:hover {
            transform: translateY(-6px);
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.08), inset 0 0 0 1px rgba(102, 0, 153, 0.3);
            background: rgba(255, 255, 255, 0.7);
            border-color: rgba(102, 0, 153, 0.2);
        }

        #vivoLoginModal .coluna-titulo {
            font-weight: 700;
            font-size: 13px;
            color: #660099;
            margin-bottom: 18px;
            padding-bottom: 14px;
            border-bottom: 2px solid rgba(102, 0, 153, 0.2);
            text-align: center;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        #vivoLoginModal .conta-item {
            background: transparent;
            border: none;
            padding: 0;
            margin-bottom: 12px;
            position: relative;
            display: flex;
            align-items: stretch;
            height: 52px;
            gap: 8px;
            z-index: 2;
        }

        #vivoLoginModal .conta-nome {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            color: #1d1d1f;
            font-weight: 500;
            letter-spacing: 0.2px;
            padding: 0 16px;
            cursor: pointer;
            position: relative;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.6);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04), inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 -2px 6px rgba(0, 0, 0, 0.03), inset 0 2px 6px rgba(255, 255, 255, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.4);
        }

        #vivoLoginModal .conta-nome:hover {
            background: rgba(255, 255, 255, 0.8);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.08), inset 0 0 0 1px rgba(102, 0, 153, 0.3), inset 0 -2px 8px rgba(0, 0, 0, 0.05), inset 0 2px 8px rgba(255, 255, 255, 0.6);
            border-color: rgba(102, 0, 153, 0.3);
        }

        #vivoLoginModal .conta-nome:active {
            transform: translateY(0) scale(0.98);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1), inset 0 2px 6px rgba(0, 0, 0, 0.1);
        }

        #vivoLoginModal .conta-nome .bold {
            font-weight: 700;
        }

        #vivoLoginModal .status-indicator {
            width: 52px;
            min-width: 52px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            cursor: help;
            position: relative;
            z-index: 9999;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.06), inset 0 0 0 1px rgba(255, 255, 255, 0.3), inset 0 -2px 6px rgba(0, 0, 0, 0.1), inset 0 2px 6px rgba(255, 255, 255, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }

        #vivoLoginModal .status-indicator:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18), 0 4px 8px rgba(0, 0, 0, 0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 -2px 8px rgba(0, 0, 0, 0.12), inset 0 2px 8px rgba(255, 255, 255, 0.4);
        }

        #vivoLoginModal .status-indicator:active {
            transform: translateY(-1px) scale(0.95);
        }

        #vivoLoginModal .status-indicator img {
            width: 26px;
            height: 26px;
            filter: brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
            pointer-events: none;
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        #vivoLoginModal .status-indicator:hover img {
            transform: scale(1.15);
        }

        #vivoLoginModal .status-indicator.ok {
            background: linear-gradient(145deg, rgba(61, 224, 61, 0.85), rgba(40, 181, 40, 0.9));
        }

        #vivoLoginModal .status-indicator.erro {
            background: linear-gradient(145deg, rgba(230, 57, 57, 0.85), rgba(181, 32, 32, 0.9));
        }

        #vivoLoginModal .status-indicator.renovando {
            background: linear-gradient(145deg, rgba(245, 221, 128, 0.85), rgba(219, 185, 80, 0.9));
        }

        #vivoLoginModal .status-indicator.neutro {
            background: linear-gradient(145deg, rgba(184, 184, 184, 0.75), rgba(143, 143, 143, 0.85));
        }

        #vivoLoginModal .status-indicator:hover::after {
            content: attr(data-observacao);
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(30, 30, 30, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            color: white;
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 500;
            white-space: normal;
            max-width: 250px;
            z-index: 99999;
            margin-bottom: 10px;
            pointer-events: none;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        }

        #vivoLoginModal .status-indicator:hover::before {
            content: '';
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            border: 7px solid transparent;
            border-top-color: rgba(30, 30, 30, 0.95);
            margin-bottom: 3px;
            pointer-events: none;
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
        }

        #vivoLoginModal .close-btn {
            position: absolute;
            top: 24px;
            right: 24px;
            background: rgba(120, 120, 128, 0.16);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 20px;
            color: #1d1d1f;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 10;
            font-weight: 300;
        }

        #vivoLoginModal .close-btn:hover {
            background: #c92424;
            color: white;
            transform: scale(1.1);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        }

        #vivoLoginModal .close-btn:active {
            transform: scale(0.95);
        }

        #vivoLoginModal .refresh-btn {
            position: absolute;
            top: 24px;
            right: 68px;
            background: rgba(120, 120, 128, 0.16);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 10;
        }

        #vivoLoginModal .refresh-btn:hover {
            background: rgba(102, 0, 153, 0.9);
            box-shadow: 0 4px 16px rgba(102, 0, 153, 0.3);
        }

        #vivoLoginModal .refresh-btn:active {
            transform: scale(0.9);
        }

        #vivoLoginModal .refresh-btn.loading {
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        #vivoLoginModal .refresh-btn img {
            width: 18px;
            height: 18px;
            filter: brightness(0) saturate(100%) invert(12%) sepia(0%) saturate(0%) hue-rotate(0deg);
            transition: filter 0.3s ease;
        }

        #vivoLoginModal .refresh-btn:hover img {
            filter: brightness(0) invert(1);
        }

        #vivoLoginModal .footer-info {
            text-align: center;
            color: #86868b;
            font-size: 13px;
            margin-top: 30px;
            padding-top: 24px;
            border-top: 1px solid rgba(0, 0, 0, 0.08);
            font-weight: 500;
        }

        #vivoLoginBtn {
            width: 100%;
            max-width: 550px;
            height: 56px;
            background: rgba(102, 0, 153, 0.9);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(102, 0, 153, 0.5);
            border-radius: 12px;
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(102, 0, 153, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            font-weight: 600;
            color: white;
            margin: 20px auto;
            letter-spacing: 0.3px;
        }

        #vivoLoginBtn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(102, 0, 153, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.3);
            background: rgba(112, 0, 168, 0.95);
        }

        #vivoLoginBtn:active {
            transform: translateY(0);
            box-shadow: 0 2px 8px rgba(102, 0, 153, 0.2);
        }

        @media (max-width: 1200px) {
            #vivoLoginModal .colunas-container { grid-template-columns: repeat(3, 1fr); }
        }

        @media (max-width: 768px) {
            #vivoLoginModal .colunas-container { grid-template-columns: repeat(2, 1fr); }
        }

        @media (max-width: 500px) {
            #vivoLoginModal .colunas-container { grid-template-columns: 1fr; }
        }

        /* ─── Modal de Logout / Registro de Status ──────────────────────────────── */
        #vivoLogoutModal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999999;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            animation: fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        #vivoLogoutModal .logout-modal-content {
            background: rgba(255, 255, 255, 0.78);
            backdrop-filter: blur(30px) saturate(180%);
            -webkit-backdrop-filter: blur(30px) saturate(180%);
            border-radius: 22px;
            padding: 40px 44px 32px;
            width: 420px;
            max-width: 95vw;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06), inset 0 0 0 1px rgba(255, 255, 255, 0.85);
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            text-align: center;
        }

        #vivoLogoutModal h3 {
            margin: 0 0 6px;
            font-size: 22px;
            font-weight: 700;
            color: #1d1d1f;
            letter-spacing: -0.3px;
        }

        #vivoLogoutModal .logout-conta {
            font-size: 13px;
            color: #86868b;
            margin: 0 0 26px;
            font-weight: 500;
        }

        #vivoLogoutModal .logout-conta strong {
            color: #660099;
            font-weight: 700;
        }

        #vivoLogoutModal .logout-pergunta {
            font-size: 15px;
            color: #1d1d1f;
            font-weight: 600;
            margin: 0 0 16px;
        }

        #vivoLogoutModal .opcional {
            font-weight: 400;
            color: #86868b;
            font-size: 13px;
        }

        #vivoLogoutModal .logout-btns {
            display: flex;
            gap: 12px;
            justify-content: center;
        }

        #vivoLogoutModal .logout-btn {
            flex: 1;
            height: 50px;
            border: none;
            border-radius: 12px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            letter-spacing: 0.2px;
        }

        #vivoLogoutModal .logout-btn.ok {
            background: linear-gradient(145deg, #3de03d, #28b528);
            color: white;
            box-shadow: 0 4px 14px rgba(40, 181, 40, 0.35);
        }

        #vivoLogoutModal .logout-btn.ok:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(40, 181, 40, 0.45);
        }

        #vivoLogoutModal .logout-btn.falha {
            background: linear-gradient(145deg, #e63939, #b52020);
            color: white;
            box-shadow: 0 4px 14px rgba(181, 32, 32, 0.35);
        }

        #vivoLogoutModal .logout-btn.falha:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(181, 32, 32, 0.45);
        }

        #vivoLogoutModal .logout-btn.confirmar {
            width: 100%;
            flex: none;
            background: linear-gradient(145deg, rgba(102, 0, 153, 0.92), rgba(75, 0, 115, 0.97));
            color: white;
            box-shadow: 0 4px 14px rgba(102, 0, 153, 0.3);
            margin-top: 14px;
        }

        #vivoLogoutModal .logout-btn.confirmar:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(102, 0, 153, 0.42);
        }

        #vivoLogoutModal .logout-btn:disabled {
            opacity: 0.55;
            cursor: not-allowed;
            transform: none !important;
        }

        #vivoLogoutModal #logoutStep2 textarea {
            width: 100%;
            min-height: 80px;
            border-radius: 10px;
            border: 1.5px solid rgba(102, 0, 153, 0.18);
            background: rgba(255, 255, 255, 0.65);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 13px;
            padding: 10px 13px;
            resize: vertical;
            outline: none;
            color: #1d1d1f;
            box-sizing: border-box;
            transition: border-color 0.2s, box-shadow 0.2s;
        }

        #vivoLogoutModal #logoutStep2 textarea:focus {
            border-color: rgba(102, 0, 153, 0.45);
            box-shadow: 0 0 0 3px rgba(102, 0, 153, 0.08);
        }

        #vivoLogoutModal .logout-skip {
            display: block;
            margin: 20px auto 0;
            background: none;
            border: none;
            color: #adadb0;
            font-size: 12px;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            cursor: pointer;
            text-decoration: underline;
            text-underline-offset: 3px;
            transition: color 0.2s;
            padding: 0;
        }

        #vivoLogoutModal .logout-skip:hover {
            color: #555;
        }

        #vivoLogoutModal .logout-close-x {
            position: absolute;
            top: 16px;
            right: 16px;
            background: rgba(120, 120, 128, 0.16);
            border: 1px solid rgba(255, 255, 255, 0.3);
            width: 28px;
            height: 28px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
            color: #1d1d1f;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            font-weight: 300;
            line-height: 1;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        #vivoLogoutModal .logout-close-x:hover {
            background: #c92424;
            color: white;
            transform: scale(1.1);
        }

    </style>`;

    document.head.insertAdjacentHTML('beforeend', estilos);

    // ─── FUNÇÕES AUXILIARES (login) ───────────────────────────────────────────────
    function formatarNomeConta(nome) {
        if (nome.length >= 4) {
            return `${nome.slice(0, -4)}<span class="bold">${nome.slice(-4)}</span>`;
        }
        return nome;
    }

    function obterCorStatus(nome) {
        // Item 3: status local (tempo real) tem prioridade sobre o da planilha
        const local = _statusLocal[nome];
        if (local && (Date.now() - (local.ts || 0) < _STATUS_EXPIRY)) {
            if (local.status === 'OK')    return '#33CC00';
            if (local.status === 'FALHA') return '#CC0000';
        }
        return statusDasContas[nome] || '#A9A9A9';
    }

    function construirContaItemHTML(cnpj, conta, index) {
        const corFundo = obterCorStatus(conta.nome);
        // Prioriza observação local (fresca <1h) sobre a da planilha
        const observacao = obterObsLocalFresca(conta.nome)
                        || observacoesDasContas[conta.nome]
                        || 'Sem observações';

        let statusClasse = 'neutro';
        let statusIcone = 'https://cdn-icons-png.flaticon.com/512/162/162545.png';

        if (corFundo === '#33CC00') {
            statusClasse = 'ok';
            statusIcone = 'https://cdn-icons-png.flaticon.com/512/33/33281.png';
        } else if (corFundo === '#CC0000') {
            statusClasse = 'erro';
            statusIcone = 'https://cdn-icons-png.flaticon.com/512/159/159469.png';
        } else if (corFundo === '#ECD172') {
            statusClasse = 'renovando';
            statusIcone = 'https://cdn-icons-png.flaticon.com/512/61/61444.png';
        }

        return `
            <div class="conta-item" data-cnpj="${cnpj}" data-index="${index}">
                <div class="conta-nome">${formatarNomeConta(conta.nome)}</div>
                <div class="status-indicator ${statusClasse}" data-observacao="${observacao}">
                    <img src="${statusIcone}" alt="Status">
                </div>
            </div>
        `;
    }

    function criarBotaoFlutuante() {
        if (document.getElementById('vivoLoginBtn')) return;
        const botaoEntrar = document.querySelector('#botao_entrar') || document.querySelector('button[type="submit"]');

        if (botaoEntrar) {
            const botao = document.createElement('button');
            botao.id = 'vivoLoginBtn';
            botao.type = 'button';
            botao.textContent = 'Acessos do Vivo Gestão';
            botao.addEventListener('click', (e) => {
                e.preventDefault();
                const modalExistente = document.getElementById('vivoLoginModal');
                if (modalExistente) modalExistente.remove();
                criarModal();
            });
            botaoEntrar.parentNode.insertBefore(botao, botaoEntrar.nextSibling);
        }
    }

    function criarModal() {
        const modal = document.createElement('div');
        modal.id = 'vivoLoginModal';
        let colunasHTML = '';

        for (const [cnpj, contas] of Object.entries(contasPorCNPJ)) {
            let contasHTML = '';
            contas.forEach((conta, index) => {
                contasHTML += construirContaItemHTML(cnpj, conta, index);
            });
            colunasHTML += `<div class="coluna"><div class="coluna-titulo">${cnpj}</div>${contasHTML}</div>`;
        }

        modal.innerHTML = `
            <div class="modal-content">
                <button class="refresh-btn" id="refreshBtn" title="Atualizar status da planilha">
                    <img src="https://cdn-icons-png.flaticon.com/512/1449/1449312.png" alt="Atualizar">
                </button>
                <button class="close-btn" id="closeModal">×</button>
                <h2>Selecione uma Conta</h2>
                <div class="subtitle">Escolha a conta para fazer login no Vivo Gestão</div>
                <div class="colunas-container">${colunasHTML}</div>
                <div class="footer-info">
                    <img src="https://cdn-icons-png.flaticon.com/512/10021/10021044.png"
                        alt="Info"
                        style="width:24px;height:24px;vertical-align:middle;margin-right:6px;">
                    Dica: Verde = Renovação concluída | Amarelo = Renovando | Vermelho = Erro | Cinza = Aguardando Renovação
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.querySelectorAll('.conta-item').forEach(item => {
            const nomeContaEl = item.querySelector('.conta-nome');
            if (nomeContaEl) {
                nomeContaEl.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const cnpj = item.getAttribute('data-cnpj');
                    const index = item.getAttribute('data-index');
                    preencherLogin(contasPorCNPJ[cnpj][index]);
                });
            }
        });

        document.getElementById('closeModal').addEventListener('click', fecharModal);
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                atualizarStatus();
            });
        }
        modal.addEventListener('click', (e) => { if (e.target === modal) fecharModal(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });
    }

    async function atualizarStatus() {
        const btn = document.getElementById('refreshBtn');
        const img = btn?.querySelector('img');

        if (btn && img) {
            img.src = 'https://cdn-icons-png.flaticon.com/512/6356/6356687.png';
            btn.classList.add('loading');
            btn.disabled = true;
        }

        console.log('🔄 Atualizando status da planilha...');

        await buscarStatusContas();

        fecharModal();
        setTimeout(() => {
            criarModal();
            console.log('✅ Status atualizados!');
        }, 300);
    }

    function preencherLogin(conta) {
        const campoUsuario = document.querySelector('input[type="text"]');
        const campoSenha = document.querySelector('input[type="password"]');

        if (!campoUsuario || !campoSenha) return;

        const credPlanilha = credenciaisDasContas[conta.nome];

        const usuario = credPlanilha?.usuario || conta.usuario;
        const senha = credPlanilha?.senha || conta.senha;

        if (!usuario || !senha) {
            alert('Usuário ou senha não encontrados para esta conta na planilha.');
            return;
        }

        campoUsuario.value = usuario;
        campoSenha.value = senha;

        ['input', 'change'].forEach(evento => {
            campoUsuario.dispatchEvent(new Event(evento, { bubbles: true }));
            campoSenha.dispatchEvent(new Event(evento, { bubbles: true }));
        });

        campoUsuario.style.borderColor = '#660099';
        campoSenha.style.borderColor = '#660099';

        // Salva conta ativa em sessionStorage (persiste login → portal)
        // Necessário para contas com login textual cujo dropdown não exibe o número
        try { sessionStorage.setItem('vg_contaAtual', conta.nome); } catch(_) {}
        console.log('🔑 Conta selecionada:', conta.nome);

        fecharModal();

        setTimeout(() => {
            campoUsuario.style.borderColor = '';
            campoSenha.style.borderColor = '';
        }, 500);
    }

    function fecharModal() {
        const modal = document.getElementById('vivoLoginModal');
        if (modal) {
            modal.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => modal.remove(), 300);
        }
    }

    function estaNaPaginaDeLogin() {
        return document.querySelector('input[type="text"]') &&
               document.querySelector('input[type="password"]') &&
               (document.querySelector('#botao_entrar') || document.querySelector('button[type="submit"]'));
    }

    async function inicializar() {
        await buscarStatusContas();
        if (estaNaPaginaDeLogin()) {
            criarBotaoFlutuante();
            instalarListenerLoginBotao();
        }
    }

    // ─── FALLBACK — cronômetro iniciado no clique do botão de login ─────────────
    // Abordagem defensiva: independente do XHR hook, registra o timestamp
    // no momento em que o usuário clica no botão "Entrar".
    // Se o login falhar (senha errada), o timestamp será sobrescrito
    // na próxima tentativa bem-sucedida.
    let _listenerLoginInstalado = false;
    function instalarListenerLoginBotao() {
        if (_listenerLoginInstalado) return;
        const botao = document.querySelector('#botao_entrar') || document.querySelector('button[type="submit"]');
        if (!botao) return;
        botao.addEventListener('click', function() {
            _loginTimestamp = Date.now();
            try { sessionStorage.setItem(_SESSION_TS_KEY, String(_loginTimestamp)); } catch(_) {}
            console.log('🕐 Cronômetro iniciado no clique de login: ' + new Date(_loginTimestamp).toLocaleTimeString('pt-BR'));
        }, true);
        _listenerLoginInstalado = true;
    }

    // ─── FUNÇÕES DE LOGOUT + REGISTRO DE STATUS ───────────────────────────────────

    function obterContaAtiva() {
        // Prioridade: conta salva no sessionStorage durante preencherLogin
        // (contas com login textual não aparecem como 10 dígitos no dropdown)
        try {
            const saved = sessionStorage.getItem('vg_contaAtual');
            if (saved && /^\d{10}$/.test(saved)) return saved;
        } catch(_) {}
        // Fallback: extrai do dropdown do portal
        const toggle = document.querySelector('a.dropdown-toggle');
        if (!toggle) return null;
        const match = toggle.textContent.match(/\d{10}/);
        return match ? match[0] : null;
    }

    function criarModalLogout(conta, elementoSair) {
        fecharModalLogout();

        const aba = conta ? abasPorConta[conta] : null;
        const contaExibicao = conta || 'não identificada';
        const abaExibicao = aba ? ` &middot; ${aba}` : '';

        const modal = document.createElement('div');
        modal.id = 'vivoLogoutModal';
        modal.innerHTML = `
            <div class="logout-modal-content">
                <button class="logout-close-x" id="btnLogoutFechar" title="Cancelar">×</button>
                <h3>Registrar Status</h3>
                <p class="logout-conta">
                    <strong>${contaExibicao}</strong>${abaExibicao}
                </p>
                <div id="logoutStep1">
                    <p class="logout-pergunta">Como foi o acesso?</p>
                    <div class="logout-btns">
                        <button id="btnLogoutOK" class="logout-btn ok">✓&nbsp; OK</button>
                        <button id="btnLogoutFalha" class="logout-btn falha">✗&nbsp; Falha</button>
                    </div>
                </div>
                <div id="logoutStep2" style="display:none;">
                    <p class="logout-pergunta">
                        Descreva o problema
                        <span class="opcional">(opcional)</span>
                    </p>
                    <textarea
                        id="logoutObs"
                        placeholder="Ex: Erro ao carregar consumo — Grupo CONNECTA"
                    ></textarea>
                    <button id="btnLogoutConfirmar" class="logout-btn confirmar">
                        Confirmar e Sair
                    </button>
                </div>
                <button class="logout-skip" id="btnLogoutSkip">Sair sem registrar</button>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('btnLogoutOK').addEventListener('click', async () => {
            // Horário de saída (momento do clique em OK)
            const agora    = new Date();
            const horario  = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            // Duração em minutos e segundos desde o login
            const diffMs   = _loginTimestamp ? (Date.now() - _loginTimestamp) : 0;
            const diffTotalSec = Math.floor(diffMs / 1000);
            const durMin   = Math.floor(diffTotalSec / 60);
            const durSec   = diffTotalSec % 60;
            const durStr   = durMin > 0
                ? durMin + 'min ' + durSec + 's'
                : durSec + 's';

            const obsOK = 'Renovação concluída às ' + horario + ' — duração (' + durStr + ')';

            // Mostra passo 2 com texto pré-preenchido e editável
            document.getElementById('logoutStep1').style.display = 'none';
            const step2 = document.getElementById('logoutStep2');
            step2.style.display = 'block';
            const textarea = document.getElementById('logoutObs');
            if (textarea) {
                textarea.value = obsOK;
                textarea.focus();
                textarea.select();
            }
            // Troca o botão confirmar para registrar OK
            const btnConf = document.getElementById('btnLogoutConfirmar');
            if (btnConf) {
                btnConf.onclick = async () => {
                    const obs = document.getElementById('logoutObs')?.value.trim() || obsOK;
                    await concluirLogout(conta, aba, 'OK', obs, elementoSair);
                };
            }
        });

        document.getElementById('btnLogoutFalha').addEventListener('click', () => {
            document.getElementById('logoutStep1').style.display = 'none';
            document.getElementById('logoutStep2').style.display = 'block';
            const textarea = document.getElementById('logoutObs');
            if (textarea) {
                setTimeout(() => { textarea.focus(); textarea.select(); }, 50);
            }
        });

        document.getElementById('btnLogoutConfirmar').addEventListener('click', async () => {
            const obs = document.getElementById('logoutObs')?.value.trim() || '';
            await concluirLogout(conta, aba, 'FALHA', obs, elementoSair);
        });

        document.getElementById('btnLogoutSkip').addEventListener('click', () => {
            fecharModalLogout();
            try { sessionStorage.removeItem('vg_contaAtual'); } catch(_) {}
            logoutEmAndamento = true;
            elementoSair.click();
        });

        // Novo: X fecha o modal sem sair e sem registrar nada
        document.getElementById('btnLogoutFechar').addEventListener('click', () => {
            fecharModalLogout();
        });
    }

    async function concluirLogout(conta, aba, status, observacao, elementoSair) {
        // Item 3: salva status local imediatamente para atualização em tempo real
        if (conta) salvarStatusLocal(conta, status, observacao);

        // Desabilita botões e indica salvamento
        ['btnLogoutOK', 'btnLogoutFalha', 'btnLogoutConfirmar'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = true;
        });
        const btnOK = document.getElementById('btnLogoutOK');
        const btnConfirmar = document.getElementById('btnLogoutConfirmar');
        if (btnOK) btnOK.textContent = '⏳ Salvando...';
        if (btnConfirmar) btnConfirmar.textContent = '⏳ Salvando...';

        if (conta && aba) {
            await gravarStatusNaPlanilha(conta, aba, status, observacao);
        } else {
            console.warn('⚠️ Conta ou aba não identificada. Status não gravado.');
        }

        fecharModalLogout();
        // Limpa conta ativa — próximo login selecionará uma nova
        try { sessionStorage.removeItem('vg_contaAtual'); } catch(_) {}
        logoutEmAndamento = true;
        elementoSair.click();
    }

    function gravarStatusNaPlanilha(conta, aba, status, observacao) {
        // GM_xmlhttpRequest contorna o bloqueio de CORS:
        // o fetch normal é rejeitado pelo navegador porque a página
        // do Vivo Gestão não tem permissão para chamar o Apps Script.
        // GM_xmlhttpRequest faz a requisição fora do contexto da página.
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method:  'POST',
                url:     WEB_APP_URL,
                headers: { 'Content-Type': 'application/json' },
                data:    JSON.stringify({ conta, aba, status, observacao }),
                onload: function(response) {
                    try {
                        const resultado = JSON.parse(response.responseText);
                        if (resultado.success) {
                            console.log('✅ ' + resultado.message);
                        } else {
                            console.error('❌ Erro ao gravar status: ' + resultado.error);
                        }
                    } catch (e) {
                        console.error('❌ Erro ao parsear resposta do Web App:', e);
                    }
                    resolve();
                },
                onerror: function(e) {
                    console.error('❌ Falha na requisição ao Web App:', e);
                    resolve();
                }
            });
        });
    }

    function fecharModalLogout() {
        const m = document.getElementById('vivoLogoutModal');
        if (m) m.remove();
    }

    // ─── INTERCEPTAÇÃO DO BOTÃO SAIR (fase de captura) ───────────────────────────
    document.addEventListener('click', function(e) {
        const link = e.target.closest('a');
        if (!link) return;
        if (!link.querySelector('span.icon-exit')) return;

        // Se o logout já foi autorizado pelo modal, deixa passar
        if (logoutEmAndamento) {
            logoutEmAndamento = false;
            return;
        }

        e.preventDefault();
        e.stopImmediatePropagation();

        const conta = obterContaAtiva();
        // NOTA: NÃO limpar _loginTimestamp aqui — o modal ainda vai lê-lo
        // para calcular a duração. Novo login sobrescreve o valor antigo.
        criarModalLogout(conta, link);
    }, true); // true = fase de captura, intercepta antes de qualquer outro handler

    // ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
    const observador = new MutationObserver(() => {
        if (estaNaPaginaDeLogin() && !document.getElementById('vivoLoginBtn')) inicializar();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

    window.addEventListener('load', () => {
        inicializar();
        observador.observe(document.body, { childList: true, subtree: true });
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            setTimeout(() => {
                if (estaNaPaginaDeLogin() && !document.getElementById('vivoLoginBtn')) inicializar();
            }, 500);
        }
    });

    setInterval(() => {
        if (estaNaPaginaDeLogin() && !document.getElementById('vivoLoginBtn')) inicializar();
    }, 2000);

})();
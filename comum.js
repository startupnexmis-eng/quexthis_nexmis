/* NEXMIS — funções compartilhadas pelas duas abas (Pesquisa e Analista) */

const CATEGORIAS = ["Esquerda", "Centro-esquerda", "Centro", "Centro-direita", "Direita"];

const API_BASE = String(window.NEXMIS_API_URL || "").replace(/\/$/, "");

function apiUrl(url) {
  if (!API_BASE || API_BASE === "COLE_AQUI_A_URL_DO_BACKEND") {
    throw new Error("O endereço do servidor do NEXMIS ainda não foi configurado.");
  }
  return `${API_BASE}${url}`;
}

function escaparHTML(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

async function api(url, options = {}) {
  let resposta;
  try {
    resposta = await fetch(apiUrl(url), {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error("Não foi possível conectar ao servidor. Verifique a internet e tente de novo.");
    }
    throw e;
  }
  let corpo = {};
  try { corpo = await resposta.json(); } catch {}
  if (!resposta.ok) {
    const erro = new Error(typeof corpo.detail === "string" ? corpo.detail : "Não foi possível concluir a operação.");
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
}

function barrasDistribuicao(dados) {
  return CATEGORIAS.map(cat => {
    const p = dados.categories[cat].percent;
    return `<div class="resultado-item">
      <div class="resultado-titulo">${cat}</div>
      <div class="barra-container"><div class="barra" style="width:${p}%"></div></div>
      <div class="resultado-legenda">${p.toFixed(1)}% · ${dados.categories[cat].count} resposta(s)</div>
    </div>`;
  }).join("");
}

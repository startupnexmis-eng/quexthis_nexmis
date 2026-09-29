/* NEXMIS — frontend conectado à API */

const ESCALA = [
  "Discordo totalmente",
  "Discordo",
  "Nem concordo nem discordo",
  "Concordo",
  "Concordo totalmente"
];

const CATEGORIAS = ["Esquerda", "Centro-esquerda", "Centro", "Centro-direita", "Direita"];

const API_BASE = String(window.NEXMIS_API_URL || "").replace(/\/$/, "");

function apiUrl(url) {
  if (!API_BASE || API_BASE === "COLE_AQUI_A_URL_DO_BACKEND") {
    throw new Error("O endereço do servidor do NEXMIS ainda não foi configurado.");
  }
  return `${API_BASE}${url}`;
}
const estilosDescricao = {
  "Comunismo": "Tendência associada à propriedade coletiva dos meios de produção e à redução das relações econômicas privadas.",
  "Socialismo": "Tendência associada a maior participação do Estado e/ou dos trabalhadores na organização econômica e à redução das desigualdades.",
  "Social-democracia": "Tendência associada à economia de mercado combinada com proteção social, serviços públicos e políticas de redução das desigualdades.",
  "Centro democrático": "Tendência intermediária no eixo utilizado pela pesquisa, sem predominância forte de um dos polos.",
  "Democracia cristã": "Tradição política que combina instituições democráticas, economia social de mercado e valores de inspiração cristã.",
  "Conservadorismo": "Tendência que dá maior peso à ordem, continuidade institucional, autoridade e preservação de valores tradicionais.",
  "Liberalismo clássico": "Tradição que enfatiza liberdade individual, propriedade privada, Estado limitado e maior autonomia do mercado."
};

function escaparHTML(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

async function api(url, options = {}) {
  const resposta = await fetch(apiUrl(url), {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  let corpo = {};
  try { corpo = await resposta.json(); } catch {}
  if (!resposta.ok) {
    const erro = new Error(corpo.detail || "Não foi possível concluir a operação.");
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
}

// Marca local de "já respondeu" — usa localStorage (sobrevive ao fechar a aba,
// diferente do sessionStorage) para impedir que a mesma pessoa, no mesmo
// navegador, reabra o questionário. É uma trava de conveniência para o
// usuário; quem garante mesmo que ninguém responda duas vezes é o banco de
// dados no servidor (ver backend/app.py).
const CHAVE_JA_RESPONDEU = "nexmis_ja_respondeu";

function jaRespondeuNesteDispositivo() {
  return localStorage.getItem(CHAVE_JA_RESPONDEU) === "1";
}

function marcarComoRespondido() {
  localStorage.setItem(CHAVE_JA_RESPONDEU, "1");
}

function bloquearNovaTentativa() {
  const secaoCard = document.querySelector(".card");
  const erro = document.getElementById("erro");
  if (!secaoCard) return;
  secaoCard
    .querySelectorAll("input, select, button")
    .forEach(campo => (campo.disabled = true));
  if (erro) {
    erro.textContent =
      "Este dispositivo já foi usado para responder ao questionário. Cada pessoa pode participar apenas uma vez.";
    erro.setAttribute("role", "alert");
  }
}

function iniciarPesquisa() {
  const botao = document.getElementById("iniciar");
  if (!botao) return;

  if (jaRespondeuNesteDispositivo()) {
    bloquearNovaTentativa();
    return;
  }

  botao.addEventListener("click", () => {
    if (jaRespondeuNesteDispositivo()) {
      bloquearNovaTentativa();
      return;
    }
    const identificacao = {
      nome: document.getElementById("nome").value.trim(),
      curso: document.getElementById("curso").value,
      serie: document.getElementById("serie").value,
      turma: document.getElementById("turma").value
    };
    const erro = document.getElementById("erro");
    erro.textContent = "";
    if (!identificacao.nome || !identificacao.curso || !identificacao.serie || !identificacao.turma) {
      erro.textContent = "Preencha nome, curso, série e turma antes de continuar.";
      return;
    }
    sessionStorage.setItem("nexmis_identificacao", JSON.stringify(identificacao));
    location.href = "questionario.html";
  });
}

async function montarQuestionario() {
  const container = document.getElementById("perguntas");
  if (!container) return;
  if (jaRespondeuNesteDispositivo()) { location.href = "index.html"; return; }
  const identificacao = JSON.parse(sessionStorage.getItem("nexmis_identificacao") || "null");
  if (!identificacao) { location.href = "index.html"; return; }

  document.getElementById("identificacao").innerHTML = `
    NOME: ${escaparHTML(identificacao.nome)}<br>
    CURSO: ${escaparHTML(identificacao.curso)}<br>
    SÉRIE: ${escaparHTML(identificacao.serie)}<br>
    TURMA: ${escaparHTML(identificacao.turma)}`;

  try {
    const dados = await api("/api/questions");
    document.querySelector(".kicker").textContent = `02 — QUESTIONÁRIO · ${dados.count} AFIRMAÇÕES`;
    const legenda = document.querySelector(".escala-legenda");
    legenda.innerHTML = dados.scale.map(escaparHTML).map(x => `<span>${x}</span>`).join("");

    dados.questions.forEach(item => {
      const bloco = document.createElement("div");
      bloco.className = "pergunta";
      bloco.innerHTML = `
        <div class="pergunta-numero">PERGUNTA ${String(item.id).padStart(2, "0")}</div>
        <h2>${escaparHTML(item.question)}</h2>
        <div>${dados.scale.map((texto, valor) => `
          <label class="alternativa">
            <input type="radio" name="pergunta${item.id - 1}" value="${valor}">
            <span>${escaparHTML(texto)}</span>
          </label>`).join("")}</div>`;
      container.appendChild(bloco);
    });
  } catch (e) {
    document.getElementById("erroQuestionario").textContent = "Não foi possível carregar o questionário. Verifique a conexão com o servidor.";
    return;
  }

  document.getElementById("questionario").addEventListener("submit", finalizarQuestionario);
}

async function finalizarQuestionario(event) {
  event.preventDefault();
  const erro = document.getElementById("erroQuestionario");
  erro.textContent = "";
  const respostas = [];

  for (let i = 0; i < document.querySelectorAll(".pergunta").length; i++) {
    const marcada = document.querySelector(`input[name="pergunta${i}"]:checked`);
    if (!marcada) {
      erro.textContent = `Responda a pergunta ${i + 1} antes de finalizar.`;
      document.querySelector(`input[name="pergunta${i}"]`).focus();
      return;
    }
    respostas.push(Number(marcada.value));
  }

  const identificacao = JSON.parse(sessionStorage.getItem("nexmis_identificacao") || "null");
  if (!identificacao) { location.href = "index.html"; return; }

  const botao = document.querySelector("#questionario button[type=submit]");
  botao.disabled = true;
  botao.textContent = "ENVIANDO RESPOSTAS...";

  try {
    const resultado = await api("/api/responses", {
      method: "POST",
      body: JSON.stringify({
        name: identificacao.nome,
        course: identificacao.curso,
        series: identificacao.serie,
        class_name: identificacao.turma,
        answers: respostas
      })
    });

    sessionStorage.removeItem("nexmis_identificacao");
    marcarComoRespondido();
    mostrarResultadoIndividual(resultado);
  } catch (e) {
    if (e.status === 409) {
      marcarComoRespondido();
    }
    erro.textContent = e.message;
    botao.disabled = false;
    botao.textContent = "FINALIZAR QUESTIONÁRIO →";
  }
}

function mostrarResultadoIndividual(resultado) {
  const estilo = escaparHTML(resultado.government_style);
  const lado = escaparHTML(resultado.side);
  const descricao = escaparHTML(estilosDescricao[resultado.government_style] || "Tendência aproximada calculada pelas respostas do questionário.");
  document.querySelector(".questionario-card").innerHTML = `
    <div class="kicker">PESQUISA CONCLUÍDA</div>
    <h1 class="titulo-questionario">Seu resultado.</h1>
    <div class="linha"></div>
    <div class="resultado-individual-final">
      <div class="resultado-final-label">ESTILO DE GOVERNO / TENDÊNCIA POLÍTICA</div>
      <div class="resultado-final-estilo">${estilo}</div>
      <div class="resultado-final-lado">Posicionamento no eixo: ${lado}</div>
      <p class="resultado-final-descricao">${descricao}</p>
      <p class="resultado-final-nota">Este resultado é uma aproximação baseada exclusivamente nas respostas. Ele não representa uma identidade política definitiva.</p>
    </div>
    <a class="botao-link" href="index.html">VOLTAR AO INÍCIO</a>`;
}

function obterToken() { return sessionStorage.getItem("nexmis_admin_token"); }
function headersAdmin() { return { Authorization: `Bearer ${obterToken()}` }; }

/* ============================================================
   PAINEL DO ANALISTA
   ============================================================ */

// Última análise carregada (usada para montar o PDF) e itens do histórico.
let ultimaAnalise = null;
let itensHistorico = [];

function lerFiltrosDaTela() {
  return {
    course: document.getElementById("filtroCurso").value,
    series: document.getElementById("filtroSerie").value,
    class_name: document.getElementById("filtroTurma").value
  };
}

// registrar = true grava a pesquisa no histórico (só quando o analista consulta de fato).
async function carregarAnalise(filtros = {}, { registrar = false } = {}) {
  const params = new URLSearchParams();
  if (filtros.course) params.set("course", filtros.course);
  if (filtros.series) params.set("series", filtros.series);
  if (filtros.class_name) params.set("class_name", filtros.class_name);
  if (registrar) params.set("save_history", "true");
  const dados = await api(`/api/analytics?${params}`, { headers: headersAdmin() });
  ultimaAnalise = { dados, filtros: { course: filtros.course || "", series: filtros.series || "", class_name: filtros.class_name || "" } };
  renderizarAnalise(dados, ultimaAnalise.filtros);
  return dados;
}

// "selecionado" força o valor do filtro (necessário ao reabrir uma pesquisa do histórico);
// se o valor já não existir nos dados, ele é mantido na lista mesmo assim.
function preencherSelect(id, valores, selecionado = "") {
  const select = document.getElementById(id);
  const lista = selecionado && !valores.includes(selecionado) ? [...valores, selecionado] : valores;
  select.innerHTML = `<option value="">Todos</option>` + lista.map(v => `<option value="${escaparHTML(v)}">${escaparHTML(v)}</option>`).join("");
  select.value = selecionado || "";
}

function renderizarAnalise(dados, filtros = {}) {
  preencherSelect("filtroCurso", dados.filters.courses, filtros.course);
  preencherSelect("filtroSerie", dados.filters.series, filtros.series);
  preencherSelect("filtroTurma", dados.filters.classes, filtros.class_name);

  const resumo = document.getElementById("resumoGrupo");
  if (!dados.total_responses) {
    resumo.innerHTML = `<div class="sem-dados">Nenhuma resposta encontrada para esse filtro.</div>`;
  } else {
    resumo.innerHTML = `
      <div class="grupo-cabecalho">
        <div><div class="resultado-titulo">Distribuição do filtro atual</div>
        <div class="resultado-legenda">${dados.total_responses} resposta(s) · somente dados agregados</div></div>
      </div>
      <div class="distribuicao">${CATEGORIAS.map(cat => {
        const p = dados.categories[cat].percent;
        return `<div class="resultado-item"><div class="resultado-titulo">${cat}</div><div class="barra-container"><div class="barra" style="width:${p}%"></div></div><div class="resultado-legenda">${p.toFixed(1)}% · ${dados.categories[cat].count} resposta(s)</div></div>`;
      }).join("")}</div>`;
  }

  atualizarGraficoTotal(dados.groups, dados.total_responses);
}

function atualizarGraficoTotal(grupos, total) {
  const alvo = document.getElementById("graficoTotal");
  if (!alvo) return;
  if (!grupos.length) {
    alvo.innerHTML = "";
    return;
  }
  alvo.innerHTML = `
    <div class="grafico-cabecalho">
      <div class="titulo-card">GRÁFICO TOTAL</div>
      <h2 class="resultado-titulo">Por turma e posicionamento político</h2>
      <p class="resultado-legenda">${total} resposta(s) · distribuição agregada</p>
    </div>
    <div class="legenda-grafico">${CATEGORIAS.map(cat => `<span>◆ ${cat}</span>`).join("")}</div>
    <div class="grafico-turmas">${grupos.map(g => `
      <div class="grafico-turma">
        <div class="grafico-turma-topo"><strong>${escaparHTML(g.course)} · ${escaparHTML(g.series)} · ${escaparHTML(g.class_name)}</strong><span>${g.total} resposta(s)</span></div>
        <div class="barra-empilhada">${CATEGORIAS.map((cat,i) => `<div class="segmento segmento-${i}" style="width:${g.categories[cat].percent}%" title="${cat}: ${g.categories[cat].percent}%"></div>`).join("")}</div>
        <div class="valores-grafico">${CATEGORIAS.map((cat,i) => `<span><b>${g.categories[cat].percent.toFixed(1)}%</b> ${cat}</span>`).join("")}</div>
      </div>`).join("")}</div>`;
}

/* ---------- Modal de senha (autoriza qualquer exclusão) ---------- */

// Abre um modal pedindo a senha de acesso. Chama acao(senha); se a senha estiver
// errada o modal continua aberto com a mensagem de erro. Resolve true se a ação
// foi concluída e false se o analista cancelou.
function confirmarComSenha({ titulo, texto, rotulo = "APAGAR" , acao }) {
  return new Promise(resolve => {
    const focoAnterior = document.activeElement;
    const fundo = document.createElement("div");
    fundo.className = "modal-fundo";
    fundo.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitulo">
        <div class="titulo-card" id="modalTitulo">${escaparHTML(titulo)}</div>
        <p class="descricao curto">${escaparHTML(texto)}</p>
        <label for="modalSenha">SENHA DE ACESSO</label>
        <input id="modalSenha" type="password" autocomplete="off" placeholder="Digite a senha para autorizar">
        <div id="modalErro" class="erro" role="alert" aria-live="polite"></div>
        <div class="modal-acoes">
          <button type="button" id="modalCancelar" class="botao-secundario">CANCELAR</button>
          <button type="button" id="modalConfirmar" class="botao-perigo">${escaparHTML(rotulo)}</button>
        </div>
      </div>`;
    document.body.appendChild(fundo);

    const campo = fundo.querySelector("#modalSenha");
    const erro = fundo.querySelector("#modalErro");
    const btnOk = fundo.querySelector("#modalConfirmar");
    const btnCancelar = fundo.querySelector("#modalCancelar");
    campo.focus();

    const fechar = resultado => {
      document.removeEventListener("keydown", aoTeclar);
      fundo.remove();
      if (focoAnterior && focoAnterior.focus) focoAnterior.focus();
      resolve(resultado);
    };

    const confirmar = async () => {
      if (!campo.value) { erro.textContent = "Digite a senha para autorizar a exclusão."; campo.focus(); return; }
      erro.textContent = "";
      btnOk.disabled = btnCancelar.disabled = true;
      try {
        await acao(campo.value);
        fechar(true);
      } catch (e) {
        if (e.status === 401) { sessionStorage.removeItem("nexmis_admin_token"); location.reload(); return; }
        erro.textContent = e.message;
        btnOk.disabled = btnCancelar.disabled = false;
        campo.value = "";
        campo.focus();
      }
    };

    function aoTeclar(ev) {
      if (ev.key === "Escape" && !btnCancelar.disabled) fechar(false);
      if (ev.key === "Enter" && document.activeElement === campo) { ev.preventDefault(); confirmar(); }
    }
    document.addEventListener("keydown", aoTeclar);
    btnOk.addEventListener("click", confirmar);
    btnCancelar.addEventListener("click", () => fechar(false));
    fundo.addEventListener("mousedown", ev => { if (ev.target === fundo && !btnCancelar.disabled) fechar(false); });
  });
}

function postarComSenha(url, senha) {
  return api(url, { method: "POST", headers: headersAdmin(), body: JSON.stringify({ password: senha }) });
}

/* ---------- Abas e histórico ---------- */

function mostrarAba(nome) {
  const historico = nome === "historico";
  document.getElementById("secaoAnalise").classList.toggle("hidden", historico);
  document.getElementById("secaoHistorico").classList.toggle("hidden", !historico);
  const abaA = document.getElementById("abaAnalise");
  const abaH = document.getElementById("abaHistorico");
  abaA.classList.toggle("ativa", !historico);
  abaH.classList.toggle("ativa", historico);
  abaA.setAttribute("aria-selected", String(!historico));
  abaH.setAttribute("aria-selected", String(historico));
  if (historico) carregarHistorico().catch(tratarErroSessao);
}

function tratarErroSessao(e) {
  if (e && e.status === 401) { sessionStorage.removeItem("nexmis_admin_token"); location.reload(); }
}

function descreverFiltros(item) {
  return [
    ["Curso", item.course],
    ["Série", item.series],
    ["Turma", item.class_name]
  ];
}

function formatarDataHora(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

async function carregarHistorico() {
  const dados = await api("/api/admin/history", { headers: headersAdmin() });
  itensHistorico = dados.items;
  renderizarHistorico();
}

function renderizarHistorico() {
  const lista = document.getElementById("listaHistorico");
  const btnLimpar = document.getElementById("limparHistorico");
  btnLimpar.classList.toggle("hidden", !itensHistorico.length);
  if (!itensHistorico.length) {
    lista.innerHTML = `<div class="sem-dados">Nenhuma pesquisa registrada ainda. As consultas feitas na aba Análise aparecerão aqui.</div>`;
    return;
  }
  lista.innerHTML = itensHistorico.map(item => `
    <div class="historico-item" data-id="${escaparHTML(item.id)}">
      <div class="historico-info">
        <div class="historico-data">${escaparHTML(formatarDataHora(item.created_at))}</div>
        <div class="historico-filtros">${descreverFiltros(item).map(([nome, valor]) =>
          `<span class="chip${valor ? "" : " chip-todos"}"><b>${nome}:</b> ${escaparHTML(valor || "Todos")}</span>`).join("")}</div>
        <div class="resultado-legenda">${item.total_responses} resposta(s) na última consulta</div>
      </div>
      <div class="historico-botoes">
        <button type="button" data-acao="abrir">ABRIR ANÁLISE</button>
        <button type="button" data-acao="apagar" class="botao-secundario">APAGAR</button>
      </div>
    </div>`).join("");
}

async function abrirPesquisaDoHistorico(item) {
  try {
    await carregarAnalise({ course: item.course, series: item.series, class_name: item.class_name });
    mostrarAba("analise");
    document.getElementById("painelResultados").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    tratarErroSessao(e);
    alert(e.message);
  }
}

/* ---------- Exportação em PDF (relatório legível) ---------- */

// Cores distintas por categoria, com texto de contraste; o relatório também traz
// os números em tabela, então a leitura nunca depende só da cor.
const CORES_RELATORIO = [
  { fundo: "#b4321f", texto: "#ffffff" }, // Esquerda
  { fundo: "#f0a04b", texto: "#111111" }, // Centro-esquerda
  { fundo: "#d3d7de", texto: "#111111" }, // Centro
  { fundo: "#7fb2e0", texto: "#111111" }, // Centro-direita
  { fundo: "#1f4e9c", texto: "#ffffff" }  // Direita
];

function fmtPct(n) { return `${Number(n).toFixed(1).replace(".", ",")}%`; }

function montarRelatorioPDF() {
  const { dados, filtros } = ultimaAnalise;
  const agora = new Date().toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });
  const rot = v => escaparHTML(v || "Todos");

  const legenda = `<div class="rel-legenda">${CATEGORIAS.map((c, i) =>
    `<span><i style="background:${CORES_RELATORIO[i].fundo}"></i>${c}</span>`).join("")}</div>`;

  const linhasGeral = CATEGORIAS.map((cat, i) => {
    const c = dados.categories[cat];
    return `<tr>
      <td class="rel-cat"><i style="background:${CORES_RELATORIO[i].fundo}"></i>${cat}</td>
      <td class="rel-num">${c.count}</td>
      <td class="rel-num">${fmtPct(c.percent)}</td>
      <td class="rel-barra-cel"><div class="rel-barra"><div style="width:${c.percent}%;background:${CORES_RELATORIO[i].fundo}"></div></div></td>
    </tr>`;
  }).join("");

  const blocosTurmas = dados.groups.map(g => {
    const segmentos = CATEGORIAS.map((cat, i) => {
      const p = g.categories[cat].percent;
      const rotulo = p >= 7 ? fmtPct(p) : "";
      return `<div style="width:${p}%;background:${CORES_RELATORIO[i].fundo};color:${CORES_RELATORIO[i].texto}">${rotulo}</div>`;
    }).join("");
    const cabecas = CATEGORIAS.map((cat, i) =>
      `<th><i style="background:${CORES_RELATORIO[i].fundo}"></i>${cat}</th>`).join("");
    const valores = CATEGORIAS.map(cat =>
      `<td><strong>${fmtPct(g.categories[cat].percent)}</strong><span>${g.categories[cat].count} resp.</span></td>`).join("");
    return `
      <div class="rel-turma">
        <div class="rel-turma-topo">
          <h3>${escaparHTML(g.course)} · ${escaparHTML(g.series)} · ${escaparHTML(g.class_name)}</h3>
          <span>${g.total} resposta(s)</span>
        </div>
        <div class="rel-barra-empilhada">${segmentos}</div>
        <table class="rel-tabela-turma"><thead><tr>${cabecas}</tr></thead><tbody><tr>${valores}</tr></tbody></table>
      </div>`;
  }).join("");

  return `
    <div class="rel-pagina">
      <div class="rel-topo">
        <div class="rel-marca">NEXMIS</div>
        <div class="rel-sub">Relatório de análise · Questionário político</div>
      </div>
      <h1>Distribuição de posicionamentos políticos</h1>
      <table class="rel-meta">
        <tr><th>Gerado em</th><td>${escaparHTML(agora)}</td></tr>
        <tr><th>Curso</th><td>${rot(filtros.course)}</td></tr>
        <tr><th>Série</th><td>${rot(filtros.series)}</td></tr>
        <tr><th>Turma</th><td>${rot(filtros.class_name)}</td></tr>
        <tr><th>Total de respostas</th><td><strong>${dados.total_responses}</strong></td></tr>
      </table>

      <h2>1. Resultado geral do filtro</h2>
      <table class="rel-tabela-geral">
        <thead><tr><th>Posicionamento</th><th class="rel-num">Respostas</th><th class="rel-num">Percentual</th><th>Proporção</th></tr></thead>
        <tbody>${linhasGeral}</tbody>
      </table>

      <h2>2. Resultado por turma</h2>
      ${legenda}
      ${blocosTurmas}

      <p class="rel-nota">Dados agregados. O resultado indica uma tendência predominante a partir das respostas e não representa uma identidade política definitiva.</p>
    </div>`;
}

function exportarPDF() {
  if (!ultimaAnalise || !ultimaAnalise.dados.total_responses) {
    alert("Não há respostas no filtro atual para exportar.");
    return;
  }
  const alvo = document.getElementById("relatorioPDF");
  alvo.innerHTML = montarRelatorioPDF();
  document.body.classList.add("modo-exportacao");
  const limpar = () => {
    document.body.classList.remove("modo-exportacao");
    alvo.innerHTML = "";
  };
  window.addEventListener("afterprint", limpar, { once: true });
  setTimeout(() => { if (document.body.classList.contains("modo-exportacao")) limpar(); }, 15000);
  window.print();
}

/* ---------- Configuração da página ---------- */

function configurarResultados() {
  const entrar = document.getElementById("entrarResultados");
  if (!entrar) return;

  const abrirPainel = async (registrar = false) => {
    try {
      await carregarAnalise({}, { registrar });
      document.getElementById("loginResultados").classList.add("hidden");
      document.getElementById("painelResultados").classList.remove("hidden");
    } catch (e) {
      sessionStorage.removeItem("nexmis_admin_token");
      document.getElementById("erroLogin").textContent = e.message;
    }
  };

  entrar.addEventListener("click", async () => {
    const senha = document.getElementById("senha").value;
    const erro = document.getElementById("erroLogin");
    erro.textContent = "";
    try {
      const dados = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: senha }) });
      sessionStorage.setItem("nexmis_admin_token", dados.token);
      await abrirPainel(true);
    } catch (e) { erro.textContent = e.message; }
  });

  document.getElementById("senha").addEventListener("keydown", e => { if (e.key === "Enter") entrar.click(); });

  ["filtroCurso", "filtroSerie", "filtroTurma"].forEach(id => document.getElementById(id).addEventListener("change", () => {
    carregarAnalise(lerFiltrosDaTela(), { registrar: true }).catch(tratarErroSessao);
  }));

  document.getElementById("abaAnalise").addEventListener("click", () => mostrarAba("analise"));
  document.getElementById("abaHistorico").addEventListener("click", () => mostrarAba("historico"));

  document.getElementById("sairResultados").addEventListener("click", () => {
    sessionStorage.removeItem("nexmis_admin_token");
    location.reload();
  });

  // Apagar TODOS os dados — exige a senha de acesso.
  document.getElementById("limpar").addEventListener("click", () => {
    confirmarComSenha({
      titulo: "APAGAR TODOS OS DADOS",
      texto: "Isso apagará permanentemente TODAS as respostas da pesquisa e não pode ser desfeito. Digite a senha de acesso para autorizar.",
      rotulo: "APAGAR DADOS",
      acao: senha => postarComSenha("/api/admin/responses/delete-all", senha)
    }).then(async ok => {
      if (ok) await carregarAnalise(lerFiltrosDaTela()).catch(tratarErroSessao);
    });
  });

  // Histórico: abrir / apagar um item
  document.getElementById("listaHistorico").addEventListener("click", ev => {
    const botao = ev.target.closest("button[data-acao]");
    if (!botao) return;
    const id = botao.closest(".historico-item").dataset.id;
    const item = itensHistorico.find(x => x.id === id);
    if (!item) return;

    if (botao.dataset.acao === "abrir") {
      abrirPesquisaDoHistorico(item);
    } else {
      confirmarComSenha({
        titulo: "APAGAR PESQUISA DO HISTÓRICO",
        texto: "Esta pesquisa será removida do histórico. Digite a senha de acesso para autorizar.",
        acao: senha => postarComSenha(`/api/admin/history/${encodeURIComponent(id)}/delete`, senha)
      }).then(ok => { if (ok) carregarHistorico().catch(tratarErroSessao); });
    }
  });

  // Histórico: apagar tudo
  document.getElementById("limparHistorico").addEventListener("click", () => {
    confirmarComSenha({
      titulo: "APAGAR TODO O HISTÓRICO",
      texto: "Todo o histórico de pesquisas será apagado (as respostas dos participantes não são afetadas). Digite a senha de acesso para autorizar.",
      rotulo: "APAGAR HISTÓRICO",
      acao: senha => postarComSenha("/api/admin/history/delete-all", senha)
    }).then(ok => { if (ok) carregarHistorico().catch(tratarErroSessao); });
  });

  document.getElementById("exportar").addEventListener("click", exportarPDF);

  if (obterToken()) abrirPainel(false);
}

iniciarPesquisa();
montarQuestionario();
configurarResultados();

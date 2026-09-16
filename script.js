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

function iniciarPesquisa() {
  const botao = document.getElementById("iniciar");
  if (!botao) return;
  botao.addEventListener("click", () => {
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
    mostrarResultadoIndividual(resultado);
  } catch (e) {
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

async function carregarAnalise(filtros = {}) {
  const params = new URLSearchParams();
  if (filtros.course) params.set("course", filtros.course);
  if (filtros.series) params.set("series", filtros.series);
  if (filtros.class_name) params.set("class_name", filtros.class_name);
  const dados = await api(`/api/analytics?${params}`, { headers: headersAdmin() });
  renderizarAnalise(dados);
}

function preencherSelect(id, valores) {
  const select = document.getElementById(id);
  const atual = select.value;
  select.innerHTML = `<option value="">Todos</option>` + valores.map(v => `<option value="${escaparHTML(v)}">${escaparHTML(v)}</option>`).join("");
  if (valores.includes(atual)) select.value = atual;
}

function renderizarAnalise(dados) {
  preencherSelect("filtroCurso", dados.filters.courses);
  preencherSelect("filtroSerie", dados.filters.series);
  preencherSelect("filtroTurma", dados.filters.classes);

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

function configurarResultados() {
  const entrar = document.getElementById("entrarResultados");
  if (!entrar) return;

  const abrirPainel = async () => {
    try {
      await carregarAnalise();
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
      await abrirPainel();
    } catch (e) { erro.textContent = e.message; }
  });

  document.getElementById("senha").addEventListener("keydown", e => { if (e.key === "Enter") entrar.click(); });

  ["filtroCurso", "filtroSerie", "filtroTurma"].forEach(id => document.getElementById(id).addEventListener("change", () => {
    carregarAnalise({
      course: document.getElementById("filtroCurso").value,
      series: document.getElementById("filtroSerie").value,
      class_name: document.getElementById("filtroTurma").value
    }).catch(e => {
      if (e.status === 401) location.reload();
    });
  }));

  document.getElementById("sairResultados").addEventListener("click", () => {
    sessionStorage.removeItem("nexmis_admin_token");
    location.reload();
  });

  document.getElementById("limpar").addEventListener("click", async () => {
    if (!confirm("Tem certeza que deseja apagar TODOS os resultados do banco de dados?")) return;
    try {
      await api("/api/responses", { method: "DELETE", headers: headersAdmin() });
      await carregarAnalise();
    } catch (e) { alert(e.message); }
  });

  document.getElementById("exportar").addEventListener("click", () => {
    document.body.classList.add("modo-exportacao");
    window.print();
    setTimeout(() => document.body.classList.remove("modo-exportacao"), 100);
  });

  if (obterToken()) abrirPainel();
}

iniciarPesquisa();
montarQuestionario();
configurarResultados();

/* NEXMIS — aba do Analista */

const CHAVE_TOKEN = "nexmis_admin_token";
const INTERVALO_ATUALIZACAO_MS = 4000;

let sessaoAtual = null;
let abaOrigem = "nova";
let temporizador = null;

const $ = id => document.getElementById(id);

function obterToken() { return sessionStorage.getItem(CHAVE_TOKEN); }
function headersAdmin() { return { Authorization: `Bearer ${obterToken()}` }; }

function sessaoExpirada() {
  sessionStorage.removeItem(CHAVE_TOKEN);
  pararAtualizacao();
  $("painel").classList.add("hidden");
  $("loginAnalista").classList.remove("hidden");
  $("erroLogin").textContent = "Sessão expirada. Digite a senha novamente.";
}

async function apiAdmin(url, options = {}) {
  try {
    return await api(url, { ...options, headers: { ...headersAdmin(), ...(options.headers || {}) } });
  } catch (e) {
    if (e.status === 401 && !options.ignorar401) sessaoExpirada();
    throw e;
  }
}

function formatarData(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

/* ---------- abas ---------- */

function mostrarVista(nome) {
  ["vistaNova", "vistaHistorico", "vistaDetalhe"]
    .forEach(v => $(v).classList.add("hidden"));

  $(nome).classList.remove("hidden");
}

function definirAba(aba) {
  pararAtualizacao();
  sessaoAtual = null;
  abaOrigem = aba;

  document.querySelectorAll("#abas button")
    .forEach(b => b.classList.toggle("ativa", b.dataset.aba === aba));

  $("abas").classList.remove("hidden");

  if (aba === "nova") {
    mostrarVista("vistaNova");
    carregarAndamento();
  } else {
    mostrarVista("vistaHistorico");
    carregarHistorico();
  }
}

/* ---------- listas ---------- */

async function carregarAndamento() {
  try {
    const dados = await apiAdmin("/api/admin/sessions?status=aberta");

    $("blocoAndamento").classList.toggle(
      "hidden",
      !dados.sessions.length
    );

    $("listaAndamento").innerHTML = dados.sessions.map(s => `
      <div class="pessoa-card">
        <div>
          <strong>${escaparHTML(s.name)}</strong>
          <small>
            Código ${escaparHTML(s.code)} ·
            ${s.total_responses} resposta(s)
          </small>
        </div>

        <button
          type="button"
          class="botao-mini"
          data-abrir="${escaparHTML(s.id)}">
          ABRIR
        </button>
      </div>
    `).join("");

  } catch (e) {}
}

async function carregarHistorico() {
  const alvo = $("listaHistorico");

  alvo.innerHTML = `<div class="sem-dados">Carregando...</div>`;

  try {
    const dados = await apiAdmin(
      "/api/admin/sessions?status=concluida"
    );

    if (!dados.sessions.length) {
      alvo.innerHTML =
        `<div class="sem-dados">Nenhuma pesquisa concluída ainda.</div>`;
      return;
    }

    alvo.innerHTML = dados.sessions.map(s => `
      <div class="pessoa-card">

        <div>
          <strong>${escaparHTML(s.name)}</strong>

          <small>
            Concluída em
            ${escaparHTML(formatarData(s.concluded_at))}
            · ${s.total_responses} resposta(s)
          </small>
        </div>

        <div class="acoes-admin">

          <button
            type="button"
            class="botao-mini"
            data-abrir="${escaparHTML(s.id)}">
            VER
          </button>

          <button
            type="button"
            class="botao-mini"
            data-apagar="${escaparHTML(s.id)}">
            APAGAR
          </button>

        </div>

      </div>
    `).join("");

  } catch (e) {

    alvo.innerHTML =
      `<div class="erro">${escaparHTML(e.message)}</div>`;

  }
}

/* ---------- apagar histórico ---------- */

async function apagarHistorico(id) {

  const confirmou = window.confirm(
    "Tem certeza que deseja apagar esta pesquisa do histórico?\n\n" +
    "Todas as respostas dessa pesquisa também serão apagadas. " +
    "Essa ação não pode ser desfeita."
  );

  if (!confirmou) return;

  const botoes = document.querySelectorAll(
    `[data-apagar="${CSS.escape(id)}"]`
  );

  botoes.forEach(botao => {
    botao.disabled = true;
    botao.textContent = "APAGANDO...";
  });

  try {

    await apiAdmin(
      `/api/admin/sessions/${encodeURIComponent(id)}`,
      {
        method: "DELETE"
      }
    );

    if (sessaoAtual && sessaoAtual.id === id) {
      sessaoAtual = null;
      mostrarVista("vistaHistorico");
    }

    await carregarHistorico();

  } catch (e) {

    const alvo = $("listaHistorico");

    alvo.insertAdjacentHTML(
      "afterbegin",
      `<div class="erro" role="alert">
        ${escaparHTML(e.message)}
      </div>`
    );

  }
}

/* ---------- nova pesquisa ---------- */

async function gerarPesquisa() {

  const erro = $("erroNova");
  erro.textContent = "";

  const curso = $("curso").value;
  const serie = $("serie").value;
  const turma = $("turma").value;

  if (!curso || !serie || !turma) {
    erro.textContent =
      "Selecione curso, série e turma antes de gerar o código.";
    return;
  }

  const botao = $("gerar");
  botao.disabled = true;

  try {

    const sessao = await apiAdmin(
      "/api/admin/sessions",
      {
        method: "POST",
        body: JSON.stringify({
          course: curso,
          series: serie,
          class_name: turma
        })
      }
    );

    await abrirDetalhe(sessao.id);

  } catch (e) {

    erro.textContent = e.message;

  } finally {

    botao.disabled = false;

  }
}

/* ---------- detalhe ---------- */

function urlDaPesquisa() {

  const url = new URL(
    "pesquisa.html",
    location.href
  );

  url.search = "";
  url.hash = "";

  return url.toString();
}

function renderizarDetalhe(dados) {

  const aberta = dados.status === "aberta";

  sessaoAtual = dados;

  $("detNome").textContent = dados.name;

  $("detStatus").textContent = aberta
    ? `PESQUISA EM ANDAMENTO · ${dados.total_responses} resposta(s)`
    : `PESQUISA CONCLUÍDA EM ${formatarData(dados.concluded_at).toUpperCase()} · ${dados.total_responses} resposta(s)`;

  $("blocoAberta").classList.toggle("hidden", !aberta);
  $("acoesAberta").classList.toggle("hidden", !aberta);
  $("acoesConcluida").classList.toggle("hidden", aberta);

  if (aberta) {

    $("detCodigo").textContent = dados.code;
    $("detLink").textContent = urlDaPesquisa();

  }

  $("detResumo").innerHTML = dados.total_responses
    ? `<div class="distribuicao">${barrasDistribuicao(dados)}</div>`
    : `<div class="sem-dados">
        Nenhuma resposta ainda.
        Os percentuais aparecem assim que os alunos começarem a responder.
      </div>`;

  $("detAtualizacao").textContent = aberta
    ? `Atualizado às ${new Date().toLocaleTimeString("pt-BR")} · atualização automática`
    : "";
}

async function atualizarDetalhe() {

  if (!sessaoAtual) return;

  try {

    const dados = await apiAdmin(
      `/api/admin/sessions/${encodeURIComponent(sessaoAtual.id)}`
    );

    if (!sessaoAtual || sessaoAtual.id !== dados.id) return;

    renderizarDetalhe(dados);

    if (dados.status !== "aberta") {
      pararAtualizacao();
    }

  } catch (e) {

    $("erroDetalhe").textContent =
      e.status === 401 ? "" : e.message;

  }
}

function pararAtualizacao() {

  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }

}

async function abrirDetalhe(id) {

  pararAtualizacao();

  $("erroDetalhe").textContent = "";
  $("confirmarConclusao").classList.add("hidden");
  $("senhaConclusao").value = "";

  const dados = await apiAdmin(
    `/api/admin/sessions/${encodeURIComponent(id)}`
  );

  $("abas").classList.add("hidden");

  mostrarVista("vistaDetalhe");

  renderizarDetalhe(dados);

  if (dados.status === "aberta") {
    temporizador = setInterval(
      atualizarDetalhe,
      INTERVALO_ATUALIZACAO_MS
    );
  }

}

/* ---------- concluir ---------- */

async function concluir() {

  const erro = $("erroDetalhe");
  erro.textContent = "";

  const senha = $("senhaConclusao").value;

  if (!senha) {
    erro.textContent =
      "Digite a senha para concluir.";
    return;
  }

  const botao = $("confirmarBtn");
  botao.disabled = true;

  try {

    const dados = await apiAdmin(
      `/api/admin/sessions/${encodeURIComponent(sessaoAtual.id)}/conclude`,
      {
        method: "POST",
        body: JSON.stringify({
          password: senha
        }),
        ignorar401: true
      }
    );

    pararAtualizacao();

    $("confirmarConclusao").classList.add("hidden");
    $("senhaConclusao").value = "";

    renderizarDetalhe(dados);

  } catch (e) {

    erro.textContent = e.message;

  } finally {

    botao.disabled = false;

  }
}

/* ---------- PDF ---------- */

function nomeArquivo(nome) {
  return String(nome)
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim() + ".pdf";
}

async function exportarPdf() {

  const erro = $("erroDetalhe");
  erro.textContent = "";

  const botao = $("exportarPdf");

  botao.disabled = true;
  botao.textContent = "GERANDO PDF...";

  try {

    const resposta = await fetch(
      apiUrl(
        `/api/admin/sessions/${encodeURIComponent(sessaoAtual.id)}/pdf`
      ),
      {
        headers: headersAdmin()
      }
    );

    if (!resposta.ok) {

      let detalhe =
        "Não foi possível gerar o PDF.";

      try {
        detalhe =
          (await resposta.json()).detail || detalhe;
      } catch {}

      if (resposta.status === 401) {
        sessaoExpirada();
        return;
      }

      throw new Error(detalhe);
    }

    const blob = await resposta.blob();

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download =
      nomeArquivo(sessaoAtual.name);

    document.body.appendChild(link);

    link.click();

    link.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      5000
    );

  } catch (e) {

    erro.textContent = e.message;

  } finally {

    botao.disabled = false;
    botao.textContent = "EXPORTAR PDF";

  }
}

/* ---------- entrada e saída ---------- */

function mostrarPainel() {

  $("loginAnalista").classList.add("hidden");
  $("painel").classList.remove("hidden");

  definirAba("nova");

}

async function entrar() {

  const erro = $("erroLogin");
  erro.textContent = "";

  const botao = $("entrar");
  botao.disabled = true;

  try {

    const dados = await api(
      "/api/admin/login",
      {
        method: "POST",
        body: JSON.stringify({
          password: $("senha").value
        })
      }
    );

    sessionStorage.setItem(
      CHAVE_TOKEN,
      dados.token
    );

    $("senha").value = "";

    mostrarPainel();

  } catch (e) {

    erro.textContent = e.message;

  } finally {

    botao.disabled = false;

  }
}

function iniciar() {

  $("entrar").addEventListener(
    "click",
    entrar
  );

  $("senha").addEventListener(
    "keydown",
    e => {
      if (e.key === "Enter") entrar();
    }
  );

  $("gerar").addEventListener(
    "click",
    gerarPesquisa
  );

  $("abas").addEventListener(
    "click",
    e => {

      const botao =
        e.target.closest("button[data-aba]");

      if (botao) {
        definirAba(botao.dataset.aba);
      }

    }
  );

  $("painel").addEventListener(
    "click",
    async e => {

      const apagar =
        e.target.closest("button[data-apagar]");

      if (apagar) {

        await apagarHistorico(
          apagar.dataset.apagar
        );

        return;
      }

      const botao =
        e.target.closest("button[data-abrir]");

      if (!botao) return;

      const origem = abaOrigem;

      try {

        await abrirDetalhe(
          botao.dataset.abrir
        );

        abaOrigem = origem;

      } catch (err) {}

    }
  );

  $("voltar").addEventListener(
    "click",
    () => definirAba(abaOrigem)
  );

  $("abrirConclusao").addEventListener(
    "click",
    () => {

      $("confirmarConclusao")
        .classList.remove("hidden");

      $("abrirConclusao")
        .classList.add("hidden");

      $("senhaConclusao").focus();

    }
  );

  $("cancelarConclusao").addEventListener(
    "click",
    () => {

      $("confirmarConclusao")
        .classList.add("hidden");

      $("abrirConclusao")
        .classList.remove("hidden");

      $("senhaConclusao").value = "";
      $("erroDetalhe").textContent = "";

    }
  );

  $("confirmarBtn").addEventListener(
    "click",
    concluir
  );

  $("senhaConclusao").addEventListener(
    "keydown",
    e => {
      if (e.key === "Enter") concluir();
    }
  );

  $("exportarPdf").addEventListener(
    "click",
    exportarPdf
  );

  $("sair").addEventListener(
    "click",
    () => {

      sessionStorage.removeItem(
        CHAVE_TOKEN
      );

      pararAtualizacao();

      location.reload();

    }
  );

  if (obterToken()) {

    apiAdmin(
      "/api/admin/sessions?status=aberta",
      { ignorar401: true }
    )
      .then(mostrarPainel)
      .catch(
        () => sessionStorage.removeItem(CHAVE_TOKEN)
      );

  }

}

iniciar();

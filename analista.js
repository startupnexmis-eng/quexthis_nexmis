/* NEXMIS — aba do Analista */

const CHAVE_TOKEN = "nexmis_admin_token";
const INTERVALO_ATUALIZACAO_MS = 4000;

let sessaoAtual = null;   // pesquisa aberta/concluída exibida no detalhe
let abaOrigem = "nova";   // de onde o analista abriu o detalhe (para o botão VOLTAR)
let temporizador = null;
let qrGeradoPara = null;

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

// Chamada autenticada; se o token expirou volta para a tela de senha.
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
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/* ---------- ano ---------- */
function preencherAnos() {
  const atual = new Date().getFullYear();
  const select = $("ano");
  select.innerHTML = [atual - 1, atual, atual + 1]
    .map(a => `<option value="${a}"${a === atual ? " selected" : ""}>${a}</option>`).join("");
}

/* ---------- abas ---------- */
function mostrarVista(nome) {
  ["vistaNova", "vistaHistorico", "vistaDetalhe"].forEach(v => $(v).classList.add("hidden"));
  $(nome).classList.remove("hidden");
}

function definirAba(aba) {
  pararAtualizacao();
  sessaoAtual = null;
  qrGeradoPara = null;
  abaOrigem = aba;
  document.querySelectorAll("#abas button").forEach(b => b.classList.toggle("ativa", b.dataset.aba === aba));
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
    $("blocoAndamento").classList.toggle("hidden", !dados.sessions.length);
    $("listaAndamento").innerHTML = dados.sessions.map(s => `
      <div class="pessoa-card">
        <div><strong>${escaparHTML(s.name)}</strong>
        <small>Código ${escaparHTML(s.code)} · ${s.total_responses} resposta(s)</small></div>
        <button type="button" class="botao-mini" data-abrir="${escaparHTML(s.id)}">ABRIR</button>
      </div>`).join("");
  } catch (e) { /* erro de sessão já tratado em apiAdmin */ }
}

async function carregarHistorico() {
  const alvo = $("listaHistorico");
  alvo.innerHTML = `<div class="sem-dados">Carregando...</div>`;
  try {
    const dados = await apiAdmin("/api/admin/sessions?status=concluida");
    if (!dados.sessions.length) {
      alvo.innerHTML = `<div class="sem-dados">Nenhuma pesquisa concluída ainda.</div>`;
      return;
    }
    alvo.innerHTML = dados.sessions.map(s => `
      <div class="pessoa-card">
        <div><strong>${escaparHTML(s.name)}</strong>
        <small>Concluída em ${escaparHTML(formatarData(s.concluded_at))} · ${s.total_responses} resposta(s)</small></div>
        <button type="button" class="botao-mini" data-abrir="${escaparHTML(s.id)}">VER</button>
      </div>`).join("");
  } catch (e) {
    alvo.innerHTML = `<div class="erro">${escaparHTML(e.message)}</div>`;
  }
}

/* ---------- nova pesquisa ---------- */
async function gerarPesquisa() {
  const erro = $("erroNova");
  erro.textContent = "";
  const curso = $("curso").value, serie = $("serie").value, ano = Number($("ano").value);
  if (!curso || !serie || !ano) {
    erro.textContent = "Selecione curso, série e ano antes de gerar o QR Code.";
    return;
  }
  const botao = $("gerar");
  botao.disabled = true;
  try {
    const sessao = await apiAdmin("/api/admin/sessions", {
      method: "POST",
      body: JSON.stringify({ course: curso, series: serie, year: ano })
    });
    await abrirDetalhe(sessao.id);
  } catch (e) {
    erro.textContent = e.message;
  } finally {
    botao.disabled = false;
  }
}

/* ---------- detalhe ---------- */
function urlDaPesquisa(codigo) {
  const url = new URL("pesquisa.html", location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("c", codigo);
  return url.toString();
}

function desenharQR(codigo) {
  if (qrGeradoPara === codigo) return;
  const caixa = $("qrBox");
  caixa.innerHTML = "";
  const link = urlDaPesquisa(codigo);
  $("detLink").textContent = link;
  if (typeof QRCode === "undefined") {
    caixa.innerHTML = `<div class="qr-falha">Não foi possível carregar o gerador de QR Code. Use o código ao lado.</div>`;
    qrGeradoPara = codigo;
    return;
  }
  new QRCode(caixa, { text: link, width: 220, height: 220, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
  qrGeradoPara = codigo;
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
    desenharQR(dados.code);
  }

  $("detResumo").innerHTML = dados.total_responses
    ? `<div class="distribuicao">${barrasDistribuicao(dados)}</div>`
    : `<div class="sem-dados">Nenhuma resposta ainda. Os percentuais aparecem assim que os alunos começarem a responder.</div>`;
  $("detAtualizacao").textContent = aberta ? `Atualizado às ${new Date().toLocaleTimeString("pt-BR")} · atualização automática` : "";
}

async function atualizarDetalhe() {
  if (!sessaoAtual) return;
  try {
    const dados = await apiAdmin(`/api/admin/sessions/${encodeURIComponent(sessaoAtual.id)}`);
    if (!sessaoAtual || sessaoAtual.id !== dados.id) return; // o analista já saiu desta tela
    renderizarDetalhe(dados);
    if (dados.status !== "aberta") pararAtualizacao();
  } catch (e) {
    $("erroDetalhe").textContent = e.status === 401 ? "" : e.message;
  }
}

function pararAtualizacao() {
  if (temporizador) { clearInterval(temporizador); temporizador = null; }
}

async function abrirDetalhe(id) {
  pararAtualizacao();
  $("erroDetalhe").textContent = "";
  $("confirmarConclusao").classList.add("hidden");
  $("senhaConclusao").value = "";
  qrGeradoPara = null;
  const dados = await apiAdmin(`/api/admin/sessions/${encodeURIComponent(id)}`);
  $("abas").classList.add("hidden");
  mostrarVista("vistaDetalhe");
  renderizarDetalhe(dados);
  if (dados.status === "aberta") temporizador = setInterval(atualizarDetalhe, INTERVALO_ATUALIZACAO_MS);
}

/* ---------- concluir ---------- */
async function concluir() {
  const erro = $("erroDetalhe");
  erro.textContent = "";
  const senha = $("senhaConclusao").value;
  if (!senha) { erro.textContent = "Digite a senha para concluir."; return; }
  const botao = $("confirmarBtn");
  botao.disabled = true;
  try {
    const dados = await apiAdmin(`/api/admin/sessions/${encodeURIComponent(sessaoAtual.id)}/conclude`, {
      method: "POST",
      body: JSON.stringify({ password: senha }),
      ignorar401: true   // senha errada aqui não deve derrubar a sessão do analista
    });
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
  return String(nome).replace(/[\\/:*?"<>|]/g, "-").trim() + ".pdf";
}

async function exportarPdf() {
  const erro = $("erroDetalhe");
  erro.textContent = "";
  const botao = $("exportarPdf");
  botao.disabled = true;
  botao.textContent = "GERANDO PDF...";
  try {
    const resposta = await fetch(apiUrl(`/api/admin/sessions/${encodeURIComponent(sessaoAtual.id)}/pdf`), { headers: headersAdmin() });
    if (!resposta.ok) {
      let detalhe = "Não foi possível gerar o PDF.";
      try { detalhe = (await resposta.json()).detail || detalhe; } catch {}
      if (resposta.status === 401) { sessaoExpirada(); return; }
      throw new Error(detalhe);
    }
    const blob = await resposta.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo(sessaoAtual.name); // nome do PDF = nome da turma
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
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
    const dados = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: $("senha").value }) });
    sessionStorage.setItem(CHAVE_TOKEN, dados.token);
    $("senha").value = "";
    mostrarPainel();
  } catch (e) {
    erro.textContent = e.message;
  } finally {
    botao.disabled = false;
  }
}

function iniciar() {
  preencherAnos();

  $("entrar").addEventListener("click", entrar);
  $("senha").addEventListener("keydown", e => { if (e.key === "Enter") entrar(); });
  $("gerar").addEventListener("click", gerarPesquisa);

  $("abas").addEventListener("click", e => {
    const botao = e.target.closest("button[data-aba]");
    if (botao) definirAba(botao.dataset.aba);
  });

  // "ABRIR" (em andamento) e "VER" (histórico)
  $("painel").addEventListener("click", async e => {
    const botao = e.target.closest("button[data-abrir]");
    if (!botao) return;
    const origem = abaOrigem;
    try {
      await abrirDetalhe(botao.dataset.abrir);
      abaOrigem = origem;
    } catch (err) { /* tratado em apiAdmin */ }
  });

  $("voltar").addEventListener("click", () => definirAba(abaOrigem));
  $("abrirConclusao").addEventListener("click", () => {
    $("confirmarConclusao").classList.remove("hidden");
    $("abrirConclusao").classList.add("hidden");
    $("senhaConclusao").focus();
  });
  $("cancelarConclusao").addEventListener("click", () => {
    $("confirmarConclusao").classList.add("hidden");
    $("abrirConclusao").classList.remove("hidden");
    $("senhaConclusao").value = "";
    $("erroDetalhe").textContent = "";
  });
  $("confirmarBtn").addEventListener("click", concluir);
  $("senhaConclusao").addEventListener("keydown", e => { if (e.key === "Enter") concluir(); });
  $("exportarPdf").addEventListener("click", exportarPdf);

  $("sair").addEventListener("click", () => {
    sessionStorage.removeItem(CHAVE_TOKEN);
    pararAtualizacao();
    location.reload();
  });

  // Se já existe token na aba, tenta abrir direto; se expirou, cai na tela de senha.
  if (obterToken()) {
    apiAdmin("/api/admin/sessions?status=aberta", { ignorar401: true })
      .then(mostrarPainel)
      .catch(() => sessionStorage.removeItem(CHAVE_TOKEN));
  }
}

iniciar();

/* NEXMIS — aba da Pesquisa (só abre com o código da turma) */

const ESCALA = ["Discordo totalmente", "Discordo", "Nem concordo nem discordo", "Concordo", "Concordo totalmente"];

const estilosDescricao = {
  "Comunismo": "Tendência associada à propriedade coletiva dos meios de produção e à redução das relações econômicas privadas.",
  "Socialismo": "Tendência associada a maior participação do Estado e/ou dos trabalhadores na organização econômica e à redução das desigualdades.",
  "Social-democracia": "Tendência associada à economia de mercado combinada com proteção social, serviços públicos e políticas de redução das desigualdades.",
  "Centro democrático": "Tendência intermediária no eixo utilizado pela pesquisa, sem predominância forte de um dos polos.",
  "Democracia cristã": "Tradição política que combina instituições democráticas, economia social de mercado e valores de inspiração cristã.",
  "Conservadorismo": "Tendência que dá maior peso à ordem, continuidade institucional, autoridade e preservação de valores tradicionais.",
  "Liberalismo clássico": "Tradição que enfatiza liberdade individual, propriedade privada, Estado limitado e maior autonomia do mercado."
};

const conteudo = document.getElementById("conteudo");
let pesquisa = null;   // dados da turma devolvidos pelo servidor
let codigo = "";
let nome = "";

// Trava de conveniência por pesquisa neste dispositivo. Quem garante de verdade
// uma resposta por pessoa é o servidor (nome único dentro da pesquisa).
const chaveRespondeu = c => `nexmis_respondeu_${c}`;
const jaRespondeu = c => localStorage.getItem(chaveRespondeu(c)) === "1";
const marcarRespondeu = c => localStorage.setItem(chaveRespondeu(c), "1");

function normalizarCodigo(v) {
  return String(v || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/* ---------- etapa 1: código ---------- */
function etapaCodigo(mensagem = "", valor = "") {
  conteudo.innerHTML = `
    <div class="kicker">01 — ACESSO À PESQUISA</div>
    <h1 class="titulo-questionario">Digite o código.</h1>
    <div class="linha"></div>
    <p class="descricao curto">Digite o código da pesquisa da sua turma, informado pelo analista.</p>
    <label for="codigo">CÓDIGO DA PESQUISA</label>
    <input id="codigo" class="campo-codigo" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" value="${escaparHTML(valor)}">
    <button id="entrarCodigo" type="button">ENTRAR NA PESQUISA →</button>
    <div id="erro" class="erro" role="alert" aria-live="polite">${escaparHTML(mensagem)}</div>`;
  const campo = document.getElementById("codigo");
  const botao = document.getElementById("entrarCodigo");
  botao.addEventListener("click", () => validarCodigo(campo.value));
  campo.addEventListener("keydown", e => { if (e.key === "Enter") botao.click(); });
  campo.focus();
}

async function validarCodigo(valor) {
  const cod = normalizarCodigo(valor);
  if (!cod) { etapaCodigo("Digite o código da pesquisa.", valor); return; }
  const botao = document.getElementById("entrarCodigo");
  if (botao) { botao.disabled = true; botao.textContent = "VERIFICANDO..."; }
  try {
    const dados = await api(`/api/pesquisa/${encodeURIComponent(cod)}`);
    if (jaRespondeu(cod)) {
      etapaBloqueada(dados.name);
      return;
    }
    pesquisa = dados;
    codigo = cod;
    etapaNome();
  } catch (e) {
    etapaCodigo(e.message, valor);
  }
}

function etapaBloqueada(nomeTurma) {
  conteudo.innerHTML = `
    <div class="kicker">PESQUISA JÁ RESPONDIDA</div>
    <h1 class="titulo-questionario">Obrigado.</h1>
    <div class="linha"></div>
    <p class="descricao">Este dispositivo já foi usado para responder à pesquisa da turma ${escaparHTML(nomeTurma)}. Cada pessoa pode participar apenas uma vez.</p>`;
}

/* ---------- etapa 2: nome ---------- */
function etapaNome(mensagem = "") {
  conteudo.innerHTML = `
    <div class="kicker">02 — IDENTIFICAÇÃO</div>
    <h1 class="titulo-questionario">Sua turma.</h1>
    <div class="linha"></div>
    <div class="identificacao">
      CURSO: ${escaparHTML(pesquisa.course)}<br>
      SÉRIE: ${escaparHTML(pesquisa.series)}<br>
      TURMA: ${escaparHTML(pesquisa.class_name || pesquisa.year)}
    </div>
    <label for="nome">NOME</label>
    <input id="nome" type="text" maxlength="80" placeholder="Digite seu nome" autocomplete="off" value="${escaparHTML(nome)}">
    <button id="iniciar" type="button">INICIAR QUESTIONÁRIO →</button>
    <div id="erro" class="erro" role="alert" aria-live="polite">${escaparHTML(mensagem)}</div>
    <div class="aviso">Responda de acordo com o seu próprio posicionamento. Não há respostas certas ou erradas.</div>`;
  const campo = document.getElementById("nome");
  const botao = document.getElementById("iniciar");
  botao.addEventListener("click", () => {
    const valor = campo.value.trim();
    if (!valor) { document.getElementById("erro").textContent = "Digite seu nome para continuar."; return; }
    nome = valor;
    etapaQuestionario();
  });
  campo.addEventListener("keydown", e => { if (e.key === "Enter") botao.click(); });
}

/* ---------- etapa 3: questionário ---------- */
async function etapaQuestionario() {
  conteudo.innerHTML = `<div class="kicker">CARREGANDO QUESTIONÁRIO...</div>`;
  let dados;
  try {
    dados = await api("/api/questions");
  } catch (e) {
    etapaNome("Não foi possível carregar o questionário. Verifique a conexão com o servidor.");
    return;
  }

  conteudo.innerHTML = `
    <div class="kicker">03 — QUESTIONÁRIO · ${dados.count} AFIRMAÇÕES</div>
    <h1 class="titulo-questionario">Sua perspectiva.</h1>
    <div class="linha"></div>
    <div class="identificacao">
      NOME: ${escaparHTML(nome)}<br>
      TURMA: ${escaparHTML(pesquisa.name)}
    </div>
    <div class="escala-legenda">${dados.scale.map(t => `<span>${escaparHTML(t)}</span>`).join("")}</div>
    <form id="questionario">
      <div id="perguntas">${dados.questions.map(item => `
        <div class="pergunta">
          <div class="pergunta-numero">PERGUNTA ${String(item.id).padStart(2, "0")}</div>
          <h2>${escaparHTML(item.question)}</h2>
          <div>${dados.scale.map((texto, valor) => `
            <label class="alternativa">
              <input type="radio" name="pergunta${item.id - 1}" value="${valor}">
              <span>${escaparHTML(texto)}</span>
            </label>`).join("")}</div>
        </div>`).join("")}
      </div>
      <div id="erroQuestionario" class="erro" role="alert" aria-live="polite"></div>
      <button type="submit">FINALIZAR QUESTIONÁRIO →</button>
    </form>`;
  document.getElementById("questionario").addEventListener("submit", finalizar);
  window.scrollTo(0, 0);
}

async function finalizar(event) {
  event.preventDefault();
  const erro = document.getElementById("erroQuestionario");
  erro.textContent = "";
  const respostas = [];
  const total = document.querySelectorAll(".pergunta").length;

  for (let i = 0; i < total; i++) {
    const marcada = document.querySelector(`input[name="pergunta${i}"]:checked`);
    if (!marcada) {
      erro.textContent = `Responda a pergunta ${i + 1} antes de finalizar.`;
      document.querySelector(`input[name="pergunta${i}"]`).focus();
      return;
    }
    respostas.push(Number(marcada.value));
  }

  const botao = document.querySelector("#questionario button[type=submit]");
  botao.disabled = true;
  botao.textContent = "ENVIANDO RESPOSTAS...";

  try {
    const resultado = await api(`/api/pesquisa/${encodeURIComponent(codigo)}/respostas`, {
      method: "POST",
      body: JSON.stringify({ name: nome, answers: respostas })
    });
    marcarRespondeu(codigo);
    mostrarResultado(resultado);
  } catch (e) {
    if (e.status === 409) marcarRespondeu(codigo);
    erro.textContent = e.message;
    botao.disabled = false;
    botao.textContent = "FINALIZAR QUESTIONÁRIO →";
  }
}

/* ---------- etapa 4: resultado individual ---------- */
function mostrarResultado(resultado) {
  const estilo = escaparHTML(resultado.government_style);
  const lado = escaparHTML(resultado.side);
  const descricao = escaparHTML(estilosDescricao[resultado.government_style] || "Tendência aproximada calculada pelas respostas do questionário.");
  conteudo.innerHTML = `
    <div class="kicker">PESQUISA CONCLUÍDA</div>
    <h1 class="titulo-questionario">Seu resultado.</h1>
    <div class="linha"></div>
    <div class="resultado-individual-final">
      <div class="resultado-final-label">ESTILO DE GOVERNO / TENDÊNCIA POLÍTICA</div>
      <div class="resultado-final-estilo">${estilo}</div>
      <div class="resultado-final-lado">Posicionamento no eixo: ${lado}</div>
      <p class="resultado-final-descricao">${descricao}</p>
      <p class="resultado-final-nota">Este resultado é uma aproximação baseada exclusivamente nas respostas. Ele não representa uma identidade política definitiva.</p>
    </div>`;
  window.scrollTo(0, 0);
}

/* ---------- início: com ?c=CODIGO (QR) pula direto a validação ---------- */
const codigoDaUrl = normalizarCodigo(new URLSearchParams(location.search).get("c"));
if (codigoDaUrl) {
  conteudo.innerHTML = `<div class="kicker">VERIFICANDO CÓDIGO...</div>`;
  validarCodigo(codigoDaUrl);
} else {
  etapaCodigo();
}

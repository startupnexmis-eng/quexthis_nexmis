import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    psycopg = None
    dict_row = None
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("NEXMIS_DB_PATH", ROOT / "data" / "nexmis.db"))
DATABASE_URL = os.getenv("NEXMIS_DATABASE_URL") or os.getenv("DATABASE_URL")

QUESTIONS_PATH = ROOT / "questions.json"
ADMIN_PASSWORD = os.getenv("NEXMIS_ADMIN_PASSWORD")
TOKEN_SECRET = os.getenv("NEXMIS_TOKEN_SECRET")
CORS_ORIGINS = [x.strip() for x in os.getenv("NEXMIS_CORS_ORIGINS", "").split(",") if x.strip()]
if not ADMIN_PASSWORD:
    raise RuntimeError("NEXMIS_ADMIN_PASSWORD não foi configurada no ambiente do servidor.")
if not TOKEN_SECRET or len(TOKEN_SECRET) < 32:
    raise RuntimeError("NEXMIS_TOKEN_SECRET precisa ter pelo menos 32 caracteres.")
TOKEN_TTL_SECONDS = int(os.getenv("NEXMIS_TOKEN_TTL", "28800"))

COURSES = {"Desenvolvimento de Sistemas", "Eletrotécnica"}
SERIES = {"1º Ano", "2º Ano", "3º Ano"}
CLASSES = {"Turma A", "Turma B"}
CATEGORIES = ["Esquerda", "Centro-esquerda", "Centro", "Centro-direita", "Direita"]
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sem 0/O/1/I para evitar confusão
CODE_LENGTH = 6

with open(QUESTIONS_PATH, "r", encoding="utf-8") as f:
    QUESTIONS = json.load(f)

if len(QUESTIONS) != 27:
    raise RuntimeError(f"questions.json precisa ter 27 perguntas; encontrou {len(QUESTIONS)}")

app = FastAPI(title="NEXMIS API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


# ---------------------------------------------------------------- banco
class PostgresDB:
    """Pequeno adaptador para manter o código existente usando '?' nos parâmetros."""
    def __init__(self, url):
        self.conn = psycopg.connect(url, row_factory=dict_row, connect_timeout=15)

    def execute(self, sql, params=None):
        return self.conn.execute(sql.replace("?", "%s"), params or ())

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self.conn.commit()
            else:
                self.conn.rollback()
        finally:
            self.conn.close()
        return False


def get_db():
    """Abre o banco externo (PostgreSQL) quando DATABASE_URL estiver configurada.
    Sem DATABASE_URL, mantém SQLite local para facilitar testes no computador.
    """
    if DATABASE_URL:
        if psycopg is None:
            raise RuntimeError("A dependência psycopg não está instalada.")
        return PostgresDB(DATABASE_URL)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db():
    if DATABASE_URL:
        if psycopg is None:
            raise RuntimeError("A dependência psycopg não está instalada.")
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as db:
            db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL,
                course TEXT NOT NULL,
                series TEXT NOT NULL,
                year INTEGER NOT NULL,
                class_name TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'aberta',
                created_at TEXT NOT NULL,
                concluded_at TEXT
            )
            """)
            db.execute("CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)")
            db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_codigo_aberta
                ON sessions(code) WHERE status = 'aberta'""")
            db.execute("""
            CREATE TABLE IF NOT EXISTS session_responses (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                answers_json TEXT NOT NULL,
                score DOUBLE PRECISION NOT NULL,
                political_side TEXT NOT NULL,
                government_style TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """)
            db.execute("CREATE INDEX IF NOT EXISTS idx_sr_session ON session_responses(session_id)")
            db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_unica_pessoa
                ON session_responses(session_id, LOWER(TRIM(name)))""")
            db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_turma_aberta_v2
                ON sessions(course, series, class_name) WHERE status = 'aberta'""")
        return

    # Banco local para testes. No Render, use NEXMIS_DATABASE_URL/DATABASE_URL.
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, code TEXT NOT NULL, course TEXT NOT NULL, series TEXT NOT NULL,
            year INTEGER NOT NULL, class_name TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'aberta', created_at TEXT NOT NULL, concluded_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_codigo_aberta ON sessions(code) WHERE status = 'aberta';
        CREATE TABLE IF NOT EXISTS session_responses (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            name TEXT NOT NULL, answers_json TEXT NOT NULL, score REAL NOT NULL,
            political_side TEXT NOT NULL, government_style TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sr_session ON session_responses(session_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_unica_pessoa ON session_responses(session_id, LOWER(TRIM(name)));
        """)
        cols = [r["name"] for r in db.execute("PRAGMA table_info(sessions)")]
        if "class_name" not in cols:
            db.execute("ALTER TABLE sessions ADD COLUMN class_name TEXT NOT NULL DEFAULT ''")
        db.execute("DROP INDEX IF EXISTS idx_sessions_turma_aberta")
        db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_turma_aberta_v2
            ON sessions(course, series, class_name) WHERE status = 'aberta'""")


init_db()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- cálculo (igual à versão anterior)
def classify_side(score: float) -> str:
    if score <= -30:
        return "Esquerda"
    if score < -10:
        return "Centro-esquerda"
    if score < 10:
        return "Centro"
    if score < 30:
        return "Centro-direita"
    return "Direita"


def classify_style(score: float) -> str:
    if score <= -60:
        return "Comunismo"
    if score <= -30:
        return "Socialismo"
    if score <= -10:
        return "Social-democracia"
    if score < 10:
        return "Centro democrático"
    if score < 30:
        return "Democracia cristã"
    if score < 60:
        return "Conservadorismo"
    return "Liberalismo clássico"


def calculate_score(answers: list[int]) -> float:
    total = 0
    for value, question in zip(answers, QUESTIONS):
        total += (value - 2) * int(question["direcao"])
    return round((total / (len(QUESTIONS) * 2)) * 100, 2)


# ---------------------------------------------------------------- autenticação do analista
def make_token() -> str:
    payload = {"exp": int(datetime.now(timezone.utc).timestamp()) + TOKEN_TTL_SECONDS, "nonce": secrets.token_hex(8)}
    raw = json.dumps(payload, separators=(",", ":")).encode()
    body = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    sig = hmac.new(TOKEN_SECRET.encode(), body.encode(), hashlib.sha256).digest()
    return body + "." + base64.urlsafe_b64encode(sig).decode().rstrip("=")


def valid_token(token: str) -> bool:
    try:
        body, encoded_sig = token.split(".", 1)
        expected = hmac.new(TOKEN_SECRET.encode(), body.encode(), hashlib.sha256).digest()
        supplied = base64.urlsafe_b64decode(encoded_sig + "=" * (-len(encoded_sig) % 4))
        if not hmac.compare_digest(expected, supplied):
            return False
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return int(payload["exp"]) > int(datetime.now(timezone.utc).timestamp())
    except Exception:
        return False


def admin_guard(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Acesso restrito.")
    if not valid_token(authorization[7:].strip()):
        raise HTTPException(status_code=401, detail="Sessão do analista expirada ou inválida.")
    return True


def check_password(password: str) -> bool:
    return hmac.compare_digest(password.encode(), ADMIN_PASSWORD.encode())


# ---------------------------------------------------------------- modelos
class LoginIn(BaseModel):
    password: str


class SessionIn(BaseModel):
    course: str
    series: str
    class_name: str


class ConcludeIn(BaseModel):
    password: str


class ResponseIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    answers: list[int]


# ---------------------------------------------------------------- utilitários de pesquisa
def session_name(course: str, series: str, class_name: str) -> str:
    return f"{course} - {series} - {class_name}"


def new_code(db) -> str:
    for _ in range(50):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        exists = db.execute("SELECT 1 FROM sessions WHERE code = ? AND status = 'aberta'", (code,)).fetchone()
        if not exists:
            return code
    raise HTTPException(status_code=500, detail="Não foi possível gerar um código. Tente novamente.")


def normalize_code(code: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", code or "").upper()


def session_stats(db, session_id: str) -> dict:
    rows = db.execute(
        "SELECT political_side, COUNT(*) AS n FROM session_responses WHERE session_id = ? GROUP BY political_side",
        (session_id,),
    ).fetchall()
    counts = {cat: 0 for cat in CATEGORIES}
    for r in rows:
        counts[r["political_side"]] = r["n"]
    total = sum(counts.values())
    return {
        "total_responses": total,
        "categories": {
            cat: {"count": counts[cat], "percent": round(counts[cat] / total * 100, 1) if total else 0}
            for cat in CATEGORIES
        },
    }


def session_public(row) -> dict:
    return {
        "id": row["id"],
        "code": row["code"],
        "course": row["course"],
        "series": row["series"],
        "year": row["year"],
        "class_name": row["class_name"],
        "name": row["name"],
        "status": row["status"],
        "created_at": row["created_at"],
        "concluded_at": row["concluded_at"],
    }


def get_session_or_404(db, session_id: str):
    row = db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pesquisa não encontrada.")
    return row


# ---------------------------------------------------------------- rotas públicas
@app.get("/api/health")
def health():
    return {"ok": True, "service": "NEXMIS API"}


@app.get("/api/questions")
def questions():
    # Apenas o texto e a escala são públicos; a direção usada no cálculo fica no servidor.
    return {
        "count": len(QUESTIONS),
        "scale": ["Discordo totalmente", "Discordo", "Nem concordo nem discordo", "Concordo", "Concordo totalmente"],
        "questions": [{"id": i + 1, "question": q["pergunta"]} for i, q in enumerate(QUESTIONS)],
    }


@app.get("/api/pesquisa/{code}")
def open_survey(code: str):
    """Valida o código da pesquisa. Só funciona enquanto a pesquisa estiver aberta."""
    code = normalize_code(code)
    with get_db() as db:
        row = db.execute("SELECT * FROM sessions WHERE code = ? AND status = 'aberta'", (code,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Código inválido ou pesquisa já encerrada.")
    return {"code": row["code"], "name": row["name"], "course": row["course"], "series": row["series"], "year": row["year"], "class_name": row["class_name"]}


@app.post("/api/pesquisa/{code}/respostas")
def submit_response(code: str, data: ResponseIn):
    code = normalize_code(code)
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome inválido.")
    if len(data.answers) != len(QUESTIONS) or any(v not in range(5) for v in data.answers):
        raise HTTPException(status_code=400, detail="As respostas precisam conter exatamente 27 valores entre 0 e 4.")

    score = calculate_score(data.answers)
    side = classify_side(score)
    style = classify_style(score)
    response_id = secrets.token_hex(16)

    try:
        with get_db() as db:
            # A checagem e a gravação acontecem na mesma conexão/transação.
            row = db.execute("SELECT id FROM sessions WHERE code = ? AND status = 'aberta'", (code,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Esta pesquisa já foi encerrada. Suas respostas não foram registradas.")
            db.execute(
                """INSERT INTO session_responses
                (id, session_id, name, answers_json, score, political_side, government_style, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (response_id, row["id"], name, json.dumps(data.answers), score, side, style, now_iso()),
            )
    except (sqlite3.IntegrityError, psycopg.IntegrityError if psycopg else sqlite3.IntegrityError):
        raise HTTPException(
            status_code=409,
            detail="Este nome já respondeu à pesquisa desta turma. Cada pessoa pode responder apenas uma vez.",
        )

    return {
        "id": response_id,
        "side": side,
        "government_style": style,
        "score": score,
        "message": "Resposta registrada com sucesso.",
    }


# ---------------------------------------------------------------- rotas do analista
@app.post("/api/admin/login")
def admin_login(data: LoginIn):
    if not check_password(data.password):
        raise HTTPException(status_code=401, detail="Senha incorreta.")
    return {"token": make_token(), "expires_in": TOKEN_TTL_SECONDS}


@app.post("/api/admin/sessions")
def create_session(data: SessionIn, _: bool = Depends(admin_guard)):
    if data.course not in COURSES:
        raise HTTPException(status_code=400, detail="Curso inválido.")
    if data.series not in SERIES:
        raise HTTPException(status_code=400, detail="Série inválida.")
    if data.class_name not in CLASSES:
        raise HTTPException(status_code=400, detail="Turma inválida.")

    with get_db() as db:
        # Se já existe uma pesquisa aberta para a turma, retoma em vez de duplicar.
        existing = db.execute(
            "SELECT * FROM sessions WHERE course = ? AND series = ? AND class_name = ? AND status = 'aberta'",
            (data.course, data.series, data.class_name),
        ).fetchone()
        if existing:
            return {**session_public(existing), "resumed": True}

        session_id = secrets.token_hex(12)
        code = new_code(db)
        name = session_name(data.course, data.series, data.class_name)
        year = datetime.now(_fuso_brasil()).year  # guardado só como registro; não é escolhido pelo analista
        db.execute(
            "INSERT INTO sessions (id, code, course, series, year, class_name, name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'aberta', ?)",
            (session_id, code, data.course, data.series, year, data.class_name, name, now_iso()),
        )
        row = db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    return {**session_public(row), "resumed": False}


@app.get("/api/admin/sessions")
def list_sessions(status: Optional[str] = None, _: bool = Depends(admin_guard)):
    if status not in (None, "aberta", "concluida"):
        raise HTTPException(status_code=400, detail="Status inválido.")
    query = """SELECT s.*, (SELECT COUNT(*) FROM session_responses r WHERE r.session_id = s.id) AS total
               FROM sessions s"""
    params = []
    if status:
        query += " WHERE s.status = ?"
        params.append(status)
    query += " ORDER BY COALESCE(s.concluded_at, s.created_at) DESC"
    with get_db() as db:
        rows = db.execute(query, params).fetchall()
    return {"sessions": [{**session_public(r), "total_responses": r["total"]} for r in rows]}


@app.get("/api/admin/sessions/{session_id}")
def get_session(session_id: str, _: bool = Depends(admin_guard)):
    with get_db() as db:
        row = get_session_or_404(db, session_id)
        stats = session_stats(db, session_id)
    return {**session_public(row), **stats}


@app.delete("/api/admin/sessions/{session_id}")
def delete_session(session_id: str, _: bool = Depends(admin_guard)):
    """Apaga uma pesquisa concluída e todas as respostas vinculadas a ela."""
    with get_db() as db:
        row = get_session_or_404(db, session_id)
        if row["status"] != "concluida":
            raise HTTPException(status_code=409, detail="Só é possível apagar pesquisas concluídas.")
        db.execute("DELETE FROM session_responses WHERE session_id = ?", (session_id,))
        db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    return {"ok": True, "message": "Pesquisa apagada do histórico."}


@app.post("/api/admin/sessions/{session_id}/conclude")
def conclude_session(session_id: str, data: ConcludeIn, _: bool = Depends(admin_guard)):
    # Concluir exige a senha de novo, mesmo com o analista já logado.
    if not check_password(data.password):
        raise HTTPException(status_code=401, detail="Senha incorreta. A pesquisa continua aberta.")
    with get_db() as db:
        row = get_session_or_404(db, session_id)
        if row["status"] == "concluida":
            raise HTTPException(status_code=409, detail="Esta pesquisa já foi concluída.")
        db.execute(
            "UPDATE sessions SET status = 'concluida', concluded_at = ? WHERE id = ?",
            (now_iso(), session_id),
        )
        row = get_session_or_404(db, session_id)
        stats = session_stats(db, session_id)
    return {**session_public(row), **stats}


# ---------------------------------------------------------------- PDF
def safe_filename(name: str) -> str:
    # Mantém o nome da turma; só remove o que sistemas de arquivos não aceitam.
    return re.sub(r'[\\/:*?"<>|]', "-", name).strip() or "turma"


def _fuso_brasil():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("America/Sao_Paulo")
    except Exception:
        return timezone(timedelta(hours=-3))


def format_date_br(iso: Optional[str]) -> str:
    if not iso:
        return "-"
    try:
        return datetime.fromisoformat(iso).astimezone(_fuso_brasil()).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return iso


def build_pdf(session: dict, stats: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(session["name"])
    c.setAuthor("NEXMIS")
    width, height = A4
    left = 20 * mm
    right = width - 20 * mm
    content_w = right - left
    y = height - 22 * mm

    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#666666"))
    c.drawString(left, y, "NEXMIS  |  RELATÓRIO DA PESQUISA DE PERSPECTIVAS POLÍTICAS")
    y -= 14 * mm

    c.setFillColor(colors.HexColor("#111111"))
    c.setFont("Helvetica-Bold", 22)
    c.drawString(left, y, session["name"])
    y -= 8 * mm
    c.setStrokeColor(colors.HexColor("#111111"))
    c.setLineWidth(0.8)
    c.line(left, y, left + 40 * mm, y)
    y -= 9 * mm

    c.setFont("Helvetica", 10)
    c.setFillColor(colors.HexColor("#333333"))
    info = [
        ("Curso", session["course"]),
        ("Série", session["series"]),
        ("Turma", session["class_name"]) if session.get("class_name") else ("Ano", str(session["year"])),
        ("Pesquisa iniciada em", format_date_br(session["created_at"])),
        ("Pesquisa concluída em", format_date_br(session["concluded_at"])),
        ("Total de respostas", str(stats["total_responses"])),
    ]
    for label, value in info:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(left, y, label + ":")
        c.setFont("Helvetica", 10)
        c.drawString(left + 48 * mm, y, value)
        y -= 6 * mm

    y -= 8 * mm
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(colors.HexColor("#111111"))
    c.drawString(left, y, "Distribuição por posicionamento")
    y -= 10 * mm

    shades = ["#EEEEEE", "#C9C9C1", "#999999", "#666666", "#333333"]
    if stats["total_responses"] == 0:
        c.setFont("Helvetica", 10)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(left, y, "Nenhuma resposta foi registrada nesta pesquisa.")
        y -= 8 * mm
    else:
        # barra empilhada
        bar_h = 9 * mm
        x = left
        for i, cat in enumerate(CATEGORIES):
            w = content_w * stats["categories"][cat]["percent"] / 100
            if w > 0:
                c.setFillColor(colors.HexColor(shades[i]))
                c.setStrokeColor(colors.HexColor("#111111"))
                c.setLineWidth(0.4)
                c.rect(x, y - bar_h, w, bar_h, fill=1, stroke=1)
                x += w
        c.setStrokeColor(colors.HexColor("#111111"))
        c.setLineWidth(0.6)
        c.rect(left, y - bar_h, content_w, bar_h, fill=0, stroke=1)
        y -= bar_h + 12 * mm

        # tabela
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(colors.HexColor("#111111"))
        c.drawString(left + 8 * mm, y, "POSICIONAMENTO")
        c.drawRightString(left + 120 * mm, y, "RESPOSTAS")
        c.drawRightString(right, y, "PERCENTUAL")
        y -= 3 * mm
        c.setStrokeColor(colors.HexColor("#111111"))
        c.setLineWidth(0.6)
        c.line(left, y, right, y)
        y -= 7 * mm
        for i, cat in enumerate(CATEGORIES):
            data = stats["categories"][cat]
            c.setFillColor(colors.HexColor(shades[i]))
            c.setStrokeColor(colors.HexColor("#111111"))
            c.setLineWidth(0.4)
            c.rect(left, y - 0.8 * mm, 4 * mm, 4 * mm, fill=1, stroke=1)
            c.setFillColor(colors.HexColor("#111111"))
            c.setFont("Helvetica", 10)
            c.drawString(left + 8 * mm, y, cat)
            c.drawRightString(left + 120 * mm, y, str(data["count"]))
            c.drawRightString(right, y, f"{data['percent']:.1f}%".replace(".", ","))
            y -= 4 * mm
            c.setStrokeColor(colors.HexColor("#DDDDDD"))
            c.setLineWidth(0.3)
            c.line(left, y, right, y)
            y -= 6 * mm

    y -= 6 * mm
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#777777"))
    note = (
        "Dados agregados. O resultado indica uma tendência predominante a partir das respostas, "
        "não uma identidade política definitiva."
    )
    c.drawString(left, y, note[:105])
    if len(note) > 105:
        y -= 4 * mm
        c.drawString(left, y, note[105:].lstrip())

    c.setFont("Helvetica", 7)
    c.drawString(left, 12 * mm, "PROGRAMA DO NEXMIS © 2026")
    c.showPage()
    c.save()
    return buf.getvalue()


@app.get("/api/admin/sessions/{session_id}/pdf")
def session_pdf(session_id: str, _: bool = Depends(admin_guard)):
    with get_db() as db:
        row = get_session_or_404(db, session_id)
        if row["status"] != "concluida":
            raise HTTPException(status_code=409, detail="Conclua a pesquisa antes de exportar o PDF.")
        stats = session_stats(db, session_id)
    pdf = build_pdf(session_public(row), stats)
    filename = safe_filename(row["name"]) + ".pdf"
    ascii_name = filename.encode("ascii", "ignore").decode() or "turma.pdf"
    from urllib.parse import quote
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": disposition})


# ---------------------------------------------------------------- páginas estáticas
@app.get("/")
def index():
    return FileResponse(ROOT / "index.html")


@app.get("/{page:path}")
def static_pages(page: str):
    # Evita expor o arquivo do banco ou outros arquivos do backend.
    target = (ROOT / page).resolve()
    if not str(target).startswith(str(ROOT.resolve())):
        raise HTTPException(status_code=404)
    if target.is_file() and target.suffix.lower() in {".html", ".js", ".css", ".json", ".png", ".jpg", ".jpeg", ".svg", ".ico"}:
        return FileResponse(target)
    raise HTTPException(status_code=404)

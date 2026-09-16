import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
 
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
 
ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("NEXMIS_DB_PATH", ROOT / "data" / "nexmis.db"))
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
 
with open(QUESTIONS_PATH, "r", encoding="utf-8") as f:
    QUESTIONS = json.load(f)
 
if len(QUESTIONS) != 27:
    raise RuntimeError(f"questions.json precisa ter 27 perguntas; encontrou {len(QUESTIONS)}")
 
app = FastAPI(title="NEXMIS API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
 
 
def get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn
 
 
def init_db():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS responses (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            course TEXT NOT NULL,
            series TEXT NOT NULL,
            class_name TEXT NOT NULL,
            answers_json TEXT NOT NULL,
            score REAL NOT NULL,
            political_side TEXT NOT NULL,
            government_style TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
 
        CREATE INDEX IF NOT EXISTS idx_responses_group
            ON responses(course, series, class_name);
        CREATE INDEX IF NOT EXISTS idx_responses_side
            ON responses(political_side);
        CREATE INDEX IF NOT EXISTS idx_responses_created
            ON responses(created_at);
 
        -- Garante, no próprio banco, que a mesma pessoa (nome + curso + série + turma)
        -- não consiga ter duas respostas registradas, mesmo que o navegador seja outro
        -- ou o armazenamento local tenha sido limpo.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_unica_pessoa
            ON responses(LOWER(TRIM(name)), course, series, class_name);
        """)
 
 
init_db()
 
 
def now_iso():
    return datetime.now(timezone.utc).isoformat()
 
 
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
    # Mantém a classificação de estilo já usada no projeto.
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
 
 
class ResponseIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    course: str
    series: str
    class_name: str = Field(min_length=1, max_length=50)
    answers: list[int]
 
 
class LoginIn(BaseModel):
    password: str
 
 
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
 
 
@app.post("/api/admin/login")
def admin_login(data: LoginIn):
    if not hmac.compare_digest(data.password, ADMIN_PASSWORD):
        raise HTTPException(status_code=401, detail="Senha incorreta.")
    return {"token": make_token(), "expires_in": TOKEN_TTL_SECONDS}
 
 
@app.post("/api/responses")
def create_response(data: ResponseIn):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome inválido.")
    if data.course not in COURSES:
        raise HTTPException(status_code=400, detail="Curso inválido.")
    if data.series not in SERIES:
        raise HTTPException(status_code=400, detail="Série inválida.")
    if data.class_name not in CLASSES:
        raise HTTPException(status_code=400, detail="Turma inválida.")
    if len(data.answers) != len(QUESTIONS) or any(v not in range(5) for v in data.answers):
        raise HTTPException(status_code=400, detail="As respostas precisam conter exatamente 27 valores entre 0 e 4.")
 
    score = calculate_score(data.answers)
    side = classify_side(score)
    style = classify_style(score)
    response_id = secrets.token_hex(16)
    created_at = now_iso()
 
    try:
        with get_db() as db:
            db.execute(
                """INSERT INTO responses
                (id, name, course, series, class_name, answers_json, score, political_side, government_style, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (response_id, name, data.course, data.series, data.class_name,
                 json.dumps(data.answers), score, side, style, created_at),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="Este questionário já foi respondido com esse nome, curso, série e turma. Cada pessoa pode responder apenas uma vez.",
        )
 
    return {
        "id": response_id,
        "side": side,
        "government_style": style,
        "score": score,
        "message": "Resposta registrada com sucesso.",
    }
 
 
def rows_to_groups(rows):
    groups = {}
    for row in rows:
        key = (row["course"], row["series"], row["class_name"])
        groups.setdefault(key, {cat: 0 for cat in CATEGORIES})
        groups[key][row["political_side"]] += 1
    result = []
    for (course, series, class_name), counts in sorted(groups.items()):
        total = sum(counts.values())
        result.append({
            "course": course,
            "series": series,
            "class_name": class_name,
            "total": total,
            "categories": {cat: {"count": counts[cat], "percent": round(counts[cat] / total * 100, 1) if total else 0} for cat in CATEGORIES},
        })
    return result
 
 
@app.get("/api/analytics")
def analytics(
    _: bool = Depends(admin_guard),
    course: Optional[str] = Query(default=None),
    series: Optional[str] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
):
    where = []
    params = []
    if course:
        where.append("course = ?"); params.append(course)
    if series:
        where.append("series = ?"); params.append(series)
    if class_name:
        where.append("class_name = ?"); params.append(class_name)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
 
    with get_db() as db:
        rows = db.execute(f"SELECT course, series, class_name, political_side FROM responses{clause}", params).fetchall()
        filters = {
            "courses": [r[0] for r in db.execute("SELECT DISTINCT course FROM responses ORDER BY course")],
            "series": [r[0] for r in db.execute("SELECT DISTINCT series FROM responses ORDER BY series")],
            "classes": [r[0] for r in db.execute("SELECT DISTINCT class_name FROM responses ORDER BY class_name")],
        }
 
    groups = rows_to_groups(rows)
    total = len(rows)
    counts = {cat: sum(g["categories"][cat]["count"] for g in groups) for cat in CATEGORIES}
    overall = {cat: {"count": counts[cat], "percent": round(counts[cat] / total * 100, 1) if total else 0} for cat in CATEGORIES}
 
    return {"total_responses": total, "categories": overall, "groups": groups, "filters": filters}
 
 
@app.delete("/api/responses")
def delete_all(_: bool = Depends(admin_guard)):
    with get_db() as db:
        deleted = db.execute("DELETE FROM responses").rowcount
    return {"deleted": deleted}
 
 
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
 

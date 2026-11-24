"""Aviso por e-mail ao administrador quando uma importação falha.
Só vão informações técnicas (arquivo, colunas, linhas) — nunca dados de alunos."""
from __future__ import annotations

import logging
import os
import smtplib
import threading
import time
from email.message import EmailMessage

log = logging.getLogger("localiza")
HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
PORT = int(os.environ.get("SMTP_PORT", "587"))
SEC = os.environ.get("SMTP_SECURITY", "starttls").lower()  # starttls | ssl | none
USER = os.environ.get("SMTP_USER", "")
PASS = os.environ.get("SMTP_PASSWORD", "")
ADMIN = os.environ.get("ADMIN_EMAIL", "") or USER

_lock = threading.Lock()
_recent: dict[str, float] = {}
_sent: list[float] = []


def ativo() -> bool:
    return bool(USER and PASS and ADMIN)


def notificar(assunto: str, linhas: list[str], chave: str) -> bool:
    """Envia em segundo plano. Evita repetição (10 min por chave) e limita a 20 e-mails/hora."""
    if not ativo():
        log.warning("E-mail ao administrador não configurado. %s | %s", assunto, " | ".join(linhas))
        return False
    now = time.time()
    with _lock:
        if now - _recent.get(chave, 0) < 600:
            return True
        _sent[:] = [t for t in _sent if now - t < 3600]
        if len(_sent) >= 20:
            return False
        _recent[chave] = now
        _sent.append(now)
    threading.Thread(target=_enviar, args=(assunto, "\n".join(linhas)), daemon=True).start()
    return True


def _enviar(assunto: str, corpo: str) -> None:
    try:
        m = EmailMessage()
        m["Subject"] = f"[Localiza Aluno] {assunto}"
        m["From"] = USER
        m["To"] = ADMIN
        m.set_content(corpo)
        if SEC == "ssl":
            srv = smtplib.SMTP_SSL(HOST, PORT, timeout=20)
        else:
            srv = smtplib.SMTP(HOST, PORT, timeout=20)
            if SEC == "starttls":
                srv.starttls()
        with srv:
            if SEC != "none":
                srv.login(USER, PASS)
            srv.send_message(m)
    except Exception:
        log.exception("Falha ao enviar e-mail ao administrador")

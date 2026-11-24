# Localiza Aluno

Cruza os **alunos não localizados** do Sistema Presença (PBF) com as **matrículas ativas** do Gestor Escolar e mostra em qual escola/turma cada um está.

## Publicar (Ubuntu + Docker/Portainer)
**Por linha de comando**
```bash
unzip localiza-aluno.zip && cd localiza-aluno
docker compose up -d --build        # abre em http://SERVIDOR:8090 (porta definida por APP_PORT no .env)
```
**Pelo Portainer**: envie esta pasta para um repositório Git e use *Stacks → Add stack → Repository* (compose path `docker-compose.yml`); ou, no servidor, rode `docker build -t localiza-aluno .` e crie a stack com `image: localiza-aluno:latest` (sem `build`).

Variáveis (docker-compose.yml): `APP_USER`/`APP_PASSWORD` (senha opcional — recomendada, são dados de crianças), `SESSION_TTL_MIN`, `MAX_UPLOAD_MB`, `TZ_NAME`. Use HTTPS (proxy reverso) se expor na internet.

## Importação e avisos
Cada arquivo é lido assim que escolhido/arrastado: a aba correspondente é liberada e, com os dois arquivos, o cruzamento é feito automaticamente. Erros mostram arquivo, linha do cabeçalho, colunas encontradas/faltando e linhas com problema (ex.: data inválida).
Se `SMTP_USER`, `SMTP_PASSWORD` e (opcional) `ADMIN_EMAIL` estiverem definidos, falhas de importação são enviadas ao administrador (máx. 1 aviso igual a cada 10 min e 20/hora). Para Gmail use **Senha de app**. Nunca coloque a senha no código.

## Regras (ordem de prioridade do código exibido)
NF1 nome+Filiação 1 · NF2 nome+Filiação 2 · ND nome+nascimento · F1D nascimento+Filiação 1 · F2D nascimento+Filiação 2.
O nome do **responsável** do PBF é comparado com a Filiação 1/2 do GE, ignorando acentos, maiúsculas e espaços duplicados. “PAI NÃO DECLARADO” e similares nunca valem como chave.

## Arquivos
Colunas lidas **pelo nome** (ordem livre, colunas extras ignoradas; linhas de título do PBF são puladas). Modelos .csv são baixados na tela inicial.

## Privacidade
Nada é gravado em disco: os dados ficam na memória e são descartados após `SESSION_TTL_MIN` ou em “Nova consulta”.

## Teste
`pip install -r requirements.txt pytest && pytest`

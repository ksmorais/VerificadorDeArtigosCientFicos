# Integração com o backend científico

Este frontend está preparado para consumir o backend do projeto:

- Repositório: `joaocarvv/r.ia-FakeNews`
- Branch: `refactor/pubmed-only-mvp`
- Backend: Flask / Python
- Fontes científicas do MVP: PubMed e PubMed Central (PMC)

## Fluxo integrado

1. O usuário informa um PMID, DOI, link do PubMed, PDF ou imagem.
2. O frontend chama `POST /api/v1/article-analyses`.
3. O frontend acompanha `GET /api/v1/analyses/{id}?view=status`.
4. Quando o backend retorna `AWAITING_CLAIM_SELECTION`, as alegações extraídas são enviadas automaticamente em modo `QUICK`.
5. O frontend acompanha a investigação até `SUCCEEDED`.
6. O resultado é adaptado para a interface como evidência compatível, divergente ou inconclusiva.

O percentual exibido no círculo principal representa a proporção de evidências diretamente compatíveis entre as evidências classificadas como `SUPPORTS` e `CONTRADICTS`. Ele não representa probabilidade de verdade ou qualidade metodológica.

## Desenvolvimento local

Execute o backend na porta 5000:

```bash
python run_acceptance_app.py
```

O Vite encaminha automaticamente `/api/*` para:

```text
http://127.0.0.1:5000
```

Se necessário, altere o alvo do proxy ao iniciar o Vite:

```bash
ARTFACT_API_URL=http://127.0.0.1:5000 npm run dev
```

Depois execute o frontend:

```bash
npm install
npm run dev
```

## Deploy

Em produção, configure a variável do frontend:

```dotenv
VITE_API_BASE_URL=https://seu-backend.exemplo.com
```

Se frontend e backend estiverem em origens diferentes, o backend deverá permitir a origem do frontend via CORS. Uma alternativa é publicar ambos sob o mesmo domínio e encaminhar `/api` para o Flask por proxy reverso.

## Formatos aceitos

- PMID
- DOI
- Link de artigo do PubMed
- PDF
- PNG
- JPEG
- WebP

Arquivos têm limite de 25 MB, conforme o backend.

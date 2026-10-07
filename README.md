# ArtFact — Verificador de Artigos Científicos

Frontend React/Vite integrado ao backend científico do repositório
`joaocarvv/r.ia-FakeNews`, branch `refactor/pubmed-only-mvp`.

## O que foi integrado

O botão **Verificar Agora** deixou de usar resultado mockado e agora:

1. envia PMID, DOI, URL do PubMed ou arquivo PDF/imagem para `POST /api/v1/article-analyses`;
2. acompanha o processamento em `GET /api/v1/analyses/:id`;
3. quando o backend extrai as alegações do artigo, seleciona automaticamente até 10 alegações e inicia a busca científica em modo `QUICK`;
4. aguarda o resultado final;
5. converte a resposta científica do backend para os cards do ArtFact;
6. exibe evidências, alertas, links de apoio e confiança da análise.

O frontend aceita PDF, PNG, JPG e WebP de até 25 MB.

> Importante: o backend atual é **PubMed/PMC only**. Por isso o campo de link aceita PMID, DOI e links PubMed/NCBI.

## 1. Rodar o backend

No macOS, no repositório `r.ia-FakeNews`:

```bash
git switch refactor/pubmed-only-mvp
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Edite o arquivo `.env` e configure pelo menos:

```dotenv
GEMINI_API_KEY=sua_chave_aqui
LLM_MODEL=gemini-flash-lite-latest
```

Para análise de artigos, `GEMINI_API_KEY` é necessária porque o pipeline precisa extrair e estruturar as alegações do artigo.

Inicie:

```bash
python run_acceptance_app.py
```

O backend deve responder em:

```text
http://127.0.0.1:5000
```

Teste de saúde:

```text
http://127.0.0.1:5000/api/v1/health
```

## 2. Rodar o frontend

Em outro Terminal:

```bash
git clone https://github.com/ksmorais/VerificadorDeArtigosCientFicos.git
cd VerificadorDeArtigosCientFicos
git switch integration/fatofake-pubmed
npm install
cp .env.example .env
npm run dev
```

O Vite usa a porta configurada pelo projeto (por padrão 8443) e encaminha chamadas `/api` para `http://127.0.0.1:5000`.

Abra no navegador o endereço exibido pelo Vite.

## Configuração da API

`.env.example`:

```dotenv
VITE_API_PROXY_TARGET=http://127.0.0.1:5000
VITE_API_BASE_URL=
```

Para desenvolvimento local, deixe `VITE_API_BASE_URL` vazio. Assim o navegador fala com o Vite e o Vite encaminha para o Flask, evitando problema de CORS entre as portas 8443 e 5000.

## Fluxo

```text
ArtFact (React/Vite)
       |
       | POST /api/v1/article-analyses
       v
FatoFake Flask API
       |
       | extrai artigo e alegações
       v
AWAITING_CLAIM_SELECTION
       |
       | frontend seleciona até 10 alegações
       v
PubMed / PMC + pipeline de evidências
       |
       v
SUCCEEDED
       |
       v
Cards e links de evidência no ArtFact
```

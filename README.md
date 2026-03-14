# Gestor de Tráfego AI — Backend

API backend para o painel Gestor de Tráfego AI.

## Tecnologias

- **Node.js + Express** — Servidor HTTP
- **SQLite (better-sqlite3)** — Banco de dados local
- **JWT (jsonwebtoken)** — Autenticação
- **bcryptjs** — Hash de senhas

## Setup

```bash
# Instalar dependências
npm install

# Popular banco de dados com dados demo
npm run seed

# Iniciar servidor (porta 3001)
npm start

# Ou em modo dev com auto-reload
npm run dev
```

## Usuário demo

Após rodar `npm run seed`:

- **Email:** admin@gestor.com
- **Senha:** admin123

## Variáveis de Ambiente (.env)

| Variável | Descrição | Padrão |
|---|---|---|
| `PORT` | Porta do servidor | `3001` |
| `JWT_SECRET` | Chave secreta JWT | (obrigatório em produção) |
| `CORS_ORIGIN` | Origem permitida CORS | `*` |

## Endpoints da API

### Auth (público)
- `POST /api/auth/register` — Criar conta
- `POST /api/auth/login` — Login (retorna JWT)
- `GET /api/auth/me` — Dados do usuário (requer token)
- `PUT /api/auth/me` — Atualizar perfil (requer token)

### Conexões
- `GET /api/connections` — Listar conexões
- `POST /api/connections/:platform/connect` — Conectar plataforma
- `POST /api/connections/:platform/disconnect` — Desconectar

### Dashboard
- `GET /api/dashboard` — KPIs, gráficos, insights, funil

### Campanhas
- `GET /api/campaigns` — Listar
- `POST /api/campaigns` — Criar
- `PUT /api/campaigns/:id` — Atualizar
- `DELETE /api/campaigns/:id` — Remover

### Criativos
- `GET /api/creatives` — Listar
- `POST /api/creatives` — Criar

### Públicos
- `GET /api/audiences` — Listar
- `POST /api/audiences` — Criar

### Palavras-chave
- `GET /api/keywords` — Listar
- `POST /api/keywords` — Criar

### Alertas
- `GET /api/alerts` — Listar
- `PUT /api/alerts/:id/read` — Marcar como lido
- `DELETE /api/alerts/:id` — Remover

### Chat
- `GET /api/chat` — Histórico
- `POST /api/chat` — Enviar mensagem (IA responde)
- `DELETE /api/chat` — Limpar histórico

### Relatórios
- `GET /api/reports` — Listar
- `POST /api/reports` — Gerar relatório

## Estrutura

```
gestor-trafego-backend/
├── server.js              # Entry point
├── middleware/auth.js      # JWT middleware
├── db/
│   ├── database.js        # Schema + conexão SQLite
│   └── seed.js            # Dados iniciais
├── routes/
│   ├── auth.js
│   ├── connections.js
│   ├── dashboard.js
│   ├── campaigns.js
│   ├── creatives.js
│   ├── audiences.js
│   ├── keywords.js
│   ├── alerts.js
│   ├── chat.js
│   └── reports.js
├── data/                  # Banco SQLite (gerado automaticamente)
├── .env
└── package.json
```

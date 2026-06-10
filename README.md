# 🚔 LSPD System — Bot Discord v2.0

Bot Discord exclusivo da **Los Santos Police Department (LSPD)**.

Sistema modular e profissional para gerenciamento de tickets, controle de ponto e publicação de editais.

---

## 📋 Módulos Atuais

| Módulo | Descrição |
|--------|-----------|
| 🎫 **Tickets** | Sistema de atendimento privado com a equipe LSPD |
| 🕒 **Bate Ponto** | Controle de ponto de serviço dos policiais |
| 📄 **Edital** | Publicação e confirmação de leitura do edital oficial |

---

## 🚀 Instalação

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar o .env

Copie o arquivo de exemplo e preencha com seus dados:

```bash
cp .env.example .env
```

Edite o arquivo `.env` e preencha todas as variáveis. Veja a seção [Variáveis de Ambiente](#-variáveis-de-ambiente) abaixo.

### 3. Rodar o bot

```bash
npm start
```

O bot registra automaticamente os slash commands ao iniciar.

### 4. (Opcional) Registrar comandos separadamente

```bash
npm run deploy
```

---

## 🔑 Variáveis de Ambiente

### Configurações do Bot

| Variável | Obrigatório | Descrição |
|----------|:-----------:|-----------|
| `DISCORD_TOKEN` | ✅ | Token do bot obtido no [Discord Developer Portal](https://discord.com/developers/applications) |
| `CLIENT_ID` | ✅ | ID da aplicação (Client ID) |
| `GUILD_ID` | ✅ | ID do servidor Discord |

### Canais

| Variável | Descrição |
|----------|-----------|
| `CHANNEL_TICKETS_PANEL` | Canal onde será enviado o painel de tickets |
| `CATEGORY_TICKETS` | Categoria onde os canais de ticket serão criados |
| `CHANNEL_PONTO_PANEL` | Canal onde será enviado o painel de bate ponto |
| `CHANNEL_PONTO_LOGS` | Canal para logs do bate ponto |
| `CHANNEL_EDITAL_PANEL` | Canal onde será enviado o painel do edital |
| `CHANNEL_ADMIN_LOGS` | Canal para logs administrativos gerais |

### Cargos

| Variável | Descrição |
|----------|-----------|
| `ROLE_LSPD` | Cargo base autorizado a usar o bate ponto |
| `ROLE_COMMAND` | Cargo do comando/administração da LSPD |
| `ROLE_SETUP` | Cargo autorizado a usar `/setup` |
| `ROLE_TICKET_STAFF` | Cargo da equipe que gerencia tickets |

> **Como obter IDs:** No Discord, ative o Modo Desenvolvedor em `Configurações > Avançado`. Depois clique com o botão direito em canais, cargos ou categorias e selecione "Copiar ID".

---

## ⚙️ Comandos

### `/setup tickets`
Envia o painel de tickets no canal configurado em `CHANNEL_TICKETS_PANEL`.

### `/setup ponto`
Envia o painel de bate ponto no canal configurado em `CHANNEL_PONTO_PANEL`.

### `/setup edital`
Envia o painel do edital no canal configurado em `CHANNEL_EDITAL_PANEL`.

### `/setup todos`
Envia todos os painéis de uma vez nos respectivos canais.

> **Permissão:** Apenas membros com cargo `ROLE_SETUP` ou `ROLE_COMMAND` podem usar `/setup`.

---

## 🎫 Como Testar Tickets

1. Execute `/setup tickets` para enviar o painel
2. Clique em **🎫 Abrir Ticket** no painel
3. Preencha o motivo e a descrição no modal
4. Um canal privado será criado automaticamente
5. Dentro do ticket, teste os botões:
   - **👤 Assumir** — Marca você como responsável
   - **📄 Resumo** — Mostra informações do ticket
   - **🔒 Fechar Ticket** — Encerra e remove o canal

---

## 🕒 Como Testar Bate Ponto

1. Execute `/setup ponto` para enviar o painel
2. Certifique-se de ter o cargo `ROLE_LSPD` ou `ROLE_COMMAND`
3. Clique em **🟢 Iniciar Ponto** — Registra o início do turno
4. Clique em **🔴 Encerrar Ponto** — Registra o fim e mostra duração
5. Clique em **📊 Ver Meu Ponto** — Consulta status, total do dia e semana

---

## 📄 Como Testar Edital

1. Execute `/setup edital` para enviar o painel
2. Clique em **📄 Ver Edital** — Exibe o conteúdo completo
3. Clique em **✅ Confirmar Leitura** — Registra sua confirmação
4. Clique novamente — Mostra a data da confirmação anterior

---

## ✏️ Como Alterar o Conteúdo do Edital

Edite o arquivo `src/modules/edital/edital.content.js`:

```javascript
module.exports = {
  title: 'Edital Oficial da LSPD',
  introduction: 'Texto de introdução...',
  sections: [
    {
      title: '1. Título da Seção',
      content: 'Conteúdo da seção...'
    },
    // Adicione mais seções aqui
  ],
};
```

> **Limite:** Cada seção pode ter no máximo 1024 caracteres (limite do Discord).

---

## 🎨 Como Alterar Cores e Rodapé

Edite o arquivo `src/config/settings.js`:

```javascript
module.exports = {
  botName: 'LSPD System',
  footer: 'LSPD • Sistema Oficial',
  colors: {
    primary: '#1E3A8A',   // Azul escuro
    success: '#16A34A',   // Verde
    danger: '#DC2626',    // Vermelho
    warning: '#F59E0B',   // Amarelo
    neutral: '#111827',   // Escuro
    info: '#3B82F6',      // Azul claro
  },
};
```

---

## 📁 Estrutura do Projeto

```
BOT LSPD/
├── src/
│   ├── config/           # Configurações centralizadas
│   │   ├── env.js        # Variáveis de ambiente
│   │   ├── settings.js   # Visual (cores, footer, emojis)
│   │   ├── channels.js   # IDs dos canais
│   │   ├── roles.js      # IDs dos cargos
│   │   ├── permissions.js # Permissões por módulo
│   │   └── embeds.js     # Textos dos painéis
│   │
│   ├── commands/          # Slash commands
│   │   └── setup.js      # /setup tickets|ponto|edital|todos
│   │
│   ├── events/            # Eventos do Discord
│   │   ├── ready.js       # Bot online
│   │   └── interactionCreate.js  # Router de interações
│   │
│   ├── handlers/          # Handlers por tipo de interação
│   │   ├── commandHandler.js
│   │   ├── buttonHandler.js
│   │   ├── modalHandler.js
│   │   └── selectMenuHandler.js
│   │
│   ├── modules/           # Módulos do sistema
│   │   ├── tickets/       # 🎫 Sistema de tickets
│   │   ├── ponto/         # 🕒 Bate ponto
│   │   └── edital/        # 📄 Edital
│   │
│   ├── services/          # Serviços compartilhados
│   │   ├── permissionService.js  # Verificação de cargos
│   │   └── logService.js         # Logs em canais
│   │
│   └── utils/             # Utilitários reutilizáveis
│       ├── createEmbed.js     # Builder de embeds padrão
│       ├── createButtons.js   # Builder de botões
│       ├── formatDate.js      # Formatação de datas
│       ├── formatDuration.js  # Formatação de duração
│       ├── logger.js          # Logger do console
│       └── jsonStore.js       # Persistência JSON
│
├── data/                  # Dados persistidos (JSON)
├── index.js               # Entrada principal
├── deploy-commands.js     # Script de registro de commands
├── .env.example           # Template de variáveis
├── .gitignore
├── package.json
└── README.md
```

---

## 📐 Padrão de Custom IDs

Todos os botões e modals seguem o padrão `modulo:acao`:

| Custom ID | Módulo | Ação |
|-----------|--------|------|
| `tickets:open` | Tickets | Abrir ticket (mostra modal) |
| `tickets:open_modal` | Tickets | Modal preenchido |
| `tickets:close` | Tickets | Fechar ticket |
| `tickets:claim` | Tickets | Assumir ticket |
| `tickets:summary` | Tickets | Ver resumo |
| `ponto:start` | Ponto | Iniciar ponto |
| `ponto:end` | Ponto | Encerrar ponto |
| `ponto:status` | Ponto | Ver status |
| `edital:view` | Edital | Ver edital |
| `edital:confirm` | Edital | Confirmar leitura |

---

## 🔮 Próximos Módulos Recomendados

- 📋 **Academia** — Sistema de treinamento e avaliação
- 🏅 **Ranking** — Classificação por horas de serviço
- 📊 **Relatórios** — Exportação de dados em Excel/PDF
- 🔄 **Transferência** — Solicitação de transferência entre batalhões
- 📝 **Ausência** — Registro de afastamentos programados
- 🔍 **Corregedoria** — Investigações internas

---

## 📝 Observações

- O bot usa **persistência em JSON local** (pasta `data/`). Para produção em larga escala, considere migrar para MongoDB ou SQLite.
- Os dados são salvos automaticamente. Não é necessário configurar banco de dados.
- Se um canal de log não estiver configurado, o bot não quebra — apenas ignora o envio do log.
- O bot registra automaticamente os slash commands ao iniciar. Não é necessário rodar `deploy-commands.js` separadamente, exceto para debug.

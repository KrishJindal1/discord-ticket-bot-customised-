# 🎫 Discord Ticket Bot

A customized  ticket system for Discord made for fgcards.



## ✨ Features
- **Multi-server support** with individual configurations
- **Persistent ticket counters** (never resets)
- **Ticket types**: General, Support, Giveaway claims
- **Admin controls**: Close, delete, or manage tickets
- **Server-specific settings** via `.env`
- **Logging channel** for audit trails

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- Discord bot token
- Git

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/KrishJindal1/discord-ticket-bot-customised-.git
   cd discord-ticket-bot-customised-

   nstall dependencies:
##Installation dependencies
 npm install

##Configure Your Bot
cp sample.env .env

# .env Example
DISCORD_TOKEN=your_bot_token_here
SERVER_IDS=server1,server2

# Per-server config (repeat for each server)
server1_PANEL_CHANNEL_ID=123456
server1_CATEGORY_ID=654321
server1_STAFF_ROLE_ID=789012
server1_LOG_CHANNEL_ID=345678

##Runing the Bot
node index.js

🛠️ Commands
Command	Description
Panel Buttons	Create specific ticket types

📝 Ticket Flow
User clicks button in panel

Selects ticket reason

Provides details (via modals)

Staff receives notification

Ticket resolved via buttons

🔧 Customization
Edit these files to customize:

index.js → Main bot logic

src/embeds.js → Ticket messages/design

.env → Server configurations

🤖 Bot Permissions
Required permissions:

View Channels

Send Messages

Manage Channels

Manage Messages

Embed Links

📜 License
MIT License - See LICENSE

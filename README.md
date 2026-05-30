# Mineflayer AFK Bot
 
A powerful, automated Minecraft AFK bot built with [Mineflayer](https://github.com/PrismarineJS/mineflayer). Designed to keep multiple Microsoft accounts connected to a server while acting as a vanilla client. The bot automatically manages playtime via APIs, executes anti-idle mechanisms, and includes Discord integration for remote control and logging.

## Features

- **Multi-Account Support**: Connect multiple Microsoft accounts with staggered connection delays.
- **Auto Reconnect**: Automatically recovers from kicks, server restarts, or authentication timeouts.
- **Anti-Idle Mechanics**: Periodically moves and jumps to prevent being kicked by advanced AFK checks.
- **Playtime Monitoring**: Supports DonutStats & DonutX API to track playtime and automatically reconnect if playtime stops increasing.
- **Scheduled AFK Commands**: Periodically runs a command (e.g., `/afk`) to maintain status.
- **Discord Integration**: Log events directly to a Discord channel and control the bot remotely.

## Prerequisites

- **Node.js** (v18.0.0 or newer recommended)
- **npm** (comes with Node.js)
- A Minecraft Server IP
- Microsoft account(s) that own Minecraft Java Edition
- *(Optional)* A Discord Bot Token for remote logging and commands.

## Installation

1. **Clone the repository** (or download the files):
   ```bash
   git clone https://github.com/your-username/mineflayer-afk-bot.git
   cd mineflayer-afk-bot
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

## Setup & Environment Variables

Copy the provided example environment file to `.env`:

```bash
cp .env.example .env
```

Open `.env` in your text editor and configure the variables.

### Key Environment Variables

| Variable | Default / Example | Description |
|---|---|---|
| `ACCOUNT_EMAIL_1`, `_2` | `user@email.com` | Up to 10 Microsoft emails to authenticate and join with. |
| `ANTI_IDLE_ENABLED` | `true` | Prevents the server from freezing playtime by moving occasionally. |
| `ANTI_IDLE_INTERVAL_MS` | `600000` (10m) | How often to execute anti-idle movements. |
| `AFK_COMMAND` | `/afk 41` | The command to run after spawning and on an interval. |
| `PLAYTIME_STALE_RECONNECT_MS`| `600000` (10m) | Time to wait before reconnecting if playtime API stops increasing. |
| `DISCORD_TOKEN` | (Empty) | Your Discord application bot token. |
| `DISCORD_CHANNEL_ID` | (Empty) | Channel ID where the bot will post logs. |

*See `.env.example` for all configurable variables, including strict timeouts and API cookies.*

## Usage

Start the bot using `npm`:
```bash
npm start
```
Or directly with Node:
```bash
node AfkBot.js
```

Upon launching, the bot will authorize each Microsoft account provided in the `.env` file via device code or cache (if previously logged in). Follow the console prompts to link your Microsoft account(s) at `microsoft.com/link`.

## Discord Commands

If you configured Discord integration, you can dispatch commands in the specified channel using your prefix (default is `!`).

*Note: Check `AfkBot.js` `handleDiscordCommand` to verify exactly which commands have been implemented. Typically, these allow you to check status, reconnect accounts, or view playtime.*

## Troubleshooting

- **`TypeError: fetch failed` / `UND_ERR_CONNECT_TIMEOUT`:**
  Typically caused by network issues or Microsoft's authentication servers experiencing a heavy load. Wait a few moments and try starting the bot again.
- **Bot gets kicked for "AFK":**
  Ensure `ANTI_IDLE_ENABLED=true` in your `.env` and try lowering `ANTI_IDLE_INTERVAL_MS` to a smaller value like `300000` (5 minutes).
- **Discord Bot isn't logging:**
  Ensure the bot has permission to view the channel and send messages. Double-check your `DISCORD_TOKEN` and `DISCORD_CHANNEL_ID`.
- **Microsoft Authentication prompts every time:**
  The `.auth-cache` folder is responsible for storing your login tokens. Ensure the script has read/write permissions in its parent directory.

## Contributing

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/NewFeature`).
3. Commit your changes (`git commit -m 'Add some NewFeature'`).
4. Push to the branch (`git push origin feature/NewFeature`).
5. Open a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

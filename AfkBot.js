const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');

loadEnvFile();

let Discord = null;
try {
    Discord = require('discord.js');
} catch (err) {
    Discord = null;
}

// Configuration shared by every Minecraft account.
const botConfig = {
    host: process.env.MC_HOST || 'abcdev.donutsmp.net',
    port: parsePositiveInt(process.env.MC_PORT, 25565),
    auth: 'microsoft',
    version: process.env.MC_VERSION || '1.21.1',
    brand: 'vanilla',
    profilesFolder: path.join(__dirname, '.auth-cache'),
    checkTimeoutInterval: 120000,
    hideErrors: true
};

const ACCOUNT_CONNECT_STAGGER_MS = parsePositiveInt(process.env.ACCOUNT_CONNECT_STAGGER_MS, 10000);
const RECONNECT_DELAY_MS = parsePositiveInt(process.env.RECONNECT_DELAY_MS, 10000);
const ERROR_RECONNECT_DELAY_MS = parsePositiveInt(process.env.ERROR_RECONNECT_DELAY_MS, 30000);
const AUTH_RECONNECT_DELAY_MS = parsePositiveInt(process.env.AUTH_RECONNECT_DELAY_MS, 5 * 60 * 1000);
const PLAYTIME_POLL_INTERVAL_MS = parsePositiveInt(process.env.PLAYTIME_POLL_INTERVAL_MS, 30000);
const PLAYTIME_STALE_RECONNECT_MS = parsePositiveInt(process.env.PLAYTIME_STALE_RECONNECT_MS, 10 * 60 * 1000);
const PLAYTIME_REPORT_INTERVAL_MS = parsePositiveInt(process.env.PLAYTIME_REPORT_INTERVAL_MS, 10 * 60 * 1000);
const ANTI_IDLE_ENABLED = !/^false$/i.test(process.env.ANTI_IDLE_ENABLED || 'true');
const ANTI_IDLE_INTERVAL_MS = parsePositiveInt(process.env.ANTI_IDLE_INTERVAL_MS, 20000);
const ANTI_IDLE_MOVE_MS = parsePositiveInt(process.env.ANTI_IDLE_MOVE_MS, 650);
const ANTI_IDLE_JUMP_EVERY = parsePositiveInt(process.env.ANTI_IDLE_JUMP_EVERY, 3);
const AFK_COMMAND = process.env.AFK_COMMAND || '/afk 41';
const AFK_COMMAND_INTERVAL_MS = parsePositiveInt(process.env.AFK_COMMAND_INTERVAL_MS, 30 * 60 * 1000);
const DISCORD_COMMAND_PREFIX = process.env.DISCORD_COMMAND_PREFIX || '!';
const DONUTSTATS_NEXT_ACTION = process.env.DONUTSTATS_NEXT_ACTION || '70b6cd1f1ed49054eb4e88063e90a023eeb711ea36';
const DONUTSTATS_COOKIE = process.env.DONUTSTATS_COOKIE || '';
const USER_AGENT = process.env.API_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0';
const MAX_REASONABLE_PLAYTIME_MS = parsePositiveInt(process.env.MAX_REASONABLE_PLAYTIME_MS, 10 * 365 * 24 * 60 * 60 * 1000);

const accounts = new Map();
const startedAt = Date.now();
let discordClient = null;
let discordChannel = null;

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadEnvFile(filePath = '.env') {
    if (!fs.existsSync(filePath)) return;

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;

        const key = match[1];
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

function getAccountEmails() {
    const emails = [];
    const accountList = process.env.ACCOUNT_EMAILS || process.env.ACCOUNTS || '';

    emails.push(...accountList.split(/[,;\s]+/));

    for (const [key, value] of Object.entries(process.env)) {
        if (/^ACCOUNT_EMAIL_\d+$/i.test(key)) {
            emails.push(value);
        }
    }

    return [...new Set(emails.map((email) => email.trim()).filter(Boolean))];
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 'unknown';

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];

    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (!parts.length || seconds) parts.push(`${seconds}s`);

    return parts.join(' ');
}

function formatSourceName(source) {
    const names = {
        donutstats: 'DonutStats',
        donutx: 'DonutX'
    };

    return names[source] || source;
}

function formatSourceList(sources) {
    return sources
        .map(formatSourceName)
        .filter(Boolean)
        .join(', ') || 'unknown API';
}

function findAccount(query) {
    if (!query) return null;
    const needle = query.toLowerCase();

    for (const state of accounts.values()) {
        if (state.email.toLowerCase() === needle || (state.username && state.username.toLowerCase() === needle)) {
            return state;
        }
    }

    return null;
}

function getDisplayName(state) {
    return state.username || state.email;
}

async function log(message, options = {}) {
    const line = options.raw ? message : `[${new Date().toLocaleTimeString()}] ${message}`;
    console.log(line);

    if (!discordChannel) return;

    try {
        await discordChannel.send({ content: line.slice(0, 1900) });
    } catch (err) {
        console.warn(`Discord log failed: ${err.message}`);
    }
}

async function sendDiscordLog(content) {
    console.log(content.replace(/\*\*/g, ''));

    if (!discordChannel) return;

    try {
        await discordChannel.send({ content: content.slice(0, 1900) });
    } catch (err) {
        console.warn(`Discord log failed: ${err.message}`);
    }
}

async function logPlaytimeStart(state) {
    const content = `**[${new Date().toLocaleTimeString()}] [${getDisplayName(state)}]** API start playtime: **${formatDuration(state.currentPlaytimeMs)}** from ${formatSourceList(Object.keys(state.apiPlaytimes))}.`;
    await sendDiscordLog(content);
}

async function logPlaytimeReport(state) {
    if (state.reportWindowStartPlaytimeMs === null || state.currentPlaytimeMs === null || !state.reportWindowStartedAt) return;

    const increase = Math.max(0, state.currentPlaytimeMs - state.reportWindowStartPlaytimeMs);
    const elapsed = Date.now() - state.reportWindowStartedAt;
    const content = `**[${new Date().toLocaleTimeString()}] [${getDisplayName(state)}]** Playtime increased in the past 10 minutes: **${formatDuration(increase)}**. Total Time Elapsed: **${formatDuration(elapsed)}**. Current Playtime: **${formatDuration(state.currentPlaytimeMs)}**.`;

    await sendDiscordLog(content);
    state.reportWindowStartedAt = Date.now();
    state.reportWindowStartPlaytimeMs = state.currentPlaytimeMs;
}

function createEmptyState(email, accountIndex) {
    return {
        email,
        accountIndex,
        bot: null,
        username: null,
        connected: false,
        spawned: false,
        reconnecting: false,
        connectionStartedAt: null,
        firstPlaytimeMs: null,
        currentPlaytimeMs: null,
        lastPlaytimeIncreaseAt: null,
        lastPlaytimeCheckAt: null,
        lastApiError: null,
        lastApiSource: null,
        apiPlaytimes: {},
        reportWindowStartedAt: null,
        reportWindowStartPlaytimeMs: null,
        shards: null,
        reconnects: 0,
        timers: {
            reconnect: null,
            antiIdle: null,
            afkCommand: null,
            playtimePoll: null
        },
        antiIdleStep: 0
    };
}

function clearBotTimers(state) {
    clearTimeout(state.timers.reconnect);
    clearInterval(state.timers.antiIdle);
    clearInterval(state.timers.afkCommand);
    clearInterval(state.timers.playtimePoll);

    state.timers.reconnect = null;
    state.timers.antiIdle = null;
    state.timers.afkCommand = null;
    state.timers.playtimePoll = null;
}

function scheduleReconnect(state, reason, delayMs = RECONNECT_DELAY_MS) {
    if (state.reconnecting) return;

    state.reconnecting = true;
    state.reconnects += 1;
    clearBotTimers(state);

    try {
        if (state.bot) {
            state.bot.clearControlStates();
            state.bot.quit();
        }
    } catch (err) {
        // The socket may already be closed; the reconnect timer below is what matters.
    }

    const staggeredDelay = delayMs + state.accountIndex * ACCOUNT_CONNECT_STAGGER_MS;
    log(`[${getDisplayName(state)}] ${reason}. Reconnecting in ${Math.round(staggeredDelay / 1000)}s.`);
    state.timers.reconnect = setTimeout(() => initBot(state.email, state.accountIndex), staggeredDelay);
}

function buildDonutStatsRouterState(username) {
    return encodeURIComponent(JSON.stringify([
        '',
        {
            children: [
                'player',
                {
                    children: [
                        [ 'username', username, 'd', null ],
                        {
                            children: [
                                '__PAGE__',
                                {},
                                null,
                                null,
                                0
                            ]
                        },
                        null,
                        null,
                        16
                    ]
                },
                null,
                null,
                0
            ]
        },
        null,
        null,
        16
    ]));
}

async function fetchText(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), parsePositiveInt(process.env.API_TIMEOUT_MS, 15000));

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        const text = await response.text();

        if (!response.ok && response.status !== 304) {
            throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
        }

        return { text, status: response.status };
    } finally {
        clearTimeout(timeout);
    }
}

function extractNumberByKey(data, keyName) {
    if (data === null || data === undefined) return null;

    if (typeof data === 'string') {
        return extractNumberByKeyFromText(data, keyName);
    }

    if (typeof data !== 'object') return null;

    for (const [key, value] of Object.entries(data)) {
        if (key.toLowerCase() === keyName.toLowerCase()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }

        const nested = extractNumberByKey(value, keyName);
        if (nested !== null) return nested;
    }

    return null;
}

function extractNumberByKeyFromText(text, keyName) {
    const escapedKey = keyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`"${escapedKey}"\\s*:\\s*"?([0-9]+)"?`, 'i'),
        new RegExp(`\\\\"${escapedKey}\\\\"\\s*:\\s*\\\\"?([0-9]+)`, 'i'),
        new RegExp(`"${escapedKey}"\\s*,\\s*"?([0-9]+)"?`, 'i'),
        new RegExp(`\\\\"${escapedKey}\\\\"\\s*,\\s*\\\\"?([0-9]+)`, 'i')
    ];

    for (const pattern of patterns) {
        const match = String(text).match(pattern);
        if (!match) continue;

        const parsed = Number(match[1]);
        if (Number.isFinite(parsed)) return parsed;
    }

    return null;
}

function normalizePlaytimeMs(value) {
    const playtimeMs = Number(value);
    if (!Number.isFinite(playtimeMs) || playtimeMs < 0) return null;

    if (playtimeMs > MAX_REASONABLE_PLAYTIME_MS) {
        return null;
    }

    return playtimeMs;
}

async function fetchDonutXStats(username) {
    const url = `https://www.donutx.xyz/api/donutsmp/stats/${encodeURIComponent(username)}`;
    const { text } = await fetchText(url, {
        headers: {
            accept: '*/*',
            'accept-language': 'en-US,en;q=0.9',
            priority: 'u=1, i',
            referer: 'https://www.donutx.xyz/',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': USER_AGENT
        }
    });

    const data = JSON.parse(text);
    return {
        source: 'donutx',
        playtimeMs: normalizePlaytimeMs(extractNumberByKey(data, 'playtime')),
        shards: extractNumberByKey(data, 'shards')
    };
}

async function fetchDonutStatsPlaytime(username) {
    const url = `https://www.donutstats.net/player/${encodeURIComponent(username)}?ref=player-stats`;
    const headers = {
        accept: 'text/x-component',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'text/plain;charset=UTF-8',
        'next-action': DONUTSTATS_NEXT_ACTION,
        'next-router-state-tree': buildDonutStatsRouterState(username),
        origin: 'https://www.donutstats.net',
        priority: 'u=1, i',
        referer: `https://www.donutstats.net/player/${encodeURIComponent(username)}?ref=player-stats`,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': USER_AGENT
    };

    if (DONUTSTATS_COOKIE) {
        headers.cookie = DONUTSTATS_COOKIE;
    }

    const { text } = await fetchText(url, {
        method: 'POST',
        headers,
        body: JSON.stringify([username, 2, 'playtime'])
    });

    return {
        source: 'donutstats',
        playtimeMs: normalizePlaytimeMs(extractNumberByKey(text, 'playtime')),
        shards: null
    };
}

async function fetchExternalStats(username) {
    const results = await Promise.allSettled([
        fetchDonutStatsPlaytime(username),
        fetchDonutXStats(username)
    ]);

    const stats = {
        playtimeMs: null,
        shards: null,
        sourcePlaytimes: {},
        increased: false,
        sources: [],
        errors: []
    };

    for (const result of results) {
        if (result.status === 'fulfilled') {
            const value = result.value;
            stats.sources.push(value.source);
            if (Number.isFinite(value.playtimeMs)) {
                stats.sourcePlaytimes[value.source] = value.playtimeMs;
                stats.playtimeMs = Math.max(stats.playtimeMs || 0, value.playtimeMs);
            }
            if (Number.isFinite(value.shards)) {
                stats.shards = value.shards;
            }
        } else {
            stats.errors.push(result.reason.message);
        }
    }

    if (!stats.playtimeMs && stats.errors.length === results.length) {
        throw new Error(stats.errors.join(' | '));
    }

    return stats;
}

async function pollPlaytime(state, reason = 'poll') {
    if (!state.username || state.reconnecting) return;

    try {
        const stats = await fetchExternalStats(state.username);
        const now = Date.now();
        const previous = state.currentPlaytimeMs;
        const increasedSources = [];

        state.lastPlaytimeCheckAt = now;
        state.lastApiError = stats.errors.length ? stats.errors.join(' | ') : null;
        state.lastApiSource = stats.sources.join(', ') || null;

        if (Number.isFinite(stats.shards)) {
            state.shards = stats.shards;
        }

        if (Number.isFinite(stats.playtimeMs)) {
            for (const [source, playtimeMs] of Object.entries(stats.sourcePlaytimes)) {
                const previousSourcePlaytime = state.apiPlaytimes[source];
                if (Number.isFinite(previousSourcePlaytime) && playtimeMs > previousSourcePlaytime) {
                    increasedSources.push(`${source} +${formatDuration(playtimeMs - previousSourcePlaytime)}`);
                }
                state.apiPlaytimes[source] = playtimeMs;
            }

            const isFirstPlaytime = state.firstPlaytimeMs === null;
            state.currentPlaytimeMs = stats.playtimeMs;

            if (isFirstPlaytime) {
                state.firstPlaytimeMs = stats.playtimeMs;
                state.lastPlaytimeIncreaseAt = now;
                state.reportWindowStartedAt = now;
                state.reportWindowStartPlaytimeMs = stats.playtimeMs;
                await logPlaytimeStart(state);
            }

            if (previous !== null && (stats.playtimeMs > previous || increasedSources.length)) {
                state.lastPlaytimeIncreaseAt = now;
            }

            if (state.reportWindowStartedAt && now - state.reportWindowStartedAt >= PLAYTIME_REPORT_INTERVAL_MS) {
                await logPlaytimeReport(state);
            }
        }

        const lastIncrease = state.lastPlaytimeIncreaseAt || now;
        const staleFor = now - lastIncrease;
        if (state.spawned && staleFor >= PLAYTIME_STALE_RECONNECT_MS) {
            scheduleReconnect(state, `No API playtime increase for ${formatDuration(staleFor)}`, RECONNECT_DELAY_MS);
        }
    } catch (err) {
        state.lastApiError = err.message;
        if (reason !== 'quiet') {
            await log(`[${getDisplayName(state)}] API check failed: ${err.message}`);
        }
    }
}

async function doAntiIdleAction(state) {
    const bot = state.bot;
    if (!state.spawned || state.reconnecting || !bot || !bot.entity) return;

    state.antiIdleStep += 1;

    try {
        const yaw = bot.entity.yaw + (Math.random() - 0.5) * 1.4;
        const pitch = Math.max(-0.6, Math.min(0.6, bot.entity.pitch + (Math.random() - 0.5) * 0.4));
        await bot.look(yaw, pitch, true);

        bot.swingArm('right');

        if (state.antiIdleStep % ANTI_IDLE_JUMP_EVERY === 0) {
            bot.setControlState('jump', true);
            await wait(250);
            bot.setControlState('jump', false);
        }

        const movement = state.antiIdleStep % 2 === 0 ? 'forward' : 'back';
        bot.setControlState(movement, true);
        await wait(ANTI_IDLE_MOVE_MS);
        bot.setControlState(movement, false);

        if (state.antiIdleStep % 4 === 0) {
            bot.setControlState('sneak', true);
            await wait(300);
            bot.setControlState('sneak', false);
        }
    } catch (err) {
        await log(`[${getDisplayName(state)}] Anti-idle action skipped: ${err.message}`);
        bot.clearControlStates();
    }
}

function runAfkCommand(state) {
    if (!state.spawned || state.reconnecting || !state.bot || !AFK_COMMAND) return;

    state.bot.chat(AFK_COMMAND);
    log(`[${getDisplayName(state)}] Ran command: ${AFK_COMMAND}`);
}

function initBot(email, accountIndex) {
    let state = accounts.get(email);
    if (!state) {
        state = createEmptyState(email, accountIndex);
        accounts.set(email, state);
    }

    clearBotTimers(state);
    state.reconnecting = false;
    state.connected = false;
    state.spawned = false;
    state.connectionStartedAt = Date.now();
    state.antiIdleStep = 0;

    log(`[${email}] Connecting to server...`);

    const bot = mineflayer.createBot({
        ...botConfig,
        username: email
    });
    state.bot = bot;

    bot.on('login', () => {
        state.connected = true;
        state.username = bot.username;
        log(`[${getDisplayName(state)}] Logged in as ${bot.username}.`);
        pollPlaytime(state);
    });

    bot.on('spawn', () => {
        state.spawned = true;
        log(`[${getDisplayName(state)}] Spawned and AFKing.`);

        if (ANTI_IDLE_ENABLED && !state.timers.antiIdle) {
            doAntiIdleAction(state);
            state.timers.antiIdle = setInterval(() => doAntiIdleAction(state), ANTI_IDLE_INTERVAL_MS);
        }

        if (!state.timers.afkCommand) {
            runAfkCommand(state);
            state.timers.afkCommand = setInterval(() => runAfkCommand(state), AFK_COMMAND_INTERVAL_MS);
        }

        if (!state.timers.playtimePoll) {
            pollPlaytime(state);
            state.timers.playtimePoll = setInterval(() => pollPlaytime(state, 'quiet'), PLAYTIME_POLL_INTERVAL_MS);
        }
    });

    bot.on('kicked', (reason) => {
        log(`[${getDisplayName(state)}] Kicked from server: ${reason}`);
    });

    bot.on('end', (reason) => {
        state.connected = false;
        state.spawned = false;

        try {
            bot.clearControlStates();
        } catch (err) {
            // Already closed.
        }

        scheduleReconnect(state, `Disconnected: ${reason}`, RECONNECT_DELAY_MS);
    });

    bot.on('error', (err) => {
        const message = err && err.message ? err.message : String(err);
        const isAuthError = /profile data|own minecraft|authenticate|microsoft/i.test(message);
        const reconnectDelay = isAuthError ? AUTH_RECONNECT_DELAY_MS : ERROR_RECONNECT_DELAY_MS;

        state.lastApiError = message;
        log(`[${getDisplayName(state)}] Connection issue: ${message}`);

        if (!state.spawned) {
            scheduleReconnect(state, 'Waiting after connection issue', reconnectDelay);
        }
    });
}

function summarizeAccount(state) {
    const increase = state.firstPlaytimeMs !== null && state.currentPlaytimeMs !== null
        ? state.currentPlaytimeMs - state.firstPlaytimeMs
        : null;

    return [
        `${getDisplayName(state)} (${state.email})`,
        `status: ${state.spawned ? 'spawned' : state.connected ? 'connected' : 'offline'}`,
        `session: ${formatDuration(Date.now() - (state.connectionStartedAt || startedAt))}`,
        `playtime: ${state.currentPlaytimeMs !== null ? formatDuration(state.currentPlaytimeMs) : 'unknown'}`,
        `gained: ${increase !== null ? formatDuration(increase) : 'unknown'}`,
        `shards: ${state.shards !== null ? state.shards : 'unknown'}`,
        `last increase: ${state.lastPlaytimeIncreaseAt ? `${formatDuration(Date.now() - state.lastPlaytimeIncreaseAt)} ago` : 'unknown'}`
    ].join(' | ');
}

function splitMessage(text) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > 1900) {
        chunks.push(remaining.slice(0, 1900));
        remaining = remaining.slice(1900);
    }

    if (remaining) chunks.push(remaining);
    return chunks;
}

async function reply(message, text) {
    for (const chunk of splitMessage(text)) {
        await message.reply(chunk);
    }
}

function createEmbed(title, description) {
    if (!Discord || !Discord.EmbedBuilder) return null;

    return new Discord.EmbedBuilder()
        .setColor(0xffc857)
        .setTitle(title)
        .setDescription(description || null)
        .setTimestamp(new Date());
}

async function replyEmbed(message, title, description, fields = []) {
    const embed = createEmbed(title, description);
    if (!embed) {
        const fieldText = fields.map((field) => `${field.name}: ${field.value}`).join('\n');
        await reply(message, [title, description, fieldText].filter(Boolean).join('\n'));
        return;
    }

    if (fields.length) {
        embed.addFields(fields.map((field) => ({
            name: field.name,
            value: String(field.value || 'unknown').slice(0, 1024),
            inline: Boolean(field.inline)
        })));
    }

    await message.reply({ embeds: [embed] });
}

function getAccountEmbedField(state) {
    const increase = state.firstPlaytimeMs !== null && state.currentPlaytimeMs !== null
        ? state.currentPlaytimeMs - state.firstPlaytimeMs
        : null;

    return {
        name: getDisplayName(state),
        value: [
            `Email: \`${state.email}\``,
            `Status: **${state.spawned ? 'Spawned' : state.connected ? 'Connected' : 'Offline'}**`,
            `Session: **${formatDuration(Date.now() - (state.connectionStartedAt || startedAt))}**`,
            `Playtime: **${state.currentPlaytimeMs !== null ? formatDuration(state.currentPlaytimeMs) : 'unknown'}**`,
            `Gained: **${increase !== null ? formatDuration(increase) : 'unknown'}**`,
            `Shards: **${state.shards !== null ? state.shards : 'unknown'}**`,
            `Last API increase: **${state.lastPlaytimeIncreaseAt ? `${formatDuration(Date.now() - state.lastPlaytimeIncreaseAt)} ago` : 'unknown'}**`
        ].join('\n'),
        inline: false
    };
}

async function handleDiscordCommand(message) {
    if (message.author.bot || !message.content.startsWith(DISCORD_COMMAND_PREFIX)) return;

    const input = message.content.slice(DISCORD_COMMAND_PREFIX.length).trim();
    const [commandRaw, ...args] = input.split(/\s+/);
    const command = (commandRaw || '').toLowerCase();

    if (!command || command === 'help') {
        await replyEmbed(message, 'AFK Controller Commands', 'Use these commands to monitor accounts and control in-game bots.', [
            {
                name: `${DISCORD_COMMAND_PREFIX}status`,
                value: 'Shows controller runtime, account status, playtime gained, shards, and reconnect health.'
            },
            {
                name: `${DISCORD_COMMAND_PREFIX}accounts`,
                value: 'Lists every managed account and its current Minecraft username.'
            },
            {
                name: `${DISCORD_COMMAND_PREFIX}playtime [account|all]`,
                value: 'Refreshes API stats and shows current playtime plus session gain.'
            },
            {
                name: `${DISCORD_COMMAND_PREFIX}shards [account|all]`,
                value: 'Refreshes API stats and shows current shard balance.'
            },
            {
                name: `${DISCORD_COMMAND_PREFIX}cmd <account|all> <command>`,
                value: 'Sends an in-game chat command from selected bot account(s).'
            },
            {
                name: `${DISCORD_COMMAND_PREFIX}reconnect <account|all>`,
                value: 'Schedules a reconnect for selected account(s).'
            }
        ]);
        return;
    }

    if (command === 'status') {
        await replyEmbed(
            message,
            'AFK Controller Status',
            `Controller runtime: **${formatDuration(Date.now() - startedAt)}**`,
            [...accounts.values()].map(getAccountEmbedField)
        );
        return;
    }

    if (command === 'accounts') {
        const fields = [...accounts.values()].map((state) => ({
            name: getDisplayName(state),
            value: [
                `Email: \`${state.email}\``,
                `Status: **${state.spawned ? 'Spawned' : state.connected ? 'Connected' : 'Offline'}**`
            ].join('\n'),
            inline: true
        }));

        await replyEmbed(message, 'Managed Accounts', fields.length ? 'Accounts currently registered in this controller.' : 'No accounts are running.', fields);
        return;
    }

    if (command === 'playtime' || command === 'shards') {
        const target = args[0] || 'all';
        const selected = target.toLowerCase() === 'all'
            ? [...accounts.values()]
            : [findAccount(target)].filter(Boolean);

        if (!selected.length) {
            await reply(message, `No account found for "${target}".`);
            return;
        }

        await Promise.all(selected.map((state) => pollPlaytime(state, 'manual')));
        const fields = selected.map((state) => {
            if (command === 'shards') {
                return {
                    name: getDisplayName(state),
                    value: `Shards: **${state.shards !== null ? state.shards : 'unknown'}**`,
                    inline: true
                };
            }

            return getAccountEmbedField(state);
        });

        await replyEmbed(
            message,
            command === 'playtime' ? 'Playtime Report' : 'Shard Report',
            `Refreshed from available APIs at ${new Date().toLocaleTimeString()}.`,
            fields
        );
        return;
    }

    if (command === 'cmd') {
        const target = args.shift();
        const gameCommand = args.join(' ').trim();

        if (!target || !gameCommand) {
            await reply(message, `Usage: ${DISCORD_COMMAND_PREFIX}cmd <account|all> <command>`);
            return;
        }

        const selected = target.toLowerCase() === 'all'
            ? [...accounts.values()]
            : [findAccount(target)].filter(Boolean);

        if (!selected.length) {
            await reply(message, `No account found for "${target}".`);
            return;
        }

        for (const state of selected) {
            if (!state.bot || !state.spawned) continue;
            state.bot.chat(gameCommand);
            await log(`[Discord] ${message.author.tag} sent to ${getDisplayName(state)}: ${gameCommand}`);
        }

        await replyEmbed(message, 'Command Sent', `Sent \`${gameCommand}\` to **${selected.length}** account(s).`);
        return;
    }

    if (command === 'reconnect') {
        const target = args[0] || 'all';
        const selected = target.toLowerCase() === 'all'
            ? [...accounts.values()]
            : [findAccount(target)].filter(Boolean);

        if (!selected.length) {
            await reply(message, `No account found for "${target}".`);
            return;
        }

        selected.forEach((state) => scheduleReconnect(state, `Manual reconnect requested by ${message.author.tag}`, RECONNECT_DELAY_MS));
        await replyEmbed(message, 'Reconnect Scheduled', `Reconnect scheduled for **${selected.length}** account(s).`);
        return;
    }

    await replyEmbed(message, 'Unknown Command', `Use \`${DISCORD_COMMAND_PREFIX}help\` to see the command list.`);
}

async function initDiscord() {
    if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CHANNEL_ID) {
        console.log('Discord logging disabled. Set DISCORD_TOKEN and DISCORD_CHANNEL_ID in .env to enable it.');
        return;
    }

    if (!Discord) {
        console.warn('Discord logging disabled because discord.js is not installed. Run: npm install');
        return;
    }

    const { Client, GatewayIntentBits } = Discord;
    discordClient = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });

    discordClient.on('ready', async () => {
        discordChannel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID).catch(() => null);
        await log(`Discord bot ready as ${discordClient.user.tag}.`);
    });

    discordClient.on('messageCreate', (message) => {
        handleDiscordCommand(message).catch((err) => {
            console.warn(`Discord command failed: ${err.message}`);
        });
    });

    discordClient.on('error', (err) => {
        console.warn(`Discord client error: ${err.message}`);
    });

    await discordClient.login(process.env.DISCORD_TOKEN);
}

async function startBots() {
    const accountEmails = getAccountEmails();
    if (!accountEmails.length) {
        console.error('No accounts configured. Add emails to ACCOUNT_EMAILS in .env, then run npm start again.');
        process.exit(1);
    }

    await initDiscord();
    await log(`Starting ${accountEmails.length} account(s)...`);
    accountEmails.forEach((email, index) => {
        const state = createEmptyState(email, index);
        accounts.set(email, state);
        setTimeout(() => initBot(email, index), index * ACCOUNT_CONNECT_STAGGER_MS);
    });
}

if (require.main === module) {
    startBots().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

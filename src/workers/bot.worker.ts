import { Client } from 'discord.js-selfbot-v13';
import { parentPort, workerData } from 'worker_threads';
import { smartSplit } from '../utils/textSplitter';

// Interface for Worker Data
interface WorkerPayload {
  mode?: 'RUN' | 'FETCH_GUILDS' | 'FETCH_CHANNELS' | 'FETCH_CONTEXT' | 'PREVIEW';
  token: string;
  channelId?: string;
  threadId?: string; // For PREVIEW
  inviteCode?: string; // For PREVIEW Auto-Join
  guildId?: string; // For FETCH_CHANNELS
  message?: string;
  minDelay?: number;
  maxDelay?: number;
  dynamicDelay?: boolean;
}

const payload = workerData as WorkerPayload;
const mode = payload.mode || 'RUN';

// 1. Initialize Client
const client = new Client({
  checkUpdate: false,
  partials: ['CHANNEL', 'MESSAGE', 'USER', 'GUILD_MEMBER', 'REACTION'],
  makeCache: (manager: any) => {
      const LimitedCollection = require('discord.js-selfbot-v13').LimitedCollection;
      
      // Managers to DISABLE caching for (Memory Hogs)
      if ([
          'GuildMemberManager', 
          'UserManager', 
          'PresenceManager', 
          'MessageManager', 
          'ReactionManager', 
          'GuildBanManager', 
          'GuildInviteManager', 
          'GuildStickerManager', 
          'GuildScheduledEventManager', 
          'StageInstanceManager', 
          'VoiceStateManager',
          'ThreadMemberManager'
      ].includes(manager.name)) {
          return new LimitedCollection({ maxSize: 0 });
      }

      // For Core Managers (Guild, Channel, Role, PermissionOverwrite), 
      // let Discord.js use its default structure to avoid "UnsupportedCacheOverwriteWarning" 
      // and functionality breakage (like the 'isDefault' null error).
      
      // Returning undefined/null tells the library to use the default cache
      return new (require('discord.js-selfbot-v13').Collection)(); 
  },
  presence: { status: 'invisible' }
} as any);

let isRunning = true;

// --- FUNCTIONS ---

async function fetchGuilds() {
    try {
        const guilds = client.guilds.cache.map(g => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL()
        }));
        if (parentPort) parentPort.postMessage({ type: 'data', data: guilds });
        process.exit(0);
    } catch (e: any) {
        error(`Failed to fetch guilds: ${e.message}`);
        process.exit(1);
    }
}

async function fetchChannels() {
    try {
        if (!payload.guildId) throw new Error('Guild ID required');
        const guild = client.guilds.cache.get(payload.guildId);
        if (!guild) throw new Error('Guild not found');
        await guild.channels.fetch(); 
        const channels = guild.channels.cache
            .filter(c => c.isText() && c.type === 'GUILD_TEXT')
            .map(c => ({
                id: c.id,
                name: c.name,
                rateLimitPerUser: (c as any).rateLimitPerUser || 0
            }));
        if (parentPort) parentPort.postMessage({ type: 'data', data: channels });
        process.exit(0);
    } catch (e: any) {
        error(`Failed to fetch channels: ${e.message}`);
        process.exit(1);
    }
}

async function fetchContext() {
    try {
        if (!payload.guildId || !payload.channelId) throw new Error('Guild ID and Channel ID required');
        
        let guild = client.guilds.cache.get(payload.guildId);
        if (!guild) {
            try {
                // Try fetching if not in cache
                guild = await client.guilds.fetch(payload.guildId);
            } catch (e) {
                // Ignore fetch error, will handle guild check below
            }
        }

        if (!guild) throw new Error('Guild not found');
        
        let channel = guild.channels.cache.get(payload.channelId);
        let channelName = 'Unknown Channel';
        
        if (!channel) {
             try {
                 const fetched = await client.channels.fetch(payload.channelId);
                 if (fetched) {
                    channel = fetched as any;
                    channelName = (fetched as any).name;
                 }
             } catch (e) {}
        } else {
            channelName = channel.name;
        }

        if (parentPort) {
            parentPort.postMessage({
                type: 'data',
                data: { guildName: guild.name, channelName: channelName }
            });
        }
        process.exit(0);
    } catch (e: any) {
        error(`Failed to fetch context: ${e.message}`);
        process.exit(1);
    }
}

async function runPreview() {
    try {
        let targetId = payload.threadId || payload.channelId;
        if (!targetId) throw new Error('Target ID required for preview');
        
        let target: any;

        // 1. Try to find the channel/thread in cache or fetch it
        try {
            target = await client.channels.fetch(targetId);
        } catch (e) {
            // Failed to fetch. Maybe not in server?
        }

        // 2. If not found and we have an invite code, try to join
        if (!target && payload.inviteCode) {
            log(`[Preview] Target not found. Attempting to join via invite...`);
            try {
                const invite = await client.fetchInvite(payload.inviteCode);
                
                // Selfbot v13 specific method for accepting invite
                // @ts-ignore
                if (invite.acceptInvite) await invite.acceptInvite();
                // @ts-ignore
                else if (client.acceptInvite) await client.acceptInvite(payload.inviteCode);
                else throw new Error("Method acceptInvite not found on this selfbot version");

                log(`[Preview] Joined server via invite`);
                
                // Wait for cache to populate
                await new Promise(r => setTimeout(r, 3000));
                
                // Try fetching again
                target = await client.channels.fetch(targetId);
            } catch (e: any) {
                error(`[Preview] Failed to join server: ${e.message}`);
                process.exit(1);
            }
        }

        if (!target || !target.isText()) {
            error('[Preview] Could not access the target thread/channel. Is the selfbot in the server?');
            process.exit(1);
        }

        // 3. Send the message (Chunked)
        if (payload.message) {
            const chunks = smartSplit(payload.message);
            for (const chunk of chunks) {
                await target.send(chunk);
                if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
            }
        }

        log('[Preview] Message sent successfully.');
        if (parentPort) parentPort.postMessage({ type: 'data', data: 'success' });
        process.exit(0);

    } catch (e: any) {
        error(`[Preview] Error: ${e.message}`);
        process.exit(1);
    }
}

// --- HELPER FUNCTIONS ---

const MAX_DELAY_MS = 86400000; // 24 jam maximum delay
const MAX_CHANNEL_FETCH_RETRIES = 5; // Maximum retry untuk channel fetch

function getRandomDelay(min: number, max: number): number {
    // Validasi input
    if (min < 0) min = 0;
    if (max < 0) max = 0;
    if (min > max) [min, max] = [max, min]; // Swap jika terbalik
    if (max > MAX_DELAY_MS) max = MAX_DELAY_MS;
    if (min > MAX_DELAY_MS) min = MAX_DELAY_MS;
    
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function log(msg: string) {
  if (parentPort) parentPort.postMessage({ type: 'debug', content: msg });
  else console.log(msg);
}

function error(msg: string) {
  if (parentPort) parentPort.postMessage({ type: 'error', content: msg });
  else console.error(msg);
}

// --- MULTI-TASK LOGIC ---

// Active Tasks Registry
const activeTasks = new Map<string, { 
    timeout: NodeJS.Timeout | null, 
    config: any, 
    channelFetchRetries: number // Track retry count per task
}>();

// Handle Parent Messages
if (parentPort) {
    parentPort.on('message', async (msg) => {
        // Validasi message dari parent
        if (msg === null || msg === undefined) {
            error('[Worker] Received null/undefined message from parent');
            return;
        }

        if (msg === 'STOP') {
            isRunning = false;
            // Clear all tasks
            for (const [id, task] of activeTasks) {
                if (task.timeout) clearTimeout(task.timeout);
            }
            activeTasks.clear();
            client.destroy();
            process.exit(0);
        }
        else if (msg.type === 'START_TASK') {
            const { taskId, config } = msg;

            // Validasi START_TASK payload
            if (!taskId || typeof taskId !== 'string') {
                error('[Worker] Invalid START_TASK: missing taskId');
                return;
            }
            if (!config || typeof config !== 'object') {
                error('[Worker] Invalid START_TASK: missing config');
                return;
            }
            if (!config.channelId || typeof config.channelId !== 'string') {
                error('[Worker] Invalid START_TASK: missing channelId');
                return;
            }

            if (activeTasks.has(taskId)) {
                stopTask(taskId); // Restart if exists
            }
            
            log(`[Worker] Starting Task ${taskId} on #${config.channelId}`);
            
            activeTasks.set(taskId, { timeout: null, config, channelFetchRetries: 0 });
            
            // Start Loop
            processTask(taskId);
        }
        else if (msg.type === 'STOP_TASK') {
            if (!msg.taskId || typeof msg.taskId !== 'string') {
                error('[Worker] Invalid STOP_TASK: missing taskId');
                return;
            }
            stopTask(msg.taskId);
        }
        else {
            // Unknown message type
            error(`[Worker] Unknown message type: ${msg.type || 'undefined'}`);
        }
    });
}

function stopTask(taskId: string) {
    const task = activeTasks.get(taskId);
    if (task) {
        if (task.timeout) clearTimeout(task.timeout);
        activeTasks.delete(taskId);
        log(`[Worker] Stopped Task ${taskId}`);
    }
}

async function processTask(taskId: string) {
    const task = activeTasks.get(taskId);
    if (!task) return;

    const { config } = task;
    let channel: any = client.channels.cache.get(config.channelId);

    // Try fetching if not in cache (First time)
    if (!channel) {
        try {
            channel = await client.channels.fetch(config.channelId);
            // Reset retry counter on success
            task.channelFetchRetries = 0;
        } catch (e) {
            task.channelFetchRetries++;
            
            // Check if max retries exceeded
            if (task.channelFetchRetries >= MAX_CHANNEL_FETCH_RETRIES) {
                error(`[Task ${taskId}] Channel fetch failed after ${MAX_CHANNEL_FETCH_RETRIES} retries. Stopping task.`);
                if (parentPort) {
                    parentPort.postMessage({
                        type: 'log',
                        taskId,
                        status: 'error',
                        content: `Channel ${config.channelId} not accessible after ${MAX_CHANNEL_FETCH_RETRIES} retries`,
                        url: null,
                        nextDelay: 0
                    });
                }
                stopTask(taskId);
                return;
            }
            
            error(`[Task ${taskId}] Channel not found (retry ${task.channelFetchRetries}/${MAX_CHANNEL_FETCH_RETRIES}): ${config.channelId}`);
            task.timeout = setTimeout(() => processTask(taskId), 30000);
            return;
        }
    }

    if (!channel || !channel.isText()) {
        task.channelFetchRetries++;
        
        if (task.channelFetchRetries >= MAX_CHANNEL_FETCH_RETRIES) {
            error(`[Task ${taskId}] Invalid channel after ${MAX_CHANNEL_FETCH_RETRIES} retries. Stopping task.`);
            stopTask(taskId);
            return;
        }
        
        error(`[Task ${taskId}] Invalid Channel (retry ${task.channelFetchRetries}/${MAX_CHANNEL_FETCH_RETRIES}). Retrying in 30s...`);
        task.timeout = setTimeout(() => processTask(taskId), 30000);
        return; 
    }
    
    // Reset retry counter on successful channel access
    task.channelFetchRetries = 0;

    // Metadata Self-Healing
    if (parentPort && (channel.type === 'GUILD_TEXT' || channel.type === 'GUILD_NEWS' || channel.isThread())) {
        try {
           const guildName = (channel as any).guild?.name || 'Unknown Server';
           const channelName = (channel as any).name || 'Unknown Channel';
           parentPort.postMessage({ 
               type: 'metadata',
               taskId, // Include taskId
               data: { guildName, channelName } 
           });
        } catch (e) { }
    }

    try {
        let delay = getRandomDelay(config.minDelay || 60000, config.maxDelay || 120000);
        
        // Dynamic Delay Logic
        if (config.dynamicDelay && channel.rateLimitPerUser) {
            const slowmodeMs = channel.rateLimitPerUser * 1000;
            if (delay < slowmodeMs) {
                const jitter = 2000 + Math.floor(Math.random() * 3000); 
                delay = slowmodeMs + jitter; 
            }
        }

        if (config.message) {
            const chunks = smartSplit(config.message);
            for (const chunk of chunks) {
                const typingDuration = Math.min(chunk.length * 50, 10000); 
                if (channel.sendTyping) {
                    await channel.sendTyping();
                    await new Promise(resolve => setTimeout(resolve, typingDuration));
                }
                
                // Check if still running before sending
                if (!activeTasks.has(taskId)) return;

                const sentMsg = await channel.send(chunk);
                
                if (parentPort && chunk === chunks[chunks.length - 1]) {
                    parentPort.postMessage({
                        type: 'log',
                        taskId, // Include taskId
                        status: 'success',
                        content: `Sent to #${channel.name}`,
                        url: sentMsg.url,
                        nextDelay: delay
                    });
                }
                if (chunks.length > 1) await new Promise(r => setTimeout(r, 1000));
            }
        }
        
        // Schedule Next
        if (activeTasks.has(taskId)) {
            task.timeout = setTimeout(() => processTask(taskId), delay);
        }

    } catch (err: any) {
        if (err.code === 429) {
            const retryAfter = err.retryAfter || 5000;
            error(`[Task ${taskId}] Rate Limit. Waiting ${retryAfter}ms...`);
            if (activeTasks.has(taskId)) {
                task.timeout = setTimeout(() => processTask(taskId), retryAfter + 1000);
            }
            return;
        }
        error(`[Task ${taskId}] Failed to send: ${err.message}`);
        // Retry delay on error
        if (activeTasks.has(taskId)) {
            task.timeout = setTimeout(() => processTask(taskId), 20000); 
        }
    }
}

// MAIN EXECUTION
client.on('ready', async () => {
  log(`[Worker] Logged in as ${client.user?.tag} (Mode: ${mode})`);

  if (mode === 'FETCH_GUILDS') {
      await fetchGuilds();
  } else if (mode === 'FETCH_CHANNELS') {
      await fetchChannels();
  } else if (mode === 'FETCH_CONTEXT') {
      await fetchContext();
  } else if (mode === 'PREVIEW') {
      await runPreview();
  } else if (mode === 'RUN') {
      log('[Worker] Ready for tasks. Waiting for commands...');
      if (parentPort) parentPort.postMessage('READY');
  }
});


client.login(payload.token).catch(err => {
    error(`Login Failed: ${err.message}`);
    // Exit code 2 = Token Invalid (jangan restart)
    // Exit code 1 = Error lain (boleh restart)
    const isInvalidToken = err.message?.toLowerCase().includes('invalid token') ||
                           err.message?.toLowerCase().includes('unauthorized') ||
                           err.code === 'TOKEN_INVALID' ||
                           err.code === 'DISALLOWED_INTENTS';
    process.exit(isInvalidToken ? 2 : 1);
});

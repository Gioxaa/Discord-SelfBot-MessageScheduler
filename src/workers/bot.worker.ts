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

async function messageLoop(channel: any) {
  if (!isRunning) return;
  try {
    let delay = getRandomDelay(payload.minDelay || 60000, payload.maxDelay || 120000);
    if (payload.dynamicDelay && channel.rateLimitPerUser) {
      const slowmodeMs = channel.rateLimitPerUser * 1000;
      if (delay < slowmodeMs) {
        const jitter = 2000 + Math.floor(Math.random() * 3000); 
        delay = slowmodeMs + jitter; 
        log(`[Info] Adjusted delay: ${delay}ms`);
      }
    }

    if (payload.message) {
        const chunks = smartSplit(payload.message);
        for (const chunk of chunks) {
            const typingDuration = Math.min(chunk.length * 50, 10000); 
            if (channel.sendTyping) {
                await channel.sendTyping();
                await new Promise(resolve => setTimeout(resolve, typingDuration));
            }
            const sentMsg = await channel.send(chunk);
            if (parentPort && chunk === chunks[chunks.length - 1]) {
                parentPort.postMessage({
                    type: 'log',
                    status: 'success',
                    content: `Sent to #${channel.name}`,
                    url: sentMsg.url,
                    nextDelay: delay
                });
            }
            if (chunks.length > 1) await new Promise(r => setTimeout(r, 1000));
        }
    }
    setTimeout(() => messageLoop(channel), delay);
  } catch (err: any) {
    if (err.code === 429) {
        const retryAfter = err.retryAfter || 5000;
        error(`[Rate Limit] Hit limit. Waiting ${retryAfter}ms...`);
        setTimeout(() => messageLoop(channel), retryAfter + 1000);
        return;
    }
    error(`Failed to send: ${err.message}`);
    setTimeout(() => messageLoop(channel), 20000); 
  }
}

function getRandomDelay(min: number, max: number) {
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

// Handle Shutdown
if (parentPort) {
    parentPort.on('message', (msg) => {
        if (msg === 'STOP') {
            isRunning = false;
            client.destroy();
            process.exit(0);
        }
    });
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
  } else {
      if (!payload.channelId) {
          error('Channel ID required for RUN mode');
          process.exit(1);
      }
      
      let channel;
      try {
          channel = await client.channels.fetch(payload.channelId);
      } catch (e) {
         // channel undefined
      }

      if (!channel || !channel.isText()) {
        error('Invalid Channel or No Access');
        process.exit(1);
      }

      // Metadata Self-Healing
      if (parentPort && (channel.type === 'GUILD_TEXT' || channel.type === 'GUILD_NEWS' || channel.isThread())) {
        try {
           const guildName = (channel as any).guild?.name || 'Unknown Server';
           const channelName = (channel as any).name || 'Unknown Channel';
           parentPort.postMessage({ 
               type: 'metadata', 
               data: { guildName, channelName } 
           });
        } catch (e) { /* ignore metadata errors */ }
      }

      messageLoop(channel);
  }
});

client.login(payload.token).catch(err => {
    error(`Login Failed: ${err.message}`);
    process.exit(1);
});

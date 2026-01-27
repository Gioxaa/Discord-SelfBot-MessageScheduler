import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { config } from './config';
import { startServer } from './api/server';
import { onReady } from './events/ready';
import { onInteractionCreate } from './events/interaction';
import { onMessageCreate } from './events/message';
import { WorkerService } from './services/worker.service';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// Register Events
client.once(Events.ClientReady, onReady);
client.on(Events.InteractionCreate, onInteractionCreate);
client.on(Events.MessageCreate, onMessageCreate);

async function main() {
  try {
    // Start HTTP Server
    startServer(client);

    if (!config.botToken) {
      console.error('[Error] BOT_TOKEN is missing in .env');
      return;
    }

    await client.login(config.botToken);

    // Graceful Shutdown
    const shutdown = async () => {
        console.log('\n[System] Shutting down...');
        await WorkerService.shutdownAll(client);
        client.destroy();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
  } catch (error) {
    console.error('[Fatal Error]', error);
  }
}

main();

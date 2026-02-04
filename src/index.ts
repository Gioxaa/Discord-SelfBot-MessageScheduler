import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { config } from './config';
import { startServer } from './api/server';
import { onReady } from './events/ready';
import { onInteractionCreate } from './events/interaction';
import { onMessageCreate } from './events/message';
import { WorkerService } from './services/worker.service';
import { StatsService } from './services/stats.service';
import { SchedulerService } from './services/scheduler.service';
import { Logger } from './utils/logger';
import prisma from './database/client';
import type { Server } from 'http';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
});

// HTTP Server instance for graceful shutdown
let httpServer: Server | null = null;

// Register Events
client.once(Events.ClientReady, onReady);
client.on(Events.InteractionCreate, onInteractionCreate);
client.on(Events.MessageCreate, onMessageCreate);

async function main() {
    try {
        // Start HTTP Server and store instance
        httpServer = startServer(client);

        if (!config.botToken) {
            Logger.error('BOT_TOKEN is missing in .env', null, 'System');
            return;
        }

        await client.login(config.botToken);

        // Graceful Shutdown Handler
        const shutdown = async (signal: string) => {
            Logger.info(`Received ${signal}. Shutting down gracefully...`, 'System');

            try {
                // 1. Stop Stats Auto-Refresh
                StatsService.stopAutoRefresh();

                // 2. Stop Scheduler Service
                SchedulerService.stop();

                // 3. Stop all workers
                await WorkerService.shutdownAll();

                // 4. Close HTTP Server
                if (httpServer) {
                    await new Promise<void>((resolve, reject) => {
                        httpServer!.close((err) => {
                            if (err) {
                                Logger.error('Error closing HTTP server', err, 'System');
                                reject(err);
                            } else {
                                Logger.info('HTTP server closed.', 'System');
                                resolve();
                            }
                        });
                    });
                }

                // 5. Disconnect Prisma
                await prisma.$disconnect();

                // 6. Destroy Discord client
                client.destroy();

                Logger.info('Shutdown complete.', 'System');
                process.exit(0);
            } catch (error) {
                Logger.error('Error during shutdown', error, 'System');
                process.exit(1);
            }
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

    } catch (error) {
        Logger.error('Fatal Error during startup', error, 'System');
        process.exit(1);
    }
}

main();

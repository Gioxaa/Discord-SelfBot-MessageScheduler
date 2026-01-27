import { Client, Events } from 'discord.js';
import { WorkerService } from '../services/worker.service';

export async function onReady(client: Client) {
    console.log(`[Main Bot] Ready! Logged in as ${client.user?.tag}`);
    await WorkerService.syncTasksOnStartup(client);
}

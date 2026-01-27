import { Client, Events } from 'discord.js';
import { WorkerService } from '../services/worker.service';
import { WorkspaceService } from '../services/workspace.service';
import { StatsService } from '../services/stats.service';
import { SchedulerService } from '../services/scheduler.service';

export async function onReady(client: Client) {
    console.log(`[Main Bot] Ready! Logged in as ${client.user?.tag}`);
    
    // Start Stats Auto-Refresh immediately (Independent)
    StatsService.startAutoRefresh(client);

    // Start Watchdog Scheduler
    SchedulerService.init(client);

    // Run Startup Syncs
    try {
        await WorkerService.syncTasksOnStartup(client);
    } catch (e) {
        console.error('[Main Bot] Failed to sync tasks on startup:', e);
    }

    try {
        await WorkspaceService.syncPanelsOnStartup(client);
    } catch (e) {
        console.error('[Main Bot] Failed to sync panels on startup:', e);
    }
}

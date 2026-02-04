import { Client } from 'discord.js';
import prisma from '../database/client';
import { WorkerService } from './worker.service';
import { WorkspaceService } from './workspace.service';
import { Logger } from '../utils/logger';

export class SchedulerService {
    private static INTERVAL_MS = 60 * 1000; // Check every 1 minute
    private static CHECK_EXPIRY_WINDOW_MS = 60 * 1000 * 10; // Look back 10 minutes
    
    private static intervals: NodeJS.Timeout[] = [];
    private static isRunning = false;

    static init(client: Client) {
        // Prevent multiple init() calls
        if (this.isRunning) {
            Logger.warn('[Scheduler] Service already running. Ignoring duplicate init().', 'SchedulerService');
            return;
        }
        
        Logger.info('[Scheduler] Service started. Watchdog active.', 'SchedulerService');
        this.isRunning = true;
        
        // Initial check on startup
        this.checkExpiredSubscriptions(client);
        
        // Periodic check
        const interval = setInterval(() => {
            this.checkExpiredSubscriptions(client);
            this.syncActiveUserStats(client);
        }, this.INTERVAL_MS);
        
        this.intervals.push(interval);
    }

    static stop() {
        if (!this.isRunning) {
            Logger.warn('[Scheduler] Service not running.', 'SchedulerService');
            return;
        }
        
        Logger.info('[Scheduler] Stopping service...', 'SchedulerService');
        this.isRunning = false;
        
        // Clear all intervals
        for (const interval of this.intervals) {
            clearInterval(interval);
        }
        this.intervals = [];
    }

    // [NEW] Refresh Panel for users with RUNNING tasks (to update Total Sent stats)
    static async syncActiveUserStats(client: Client) {
        try {
            // Find users who have at least one RUNNING task
            const activeUsers = await prisma.user.findMany({
                where: {
                    accounts: {
                        some: {
                            tasks: {
                                some: { status: 'RUNNING' }
                            }
                        }
                    },
                    workspaceChannelId: { not: null }
                },
                select: { id: true }
            });

            if (activeUsers.length > 0) {
                // Logger.debug(`[Scheduler] Syncing stats for ${activeUsers.length} active users...`, 'SchedulerService');
                for (const user of activeUsers) {
                    await WorkspaceService.refreshControlPanel(client, user.id);
                }
            }
        } catch (error) {
            Logger.error('[Scheduler] Failed to sync active user stats', error, 'SchedulerService');
        }
    }

    static async checkExpiredSubscriptions(client: Client) {
        try {
            const now = new Date();

            // 1. Find Running Tasks for Expired Users (The Enforcer)
            // Logic: Task is RUNNING AND User Expiry < Now
            const illegalTasks = await prisma.task.findMany({
                where: {
                    status: 'RUNNING',
                    account: {
                        user: {
                            expiryDate: { lt: now }
                        }
                    }
                },
                include: {
                    account: { include: { user: true } }
                }
            });

            if (illegalTasks.length > 0) {
                Logger.info(`[Scheduler] Found ${illegalTasks.length} tasks from expired users. Stopping...`, 'SchedulerService');
                
                for (const task of illegalTasks) {
                    try {
                        const expiryStr = task.account.user.expiryDate ? new Date(task.account.user.expiryDate).toLocaleString('id-ID') : 'Unknown';
                        Logger.info(`[Scheduler] Stopping Task ${task.id} (User ${task.account.user.username} expired at ${expiryStr})`, 'SchedulerService');
                        await WorkerService.stopTask(client, task.id, 'Subscription Expired');
                        // stopTask automatically refreshes the panel, so we get visual update for free here.
                    } catch (err) {
                        Logger.error(`[Scheduler] Failed to stop task ${task.id}`, err, 'SchedulerService');
                    }
                }
            }

            // 2. Visual Update for Users who just expired (but had no running tasks)
            // We want to catch users who expired in the last interval window to update their panel color.
            // If we check ALL expired users every minute, we might spam Discord API rate limits.
            // So we check users expired between (NOW - INTERVAL - BUFFER) and NOW.
            const checkWindow = new Date(now.getTime() - this.INTERVAL_MS - 10000); // 1m 10s lookback

            const recentlyExpiredUsers = await prisma.user.findMany({
                where: {
                    expiryDate: {
                        lt: now,
                        gt: checkWindow
                    },
                    workspaceChannelId: { not: null } // Only if they have a workspace
                }
            });

            if (recentlyExpiredUsers.length > 0) {
                Logger.info(`[Scheduler] Found ${recentlyExpiredUsers.length} recently expired users. Refreshing panels...`, 'SchedulerService');
                for (const user of recentlyExpiredUsers) {
                    // Check if we already refreshed via stopTask (optimization)
                    const hadRunningTask = illegalTasks.some(t => t.account.userId === user.id);
                    if (!hadRunningTask) {
                        await WorkspaceService.refreshControlPanel(client, user.id);
                    }
                }
            }

        } catch (error) {
            Logger.error('[Scheduler] Error in watchdog loop', error, 'SchedulerService');
        }
    }
}

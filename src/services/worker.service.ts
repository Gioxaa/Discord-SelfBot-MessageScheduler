import { Worker } from 'worker_threads';
import path from 'path';
import prisma from '../database/client';
import { Client, ThreadChannel, EmbedBuilder } from 'discord.js';
import { WorkspaceService } from './workspace.service';

export class WorkerService {
    private static workers = new Map<string, Worker>(); // TaskID -> Worker
    private static restartCounters = new Map<string, { count: number, lastReset: number }>(); // TaskID -> Restart Info
    private static MAX_WORKERS_PER_USER = 5;
    private static MAX_RESTARTS_PER_HOUR = 5;

    // Simple In-Memory Cache with 5-minute TTL
    private static cache = new Map<string, { data: any, expires: number }>();

    static async startTask(client: Client, taskId: string) {
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: { account: true }
        });

        if (!task) throw new Error('Task not found');

        // Only check limit if it's a fresh start (not a restart)
        const isRestarting = this.restartCounters.has(taskId);
        if (!isRestarting) {
            const userRunningTasks = await prisma.task.count({
                where: {
                    account: { userId: task.account.userId },
                    status: 'RUNNING'
                }
            });

            if (userRunningTasks >= this.MAX_WORKERS_PER_USER) {
                throw new Error(`Worker Limit Reached! You can only run ${this.MAX_WORKERS_PER_USER} tasks simultaneously.`);
            }
        }

        const { decrypt } = require('../utils/security');
        const token = decrypt(task.account.token);

        const worker = this.createWorker({
            mode: 'RUN',
            token,
            channelId: task.channelId,
            message: task.message,
            minDelay: task.minDelay,
            maxDelay: task.maxDelay,
            dynamicDelay: task.dynamicDelay
        });

        // Handle Worker Events
        worker.on('message', async (msg) => {
            if (msg.type === 'log') {
                // [FIX] Update Stats in Database
                if (msg.status === 'success') {
                    try {
                        await prisma.task.update({
                            where: { id: taskId },
                            data: { totalSent: { increment: 1 } }
                        });
                        // console.log(`[WorkerService] Incremented stats for ${taskId}`);
                    } catch (e) {
                        // Ignore error (task might be deleted)
                        console.error(`[WorkerService] Failed to update stats for ${taskId}`, e);
                    }
                }

                await this.forwardLog(client, task.account.userId, msg);
                // Reset restart counter if successful message sent (means it's stable)
                this.resetRestartCounterIfStable(taskId);
            } else if (msg.type === 'metadata') {
                // Self-Healing: Update DB with fresh names
                try {
                    await prisma.task.update({
                        where: { id: taskId },
                        data: {
                            guildName: msg.data.guildName,
                            channelName: msg.data.channelName
                        }
                    });
                } catch (e) {
                    console.error(`[WorkerService] Failed to update metadata for ${taskId}`, e);
                }
            } else if (msg.type === 'error') {
                console.error(`[WorkerService] Error ${taskId}:`, msg.content);
            }
        });

        worker.on('error', (err) => {
            console.error(`[WorkerService] Fatal ${taskId}:`, err);
        });

        worker.on('exit', async (code) => {
            this.workers.delete(taskId);

            if (code !== 0) {
                console.error(`[WorkerService] Stopped ${taskId} Code: ${code} - Attempting Auto-Restart...`);
                await this.handleAutoRestart(client, taskId);
            } else {
                // Manual Stop (clean exit)
                this.restartCounters.delete(taskId);
                // Refresh Panel if needed (though usually stopTask handles it)
            }
        });

        this.workers.set(taskId, worker);

        await prisma.task.update({
            where: { id: taskId },
            data: { status: 'RUNNING' }
        });

        // Refresh Panel on Start
        await WorkspaceService.refreshControlPanel(client, task.account.userId);
    }

    private static async handleAutoRestart(client: Client, taskId: string) {
        const now = Date.now();
        const restartInfo = this.restartCounters.get(taskId) || { count: 0, lastReset: now };

        // Reset counter if it's been more than an hour since last reset
        if (now - restartInfo.lastReset > 3600000) {
            restartInfo.count = 0;
            restartInfo.lastReset = now;
        }

        if (restartInfo.count >= this.MAX_RESTARTS_PER_HOUR) {
            console.error(`[WorkerService] Task ${taskId} exceeded max restarts (${this.MAX_RESTARTS_PER_HOUR}/hr). Stopping permanently.`);
            this.restartCounters.delete(taskId);
            await prisma.task.update({
                where: { id: taskId },
                data: { status: 'STOPPED' }
            });

            // Refresh Panel on Crash Stop
            const task = await prisma.task.findUnique({ where: { id: taskId }, include: { account: true } });
            if (task) {
                await WorkspaceService.refreshControlPanel(client, task.account.userId);
            }
            return;
        }

        restartInfo.count++;
        this.restartCounters.set(taskId, restartInfo);

        console.log(`[WorkerService] Scheduling restart for ${taskId} in 10s (Attempt ${restartInfo.count}/${this.MAX_RESTARTS_PER_HOUR})`);

        setTimeout(async () => {
            try {
                // Double check if user didn't manually stop it in the meantime (check DB status)
                const currentTask = await prisma.task.findUnique({ where: { id: taskId } });
                if (currentTask && currentTask.status === 'RUNNING') {
                    await this.startTask(client, taskId);
                } else {
                    console.log(`[WorkerService] Task ${taskId} was manually stopped during backoff. Cancelled restart.`);
                }
            } catch (e) {
                console.error(`[WorkerService] Failed to auto-restart ${taskId}`, e);
            }
        }, 10000); // 10s delay
    }

    private static resetRestartCounterIfStable(taskId: string) {
        const info = this.restartCounters.get(taskId);
        if (info && info.count > 0) {
            // If we receive a log, it means it's working. We could decrease count or reset.
            // For simplicity, let's not be too aggressive clearing it immediately.
            // Let's rely on the 1-hour time window reset in handleAutoRestart mostly.
        }
    }

    // --- Fetch Methods ---

    static async fetchGuilds(token: string): Promise<any[]> {
        const cacheKey = `guilds_${token.substring(0, 10)}`; // Partial token as key
        if (this.checkCache(cacheKey)) {
            return this.getCache(cacheKey);
        }

        const data = await this.runEphemeralWorker({ mode: 'FETCH_GUILDS', token });
        this.setCache(cacheKey, data);
        return data;
    }

    static async fetchChannels(token: string, guildId: string): Promise<any[]> {
        const cacheKey = `channels_${guildId}`;
        if (this.checkCache(cacheKey)) {
            return this.getCache(cacheKey);
        }

        const data = await this.runEphemeralWorker({ mode: 'FETCH_CHANNELS', token, guildId });
        this.setCache(cacheKey, data);
        return data;
    }

    static async fetchContext(token: string, guildId: string, channelId: string): Promise<{ guildName: string, channelName: string }> {
        // Context is usually fast and specific, maybe skip cache or short TTL.
        // But let's cache it too for consistency if needed.
        // Actually fetchContext is used for task creation, better be fresh.
        return this.runEphemeralWorker({ mode: 'FETCH_CONTEXT', token, guildId, channelId });
    }

    // --- Cache Helpers ---
    private static checkCache(key: string): boolean {
        if (!this.cache.has(key)) return false;
        const item = this.cache.get(key);
        if (!item) return false;
        if (Date.now() > item.expires) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }

    private static getCache(key: string): any {
        return this.cache.get(key)?.data;
    }

    private static setCache(key: string, data: any) {
        this.cache.set(key, {
            data,
            expires: Date.now() + (5 * 60 * 1000) // 5 Minutes
        });
    }

    static async sendPreview(token: string, threadId: string, inviteCode: string, message: string): Promise<void> {
        return this.runEphemeralWorker({
            mode: 'PREVIEW',
            token,
            threadId,
            inviteCode,
            message
        });
    }

    private static createWorker(workerData: any): Worker {
        const isTsNode = (process as any)[Symbol.for('ts-node.register.instance')] || __filename.endsWith('.ts');
        
        // Point to src/workers/bot.worker.ts or dist/workers/bot.worker.js
        const workerFileName = 'bot.worker'; 
        const finalPath = isTsNode 
            ? path.resolve(__dirname, `../workers/${workerFileName}.ts`)
            : path.resolve(__dirname, `../workers/${workerFileName}.js`);

        const workerConf: any = { 
            workerData,
            resourceLimits: { maxOldGenerationSizeMb: 2048 } // Limit to 2GB to prevent Heap OOM
        };
        if (isTsNode) workerConf.execArgv = ["-r", "ts-node/register"];

        return new Worker(finalPath, workerConf);
    }

    private static runEphemeralWorker(workerData: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const worker = this.createWorker(workerData);
            let data: any = null;

            worker.on('message', (msg) => {
                if (msg.type === 'data') {
                    data = msg.data;
                } else if (msg.type === 'error') {
                    reject(new Error(msg.content));
                }
            });

            worker.on('error', (err) => reject(err));

            worker.on('exit', (code) => {
                if (code === 0 && data) {
                    resolve(data);
                } else if (code !== 0) {
                    reject(new Error(`Worker exited with code ${code}`));
                } else {
                    reject(new Error('Worker exited without returning data'));
                }
            });
        });
    }

    static async syncTasksOnStartup(client: Client) {
        console.log('[WorkerService] Syncing tasks...');
        const runningTasks = await prisma.task.findMany({
            where: { status: 'RUNNING' }
        });

        console.log(`[WorkerService] Found ${runningTasks.length} tasks marked as RUNNING.`);
        console.log('[WorkerService] Starting tasks with queue delay (2s interval)...');

        let i = 0;
        for (const task of runningTasks) {
            i++;
            try {
                console.log(`[WorkerService] (${i}/${runningTasks.length}) Restarting task ${task.id}...`);
                await this.startTask(client, task.id);

                // Queue Delay to prevent CPU spike
                if (i < runningTasks.length) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            } catch (error) {
                console.error(`[WorkerService] Failed to restart task ${task.id}:`, error);
                await prisma.task.update({
                    where: { id: task.id },
                    data: { status: 'STOPPED' }
                });
            }
        }
        console.log('[WorkerService] Startup Sync Completed.');
    }

    static async stopTask(client: Client, taskId: string) {
        // Explicit stop requested by user -> Clear auto-restart counters
        this.restartCounters.delete(taskId);

        const worker = this.workers.get(taskId);
        if (worker) {
            worker.postMessage('STOP');
            // Wait a bit for graceful shutdown inside worker, then terminate
            // But for now, just terminate is fine as 'STOP' message in bot.worker.ts does exit(0)
            // We can rely on exit(0) to clean up
            // But to be sure:
            setTimeout(async () => {
                if (this.workers.has(taskId)) {
                    await worker.terminate();
                    this.workers.delete(taskId);
                }
            }, 1000);
        }

        const task = await prisma.task.update({
            where: { id: taskId },
            data: { status: 'STOPPED' },
            include: { account: true }
        });

        // Refresh Panel on Stop
        if (task) {
            await WorkspaceService.refreshControlPanel(client, task.account.userId);
        }
    }

    static async shutdownAll(client?: Client) {
        console.log('[WorkerService] Shutting down all workers...');
        for (const [taskId, worker] of this.workers) {
            worker.postMessage('STOP');
            await worker.terminate();

            await prisma.task.update({
                where: { id: taskId },
                data: { status: 'STOPPED' }
            });
        }
        this.workers.clear();
        this.restartCounters.clear();

        // Note: We don't refresh control panels here because server is shutting down anyway.
        // If we wanted to, we'd need to loop through all unique users.
    }

    static async forwardLog(client: Client, userId: string, logData: any) {
        try {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user || !user.logThreadId) return;

            const thread = await client.channels.fetch(user.logThreadId) as ThreadChannel;
            if (thread) {
                const isSuccess = logData.status === 'success';

                const embed = new EmbedBuilder()
                    .setDescription(`
## ${isSuccess ? '<a:GREEN_CROWN:1306056562435035190> **LOG NOTIFICATION** <a:GREEN_CROWN:1306056562435035190>' : '❌ **ERROR LOG**'}
\u200b
<a:arrow:1306059259615903826> **Status** : ${isSuccess ? 'Success <a:Tick_green:1306061558303952937>' : 'Failed <a:alert:1306298772124336178>'}
<a:arrow:1306059259615903826> **Info**   : \`${logData.content}\`
${logData.url ? `<a:arrow:1306059259615903826> **Link**   : [Jump to Message](${logData.url})` : ''}
<a:arrow:1306059259615903826> **Next**   : \`${(logData.nextDelay / 1000).toFixed(1)}s\`
`)
                    .setColor(isSuccess ? 0x57F287 : 0xED4245)
                    .setTimestamp()
                    .setFooter({ text: 'AutoPost Log System' });

                await thread.send({ embeds: [embed] });
            }
        } catch (e) {
            console.error('Failed to forward log', e);
        }
    }
}

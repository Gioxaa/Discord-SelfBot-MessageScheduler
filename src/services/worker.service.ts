import { Worker } from 'worker_threads';
import path from 'path';
import prisma from '../database/client';
import { Client, ThreadChannel, EmbedBuilder } from 'discord.js';
import { WorkspaceService } from './workspace.service';

export class WorkerService {
    private static workers = new Map<string, Worker>(); // AccountID -> Worker
    private static activeAccountTasks = new Map<string, Set<string>>(); // AccountID -> Set<TaskID>
    private static pendingLogins = new Map<string, Promise<Worker>>(); // AccountID -> Login Promise
    private static idleTimers = new Map<string, NodeJS.Timeout>(); // AccountID -> Timeout

    private static restartCounters = new Map<string, { count: number, lastReset: number }>(); // AccountID -> Restart Info
    private static MAX_WORKERS_PER_USER = 5;
    private static MAX_RESTARTS_PER_HOUR = 5;
    private static IDLE_TIMEOUT_MS = 0 * 60 * 1000; // 5 Minutes Keep-Alive

    // Simple In-Memory Cache
    private static cache = new Map<string, { data: any, expires: number }>();

    static async startTask(client: Client, taskId: string) {
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: { account: true }
        });

        if (!task) throw new Error('Task not found');
        const accountId = task.account.id;

        // Check Global Limits (Total Active Tasks per User)
        const userRunningTasks = await prisma.task.count({
            where: {
                account: { userId: task.account.userId },
                status: 'RUNNING'
            }
        });

        if (task.status !== 'RUNNING' && userRunningTasks >= this.MAX_WORKERS_PER_USER) {
            throw new Error(`Limit Reached! You can only run ${this.MAX_WORKERS_PER_USER} active tasks.`);
        }

        // [OPTIMIZATION] If worker is in IDLE mode, cancel the kill timer immediately!
        if (this.idleTimers.has(accountId)) {
            console.log(`[WorkerService] Worker for Account ${accountId} was IDLE. Waking up (Warm Start)!`);
            clearTimeout(this.idleTimers.get(accountId)!);
            this.idleTimers.delete(accountId);
        }

        const { decrypt } = require('../utils/security');
        const token = decrypt(task.account.token);

        // Get or Create Worker for Account
        let worker = this.workers.get(accountId);

        if (!worker) {
            // Check if login is pending
            if (this.pendingLogins.has(accountId)) {
                worker = await this.pendingLogins.get(accountId);
            } else {
                // Spawn new worker
                const loginPromise = this.spawnAccountWorker(client, accountId, token, task.account.userId);
                this.pendingLogins.set(accountId, loginPromise);
                try {
                    worker = await loginPromise;
                } finally {
                    this.pendingLogins.delete(accountId);
                }
            }
        }

        if (!worker) throw new Error('Failed to initialize worker');

        // Register Task
        if (!this.activeAccountTasks.has(accountId)) {
            this.activeAccountTasks.set(accountId, new Set());
        }
        this.activeAccountTasks.get(accountId)!.add(taskId);

        // Send START Command
        console.log(`[WorkerService] Worker Ready! Starting Task ${taskId} (Spamming)...`);
        worker.postMessage({
            type: 'START_TASK',
            taskId: taskId,
            config: {
                channelId: task.channelId,
                message: task.message,
                minDelay: task.minDelay,
                maxDelay: task.maxDelay,
                dynamicDelay: task.dynamicDelay
            }
        });

        // Update DB
        await prisma.task.update({
            where: { id: taskId },
            data: { status: 'RUNNING' }
        });

        // Refresh Panel
        await WorkspaceService.refreshControlPanel(client, task.account.userId);
    }

    private static async spawnAccountWorker(client: Client, accountId: string, token: string, userId: string): Promise<Worker> {
        return new Promise((resolve, reject) => {
            const worker = this.createWorker({
                mode: 'RUN',
                token: token
                // No channelId here, generic worker
            });

            const timeout = setTimeout(() => {
                worker.terminate();
                reject(new Error('Worker initialization timed out (No READY signal)'));
            }, 60000); // 60s timeout for login

            // Bind Events
            worker.on('message', async (msg) => {
                if (msg === 'READY') {
                    console.log(`[Worker ${accountId}] ✅ Worker is READY!`);
                    clearTimeout(timeout);
                    this.workers.set(accountId, worker);
                    resolve(worker);
                    return;
                }

                if (msg.type === 'debug') {
                    console.log(`[Worker ${accountId}] 🔧 ${msg.content}`);
                }

                if (msg.type === 'log') {
                    // Update Stats
                    if (msg.status === 'success' && msg.taskId) {
                        try {
                            await prisma.task.update({
                                where: { id: msg.taskId },
                                data: { totalSent: { increment: 1 } }
                            });
                        } catch (e) { }
                    }
                    await this.forwardLog(client, userId, msg);

                } else if (msg.type === 'metadata' && msg.taskId) {
                    try {
                        await prisma.task.update({
                            where: { id: msg.taskId },
                            data: {
                                guildName: msg.data.guildName,
                                channelName: msg.data.channelName
                            }
                        });
                    } catch (e) { }
                } else if (msg.type === 'error') {
                    // console.error(`[Worker ${accountId}] Error:`, msg.content);
                }
            });

            worker.on('error', (err) => {
                console.error(`[Worker ${accountId}] Fatal Error:`, err);
            });

            worker.on('exit', async (code) => {
                this.workers.delete(accountId);
                this.activeAccountTasks.delete(accountId);

                // Clear idle timer if exists
                if (this.idleTimers.has(accountId)) {
                    clearTimeout(this.idleTimers.get(accountId)!);
                    this.idleTimers.delete(accountId);
                }

                if (code !== 0) {
                    console.error(`[Worker ${accountId}] Crashed (Code ${code}). Restarting...`);
                    await this.handleAccountCrash(client, accountId, userId);
                }
            });

        });
    }

    static async stopTask(client: Client, taskId: string) {
        // Find which account owns this task
        const task = await prisma.task.findUnique({ where: { id: taskId }, include: { account: true } });
        if (!task) return;

        const accountId = task.account.id;
        const worker = this.workers.get(accountId);

        // Update DB first
        await prisma.task.update({
            where: { id: taskId },
            data: { status: 'STOPPED' }
        });

        if (worker) {
            worker.postMessage({ type: 'STOP_TASK', taskId });

            // Remove from registry
            const tasks = this.activeAccountTasks.get(accountId);
            if (tasks) {
                tasks.delete(taskId);

                // If no more tasks, perform Safety Check + Idle Logic
                if (tasks.size === 0) {
                    // [SAFETY FIX] Double Check DB before terminating
                    const runningCount = await prisma.task.count({
                        where: { accountId: accountId, status: 'RUNNING' }
                    });

                    if (runningCount > 0) {
                        console.warn(`[WorkerService] Sync Mismatch: Memory says 0 tasks, but DB says ${runningCount} tasks running for Account ${accountId}. Keeping worker alive.`);
                        return;
                    }

                    // [OPTIMIZATION] Idle Keep-Alive
                    console.log(`[WorkerService] Account ${accountId} has no active tasks. Entering IDLE mode (${this.IDLE_TIMEOUT_MS / 60000}m)...`);

                    if (this.idleTimers.has(accountId)) clearTimeout(this.idleTimers.get(accountId)!);

                    const timer = setTimeout(() => {
                        console.log(`[WorkerService] Idle timeout reached for Account ${accountId}. Terminating worker.`);
                        worker.postMessage('STOP');
                        this.workers.delete(accountId);
                        this.activeAccountTasks.delete(accountId);
                        this.idleTimers.delete(accountId);
                    }, this.IDLE_TIMEOUT_MS);

                    this.idleTimers.set(accountId, timer);
                }
            }
        }

        await WorkspaceService.refreshControlPanel(client, task.account.userId);
    }

    private static async handleAccountCrash(client: Client, accountId: string, userId: string) {
        // Check restart limits
        const now = Date.now();
        const restartInfo = this.restartCounters.get(accountId) || { count: 0, lastReset: now };

        if (now - restartInfo.lastReset > 3600000) {
            restartInfo.count = 0;
            restartInfo.lastReset = now;
        }

        if (restartInfo.count >= this.MAX_RESTARTS_PER_HOUR) {
            console.error(`[WorkerService] Account ${accountId} exceeded max restarts. stopping all tasks.`);
            this.restartCounters.delete(accountId);

            // Mark all tasks as STOPPED
            await prisma.task.updateMany({
                where: { accountId: accountId },
                data: { status: 'STOPPED' }
            });
            await WorkspaceService.refreshControlPanel(client, userId);
            return;
        }

        restartInfo.count++;
        this.restartCounters.set(accountId, restartInfo);

        console.log(`[WorkerService] Restarting Account ${accountId} in 10s...`);
        setTimeout(async () => {
            try {
                // Find all tasks that SHOULD be running
                const tasksToResume = await prisma.task.findMany({
                    where: { accountId: accountId, status: 'RUNNING' }
                });

                if (tasksToResume.length === 0) return;

                console.log(`[WorkerService] Resuming ${tasksToResume.length} tasks for Account ${accountId}`);

                for (const task of tasksToResume) {
                    await this.startTask(client, task.id);
                    await new Promise(r => setTimeout(r, 1000));
                }

            } catch (e) {
                console.error(`[WorkerService] Failed to resume account ${accountId}`, e);
            }
        }, 10000);
    }

    // --- Ephemeral Workers (Fetch/Preview) remain separate for safety ---

    static async fetchGuilds(token: string): Promise<any[]> {
        const cacheKey = `guilds_${token.substring(0, 10)}`;
        if (this.checkCache(cacheKey)) return this.getCache(cacheKey);
        const data = await this.runEphemeralWorker({ mode: 'FETCH_GUILDS', token });
        this.setCache(cacheKey, data);
        return data;
    }

    static async fetchChannels(token: string, guildId: string): Promise<any[]> {
        const cacheKey = `channels_${guildId}`;
        if (this.checkCache(cacheKey)) return this.getCache(cacheKey);
        const data = await this.runEphemeralWorker({ mode: 'FETCH_CHANNELS', token, guildId });
        this.setCache(cacheKey, data);
        return data;
    }

    static async fetchContext(token: string, guildId: string, channelId: string): Promise<{ guildName: string, channelName: string }> {
        return this.runEphemeralWorker({ mode: 'FETCH_CONTEXT', token, guildId, channelId });
    }

    static async sendPreview(token: string, threadId: string, inviteCode: string, message: string): Promise<void> {
        return this.runEphemeralWorker({ mode: 'PREVIEW', token, threadId, inviteCode, message });
    }

    // --- Helpers ---

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
        this.cache.set(key, { data, expires: Date.now() + (5 * 60 * 1000) });
    }

    private static createWorker(workerData: any): Worker {
        const isTsNode = (process as any)[Symbol.for('ts-node.register.instance')] || __filename.endsWith('.ts');
        const workerFileName = 'bot.worker';
        const finalPath = isTsNode
            ? path.resolve(__dirname, `../workers/${workerFileName}.ts`)
            : path.resolve(__dirname, `../workers/${workerFileName}.js`);

        const workerConf: any = {
            workerData,
            resourceLimits: { maxOldGenerationSizeMb: 2048 }
        };
        if (isTsNode) workerConf.execArgv = ["-r", "ts-node/register"];

        return new Worker(finalPath, workerConf);
    }

    private static runEphemeralWorker(workerData: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const worker = this.createWorker(workerData);
            let data: any = null;
            worker.on('message', (msg) => {
                if (msg.type === 'data') data = msg.data;
                else if (msg.type === 'error') reject(new Error(msg.content));
            });
            worker.on('error', (err) => reject(err));
            worker.on('exit', (code) => {
                if (code === 0 && data) resolve(data);
                else if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
                else reject(new Error('Worker exited without returning data'));
            });
        });
    }

    static async syncTasksOnStartup(client: Client) {
        console.log('[WorkerService] Syncing tasks...');
        // Reset all states
        this.workers.clear();
        this.activeAccountTasks.clear();
        this.idleTimers.clear(); // Clear timers too

        const runningTasks = await prisma.task.findMany({ where: { status: 'RUNNING' } });
        console.log(`[WorkerService] Found ${runningTasks.length} tasks marked as RUNNING.`);

        let i = 0;
        for (const task of runningTasks) {
            i++;
            try {
                // Use new startTask logic which handles pooling
                console.log(`[WorkerService] Restoring task ${task.id}...`);
                await this.startTask(client, task.id);
                // Smaller delay since we might reuse workers
                await new Promise(r => setTimeout(r, 1000));
            } catch (error) {
                console.error(`[WorkerService] Failed to restart task ${task.id}:`, error);
                await prisma.task.update({ where: { id: task.id }, data: { status: 'STOPPED' } });
            }
        }
        console.log('[WorkerService] Startup Sync Completed.');
    }

    static async shutdownAll(client?: Client) {
        console.log('[WorkerService] Shutting down all workers...');
        for (const [id, worker] of this.workers) {
            worker.postMessage('STOP');
            // Allow grace period then terminate
            setTimeout(() => worker.terminate(), 1000);

            // Mark all tasks stopped
            await prisma.task.updateMany({
                where: { accountId: id, status: 'RUNNING' },
                data: { status: 'STOPPED' }
            });
        }
        this.workers.clear();
        this.activeAccountTasks.clear();
        this.idleTimers.forEach(t => clearTimeout(t));
        this.idleTimers.clear();
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

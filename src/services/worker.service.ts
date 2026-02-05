import { Worker } from 'worker_threads';
import path from 'path';
import prisma from '../database/client';
import { Client, ThreadChannel, EmbedBuilder } from 'discord.js';
import { WorkspaceService } from './workspace.service';
import { Logger } from '../utils/logger';
import { generateSecureHash } from '../utils/security';

export class WorkerService {
    // Core Maps untuk state management
    private static workers = new Map<string, Worker>(); // AccountID -> Worker
    private static activeAccountTasks = new Map<string, Set<string>>(); // AccountID -> Set<TaskID>
    private static pendingLogins = new Map<string, Promise<Worker>>(); // AccountID -> Login Promise
    private static idleTimers = new Map<string, NodeJS.Timeout>(); // AccountID -> Timeout
    private static workerLocks = new Map<string, Promise<void>>(); // AccountID -> Lock Promise
    private static restartCounters = new Map<string, { count: number, lastReset: number }>(); // AccountID -> Restart Info
    private static pendingRestarts = new Map<string, NodeJS.Timeout>(); // AccountID -> Restart Timeout

    // LRU Cache dengan max size
    private static cache = new Map<string, { data: any, expires: number }>();
    private static readonly MAX_CACHE_SIZE = 100;
    private static cacheCleanupInterval: NodeJS.Timeout | null = null;

    // Konstanta
    private static readonly MAX_WORKERS_PER_USER = 5;
    private static readonly MAX_RESTARTS_PER_HOUR = 5;
    private static readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 Minutes Keep-Alive
    private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minutes

    // ==================== PUBLIC API ====================

    /**
     * Memulai task spamming dengan worker thread
     * Menggunakan mutex lock untuk mencegah race condition
     */
    static async startTask(client: Client, taskId: string): Promise<void> {
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

        // Acquire lock untuk mencegah race condition
        await this.acquireLock(accountId);

        try {
            // Jika worker sedang IDLE, batalkan kill timer
            if (this.idleTimers.has(accountId)) {
                Logger.debug(`Worker for Account ${accountId} was IDLE. Waking up (Warm Start)!`, 'WorkerService');
                clearTimeout(this.idleTimers.get(accountId)!);
                this.idleTimers.delete(accountId);
            }

            const { decrypt } = require('../utils/security');
            const token = decrypt(task.account.token);

            // Get or Create Worker for Account
            let worker = this.workers.get(accountId);

            if (!worker) {
                if (this.pendingLogins.has(accountId)) {
                    // Tunggu login yang sedang berjalan
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

            // Update DB FIRST (before starting worker)
            await prisma.task.update({
                where: { id: taskId },
                data: { status: 'RUNNING' }
            });

            // Send START Command
            Logger.info(`Worker Ready! Starting Task ${taskId}`, 'WorkerService');
            try {
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
            } catch (postError) {
                // Rollback DB status if postMessage fails
                await prisma.task.update({
                    where: { id: taskId },
                    data: { status: 'STOPPED' }
                });
                this.activeAccountTasks.get(accountId)?.delete(taskId);
                throw postError;
            }

            // Refresh Panel
            await WorkspaceService.refreshControlPanel(client, task.account.userId);
        } finally {
            this.releaseLock(accountId);
        }
    }

    /**
     * Menghentikan task yang sedang berjalan
     * Menggunakan lock untuk mencegah race condition dengan startTask
     */
    static async stopTask(client: Client, taskId: string, reason?: string): Promise<void> {
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: { account: true }
        });

        if (!task) return;

        const accountId = task.account.id;

        // Acquire lock untuk mencegah race condition dengan startTask
        await this.acquireLock(accountId);

        try {
            const worker = this.workers.get(accountId);

            // Update DB first
            await prisma.task.update({
                where: { id: taskId },
                data: { status: 'STOPPED' }
            });

            // Send notification jika ada reason
            if (reason) {
                await this.forwardLog(client, task.account.userId, {
                    status: 'error',
                    content: `Task Stopped: ${reason}`,
                    url: null,
                    nextDelay: 0
                });
            }

            if (worker) {
                worker.postMessage({ type: 'STOP_TASK', taskId });

                // Remove dari registry
                const tasks = this.activeAccountTasks.get(accountId);
                if (tasks) {
                    tasks.delete(taskId);

                    // Jika tidak ada task lagi, masuk mode IDLE
                    if (tasks.size === 0) {
                        // Safety Check: Double check DB
                        const runningCount = await prisma.task.count({
                            where: { accountId: accountId, status: 'RUNNING' }
                        });

                        if (runningCount > 0) {
                            Logger.warn(`Sync Mismatch: Memory says 0 tasks, but DB says ${runningCount} running for Account ${accountId}`, 'WorkerService');
                            return;
                        }

                        Logger.debug(`Account ${accountId} has no active tasks. Entering IDLE mode...`, 'WorkerService');

                        if (this.idleTimers.has(accountId)) {
                            clearTimeout(this.idleTimers.get(accountId)!);
                        }

                        const timer = setTimeout(() => {
                            Logger.info(`Idle timeout reached for Account ${accountId}. Terminating worker.`, 'WorkerService');
                            this.terminateAccount(accountId);
                        }, this.IDLE_TIMEOUT_MS);

                        this.idleTimers.set(accountId, timer);
                    }
                }
            }

            await WorkspaceService.refreshControlPanel(client, task.account.userId);
        } finally {
            // Always release lock
            this.releaseLock(accountId);
        }
    }

    /**
     * Fetch daftar guild dari Discord user token
     */
    static async fetchGuilds(token: string): Promise<any[]> {
        const cacheKey = `guilds_${generateSecureHash(token)}`;
        if (this.checkCache(cacheKey)) return this.getCache(cacheKey);
        const data = await this.runEphemeralWorker({ mode: 'FETCH_GUILDS', token });
        this.setCache(cacheKey, data);
        return data;
    }

    /**
     * Fetch daftar channel dari guild
     */
    static async fetchChannels(token: string, guildId: string): Promise<any[]> {
        const cacheKey = `channels_${generateSecureHash(token)}_${guildId}`;
        if (this.checkCache(cacheKey)) return this.getCache(cacheKey);
        const data = await this.runEphemeralWorker({ mode: 'FETCH_CHANNELS', token, guildId });
        this.setCache(cacheKey, data);
        return data;
    }

    /**
     * Fetch context (nama guild & channel) untuk display
     */
    static async fetchContext(token: string, guildId: string, channelId: string): Promise<{ guildName: string, channelName: string }> {
        const cacheKey = `context_${generateSecureHash(token)}_${guildId}_${channelId}`;
        if (this.checkCache(cacheKey)) return this.getCache(cacheKey);
        const data = await this.runEphemeralWorker({ mode: 'FETCH_CONTEXT', token, guildId, channelId });
        this.setCache(cacheKey, data);
        return data;
    }

    /**
     * Kirim preview message ke thread
     */
    static async sendPreview(token: string, threadId: string, inviteCode: string, message: string): Promise<void> {
        return this.runEphemeralWorker({ mode: 'PREVIEW', token, threadId, inviteCode, message });
    }

    /**
     * Sync tasks saat startup - resume task yang RUNNING
     */
    static async syncTasksOnStartup(client: Client): Promise<void> {
        Logger.info('Syncing tasks on startup...', 'WorkerService');
        
        // Reset all states
        this.workers.clear();
        this.activeAccountTasks.clear();
        this.idleTimers.forEach(t => clearTimeout(t));
        this.idleTimers.clear();

        // Start cache cleanup interval
        this.startCacheCleanup();

        const runningTasks = await prisma.task.findMany({ where: { status: 'RUNNING' } });
        Logger.info(`Found ${runningTasks.length} tasks marked as RUNNING.`, 'WorkerService');

        for (const task of runningTasks) {
            try {
                Logger.debug(`Restoring task ${task.id}...`, 'WorkerService');
                await this.startTask(client, task.id);
                // Delay untuk mencegah rate limit
                await new Promise(r => setTimeout(r, 1000));
            } catch (error) {
                Logger.error(`Failed to restart task ${task.id}`, error, 'WorkerService');
                await prisma.task.update({ where: { id: task.id }, data: { status: 'STOPPED' } });
            }
        }
        Logger.info('Startup Sync Completed.', 'WorkerService');
    }

    /**
     * Shutdown semua workers (untuk graceful shutdown)
     */
    static async shutdownAll(): Promise<void> {
        Logger.info('Shutting down all workers...', 'WorkerService');
        
        // 1. Stop cache cleanup
        if (this.cacheCleanupInterval) {
            clearInterval(this.cacheCleanupInterval);
            this.cacheCleanupInterval = null;
        }

        // 2. Clear all pending restart timeouts
        for (const [accountId, timeout] of this.pendingRestarts) {
            clearTimeout(timeout);
        }
        this.pendingRestarts.clear();

        // 3. Clear all idle timers
        for (const [accountId, timer] of this.idleTimers) {
            clearTimeout(timer);
        }
        this.idleTimers.clear();

        // 4. Terminate all workers
        for (const [id, worker] of this.workers) {
            worker.postMessage('STOP');
            worker.removeAllListeners(); // Prevent memory leak from lingering listeners
            // Allow grace period then terminate
            setTimeout(() => worker.terminate(), 1000);
            
            // Mark all tasks stopped
            await prisma.task.updateMany({
                where: { accountId: id, status: 'RUNNING' },
                data: { status: 'STOPPED' }
            });
        }
        
        // 5. Clear all Maps
        this.workers.clear();
        this.activeAccountTasks.clear();
        this.cache.clear();
        this.pendingLogins.clear();
        this.restartCounters.clear();
        
        // 6. Release and clear all worker locks
        for (const [accountId, lock] of this.workerLocks) {
            (lock as any).release?.();
        }
        this.workerLocks.clear();

        Logger.info('All workers shutdown complete.', 'WorkerService');
    }

    /**
     * Terminate worker untuk account tertentu
     */
    static async terminateAccount(accountId: string): Promise<void> {
        Logger.debug(`Terminating worker for Account ${accountId}...`, 'WorkerService');
        
        // 1. Clear Idle Timer
        if (this.idleTimers.has(accountId)) {
            clearTimeout(this.idleTimers.get(accountId)!);
            this.idleTimers.delete(accountId);
        }

        // 2. Clear Pending Restart Timeout
        if (this.pendingRestarts.has(accountId)) {
            clearTimeout(this.pendingRestarts.get(accountId)!);
            this.pendingRestarts.delete(accountId);
        }

        // 3. Stop Worker
        const worker = this.workers.get(accountId);
        if (worker) {
            worker.postMessage('STOP');
            worker.removeAllListeners(); // Prevent memory leak from lingering listeners
            setTimeout(() => worker.terminate(), 1000);
            this.workers.delete(accountId);
        }

        // 4. Clear Task Registry
        this.activeAccountTasks.delete(accountId);
        
        // 5. Clear Pending Logins
        this.pendingLogins.delete(accountId);

        // 6. Clear Restart Counters
        this.restartCounters.delete(accountId);

        // 7. Clear Worker Locks
        const lock = this.workerLocks.get(accountId);
        if (lock) {
            (lock as any).release?.();
            this.workerLocks.delete(accountId);
        }
    }

    // ==================== PRIVATE METHODS ====================

    /**
     * Mutex lock untuk mencegah race condition saat startup worker
     */
    private static async acquireLock(accountId: string): Promise<void> {
        while (this.workerLocks.has(accountId)) {
            await this.workerLocks.get(accountId);
        }
        let releaseLock: () => void;
        const lockPromise = new Promise<void>(resolve => {
            releaseLock = resolve;
        });
        (lockPromise as any).release = releaseLock!;
        this.workerLocks.set(accountId, lockPromise);
    }

    /**
     * Release mutex lock
     */
    private static releaseLock(accountId: string): void {
        const lock = this.workerLocks.get(accountId);
        if (lock) {
            (lock as any).release?.();
            this.workerLocks.delete(accountId);
        }
    }

    /**
     * Spawn worker baru untuk account
     */
    private static async spawnAccountWorker(client: Client, accountId: string, token: string, userId: string): Promise<Worker> {
        return new Promise((resolve, reject) => {
            const worker = this.createWorker({
                mode: 'RUN',
                token: token
            });

            const timeout = setTimeout(() => {
                worker.terminate();
                reject(new Error('Worker initialization timed out (No READY signal)'));
            }, 60000); // 60s timeout for login

            // Bind Events
            worker.on('message', async (msg) => {
                if (msg === 'READY') {
                    Logger.info(`Worker for Account ${accountId} is READY!`, 'WorkerService');
                    clearTimeout(timeout);
                    this.workers.set(accountId, worker);
                    resolve(worker);
                    return;
                }

                if (msg.type === 'debug') {
                    Logger.debug(msg.content, `Worker-${accountId}`);
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
                    Logger.error(msg.content, null, `Worker-${accountId}`);
                }
            });

            worker.on('error', (err) => {
                Logger.error(`Fatal Error in worker`, err, `Worker-${accountId}`);
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
                    // Exit code 2 = Token Invalid - Jangan restart, langsung stop
                    if (code === 2) {
                        Logger.error(`Worker exited with invalid token (Code 2). NOT restarting.`, null, `Worker-${accountId}`);
                        
                        // Mark all tasks as STOPPED
                        await prisma.task.updateMany({
                            where: { accountId: accountId },
                            data: { status: 'STOPPED' }
                        });
                        await WorkspaceService.refreshControlPanel(client, userId);
                        return;
                    }
                    
                    // Exit code 1 atau lainnya = Error sementara, boleh restart
                    Logger.warn(`Worker crashed (Code ${code}). Attempting restart...`, `Worker-${accountId}`);
                    await this.handleAccountCrash(client, accountId, userId);
                }
            });

        });
    }

    /**
     * Handle crash dan restart dengan rate limiting
     */
    private static async handleAccountCrash(client: Client, accountId: string, userId: string): Promise<void> {
        const now = Date.now();
        const restartInfo = this.restartCounters.get(accountId) || { count: 0, lastReset: now };

        // Reset counter setiap jam
        if (now - restartInfo.lastReset > 3600000) {
            restartInfo.count = 0;
            restartInfo.lastReset = now;
        }

        if (restartInfo.count >= this.MAX_RESTARTS_PER_HOUR) {
            Logger.error(`Account ${accountId} exceeded max restarts. Stopping all tasks.`, null, 'WorkerService');
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

        Logger.info(`Restarting Account ${accountId} in 10s... (Attempt ${restartInfo.count}/${this.MAX_RESTARTS_PER_HOUR})`, 'WorkerService');
        
        // Clear existing pending restart if any
        if (this.pendingRestarts.has(accountId)) {
            clearTimeout(this.pendingRestarts.get(accountId)!);
            this.pendingRestarts.delete(accountId);
        }

        const restartTimeout = setTimeout(async () => {
            // Remove from pending restarts when timeout fires
            this.pendingRestarts.delete(accountId);
            
            try {
                const tasksToResume = await prisma.task.findMany({
                    where: { accountId: accountId, status: 'RUNNING' }
                });

                if (tasksToResume.length === 0) return;

                Logger.info(`Resuming ${tasksToResume.length} tasks for Account ${accountId}`, 'WorkerService');

                for (const task of tasksToResume) {
                    await this.startTask(client, task.id);
                    await new Promise(r => setTimeout(r, 1000));
                }

            } catch (e) {
                Logger.error(`Failed to resume account ${accountId}`, e, 'WorkerService');
            }
        }, 10000);

        // Track the timeout reference
        this.pendingRestarts.set(accountId, restartTimeout);
    }

    /**
     * Forward log ke thread user
     */
    static async forwardLog(client: Client, userId: string, logData: any): Promise<void> {
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
            Logger.error('Failed to forward log', e, 'WorkerService');
        }
    }

    // ==================== CACHE METHODS (LRU) ====================

    /**
     * Start periodic cache cleanup (setiap 5 menit)
     */
    private static startCacheCleanup(): void {
        if (this.cacheCleanupInterval) return;
        
        this.cacheCleanupInterval = setInterval(() => {
            const now = Date.now();
            let cleaned = 0;
            for (const [key, item] of this.cache) {
                if (now > item.expires) {
                    this.cache.delete(key);
                    cleaned++;
                }
            }
            if (cleaned > 0) {
                Logger.debug(`Cache cleanup: removed ${cleaned} expired entries`, 'WorkerService');
            }
        }, this.CACHE_TTL_MS);
    }

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

    private static setCache(key: string, data: any): void {
        // LRU Eviction jika melebihi max size
        if (this.cache.size >= this.MAX_CACHE_SIZE) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
        }
        this.cache.set(key, { data, expires: Date.now() + this.CACHE_TTL_MS });
    }

    // ==================== WORKER HELPERS ====================

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

            // Timeout untuk ephemeral workers (30 detik)
            const timeout = setTimeout(() => {
                worker.terminate();
                reject(new Error('Ephemeral worker timed out'));
            }, 30000);

            worker.on('message', (msg) => {
                if (msg.type === 'data') data = msg.data;
                else if (msg.type === 'error') {
                    clearTimeout(timeout);
                    reject(new Error(msg.content));
                }
            });
            worker.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
            worker.on('exit', (code) => {
                clearTimeout(timeout);
                if (code === 0 && data) resolve(data);
                else if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
                else reject(new Error('Worker exited without returning data'));
            });
        });
    }
}

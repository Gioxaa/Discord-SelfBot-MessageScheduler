/**
 * Worker Interface Definitions
 * 
 * Interface untuk komunikasi antara main process dan worker threads.
 * Digunakan untuk menggantikan penggunaan 'any' type di seluruh project.
 */

// ==================== WORKER MODE ====================

/**
 * Mode operasi worker thread
 */
export type WorkerMode = 'RUN' | 'FETCH_GUILDS' | 'FETCH_CHANNELS' | 'FETCH_CONTEXT' | 'PREVIEW';

// ==================== WORKER DATA ====================

/**
 * Payload untuk inisialisasi worker thread
 */
export interface WorkerData {
    mode: WorkerMode;
    token: string;
    guildId?: string;
    channelId?: string;
    threadId?: string;
    inviteCode?: string;
    message?: string;
}

// ==================== LOG DATA ====================

/**
 * Struktur log message yang dikirim dari worker ke parent process
 */
export interface LogData {
    type?: 'log';
    status: 'success' | 'error';
    content: string;
    url: string | null;
    nextDelay: number;
    taskId?: string;
}

// ==================== DISCORD ENTITIES ====================

/**
 * Guild object dari Discord API (simplified untuk kebutuhan project)
 */
export interface WorkerGuild {
    id: string;
    name: string;
    icon?: string | null;
}

/**
 * Channel object dari Discord API (simplified untuk kebutuhan project)
 */
export interface WorkerChannel {
    id: string;
    name: string;
    rateLimitPerUser: number;
}

// ==================== CACHE ====================

/**
 * Generic cache item wrapper dengan expiry time
 */
export interface CacheItem<T> {
    data: T;
    expires: number;
}

// ==================== WORKER CONTEXT ====================

/**
 * Context object yang dikembalikan dari FETCH_CONTEXT mode
 */
export interface WorkerContext {
    guildName: string;
    channelName: string;
}

// ==================== TASK CONFIG ====================

/**
 * Konfigurasi task yang dikirim ke worker untuk mode RUN
 */
export interface TaskConfig {
    taskId: string;
    token: string;
    guildId: string;
    channelId: string;
    threadId?: string;
    message: string;
    minDelay: number;
    maxDelay: number;
    dynamicDelay: boolean;
}

// ==================== WORKER RESULT TYPES ====================

/**
 * Union type untuk hasil yang dikembalikan worker
 */
export type WorkerResult = WorkerGuild[] | WorkerChannel[] | WorkerContext | void;

// ==================== PAYMENT WEBHOOK ====================

/**
 * Payload yang diterima dari Pakasir webhook
 */
export interface PakasirWebhookPayload {
    merchant_ref?: string;
    order_id?: string;
    status: string;
    amount?: number;
    paid_at?: string;
    [key: string]: unknown; // Untuk field tambahan yang tidak diketahui
}

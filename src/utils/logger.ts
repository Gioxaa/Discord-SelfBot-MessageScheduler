export class Logger {
    private static getTimestamp(): string {
        return new Date().toISOString();
    }

    static info(message: string, context?: string) {
        const ctx = context ? `[${context}] ` : '';
        console.log(`[${this.getTimestamp()}] [INFO] ${ctx}${message}`);
    }

    static warn(message: string, context?: string) {
        const ctx = context ? `[${context}] ` : '';
        console.warn(`[${this.getTimestamp()}] [WARN] ${ctx}${message}`);
    }

    static error(message: string, error?: any, context?: string) {
        const ctx = context ? `[${context}] ` : '';
        const errMsg = error instanceof Error ? error.message : error;
        console.error(`[${this.getTimestamp()}] [ERROR] ${ctx}${message}`, errMsg);
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }
    }

    static debug(message: string, context?: string) {
        if (process.env.NODE_ENV === 'development') {
            const ctx = context ? `[${context}] ` : '';
            console.debug(`[${this.getTimestamp()}] [DEBUG] ${ctx}${message}`);
        }
    }
}

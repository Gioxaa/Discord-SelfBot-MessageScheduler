export class Logger {
    private static getTimestamp(): string {
        return new Date().toLocaleString('id-ID', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit', 
            hour12: false 
        }).replace(/\./g, ':'); // Replace dot with colon for time if needed, or keep standard
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

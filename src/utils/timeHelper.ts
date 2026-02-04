export function formatDuration(seconds: number): string {
    // Validate input - handle NaN, Infinity, negative values
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0s';
    }
    
    // Floor to integer to handle floats
    seconds = Math.floor(seconds);
    
    if (seconds < 60) return `${seconds}s`;

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0) parts.push(`${secs}s`);

    return parts.join(' ') || '0s';
}

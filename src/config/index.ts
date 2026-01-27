import dotenv from 'dotenv';

dotenv.config();

export interface PaymentProduct {
    id: string;
    name: string;
    price: number;
    durationDays: number;
    description: string;
}

export const PRODUCTS: Record<string, PaymentProduct> = {
    '7_DAYS': {
        id: '7_DAYS',
        name: 'Weekly Access',
        price: 10000,
        durationDays: 7,
        description: 'Full access to Selfbot Manager for 7 days.'
    },
    '30_DAYS': {
        id: '30_DAYS',
        name: 'Monthly Access',
        price: 35000,
        durationDays: 30,
        description: 'Full access to Selfbot Manager for 30 days (Save 12%).'
    }
};

export const config = {
    port: process.env.PORT || 3000,
    databaseUrl: process.env.DATABASE_URL,
    botToken: process.env.BOT_TOKEN,
    encryptionKey: process.env.ENCRYPTION_KEY,
    webhookUrl: process.env.WEBHOOK_URL,
    pakasir: {
        apiKey: process.env.PAKASIR_API_KEY,
        projectSlug: process.env.PAKASIR_PROJECT_SLUG,
        apiUrl: process.env.PAKASIR_API_URL || 'https://app.pakasir.com/api',
    },
    guildId: process.env.GUILD_ID,
    adminId: process.env.ADMIN_ID,
    adminRoleId: process.env.ADMIN_ROLE_ID,
    clientId: process.env.CLIENT_ID
};

// Basic Validation
const requiredEnv = ['BOT_TOKEN', 'ENCRYPTION_KEY', 'PAKASIR_API_KEY', 'PAKASIR_PROJECT_SLUG', 'GUILD_ID', 'ADMIN_ID'];
const missing = requiredEnv.filter(key => !process.env[key]);

if (missing.length > 0) {
    console.warn(`[Config] ⚠️ Missing recommended environment variables: ${missing.join(', ')}`);
}

if (config.encryptionKey && config.encryptionKey.length !== 32) {
    console.error(`[Config] ❌ ENCRYPTION_KEY must be exactly 32 characters long. Current length: ${config.encryptionKey.length}`);
    process.exit(1);
}

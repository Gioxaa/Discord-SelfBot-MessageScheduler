/**
 * Migration Script: Re-encrypt all legacy CBC tokens to GCM format
 * 
 * Format lama (CBC): iv:encryptedData (2 parts)
 * Format baru (GCM): iv:authTag:encryptedData (3 parts)
 * 
 * Usage:
 *   npm run migrate:tokens           # Dry run (preview saja)
 *   npm run migrate:tokens -- --run  # Execute migration
 */

import prisma from '../database/client';
import { isLegacyFormat, reEncrypt } from '../utils/security';

async function migrateTokens() {
    const isDryRun = !process.argv.includes('--run');
    
    console.log('='.repeat(50));
    console.log('TOKEN MIGRATION: CBC -> GCM');
    console.log(`Mode: ${isDryRun ? 'DRY RUN (preview only)' : 'EXECUTE'}`);
    console.log('='.repeat(50));
    
    // Fetch all accounts
    const accounts = await prisma.account.findMany();
    console.log(`\nFound ${accounts.length} accounts to check.\n`);
    
    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const account of accounts) {
        const accountLabel = `${account.name || 'Unnamed'} (${account.id.slice(0, 8)}...)`;
        
        // Cek apakah menggunakan format lama
        if (!isLegacyFormat(account.token)) {
            console.log(`[SKIP] ${accountLabel} - Already using new format`);
            skipped++;
            continue;
        }
        
        try {
            // Re-encrypt token
            const newToken = reEncrypt(account.token);
            
            if (!newToken) {
                console.log(`[SKIP] ${accountLabel} - Re-encrypt returned null`);
                skipped++;
                continue;
            }
            
            if (isDryRun) {
                console.log(`[WOULD MIGRATE] ${accountLabel}`);
            } else {
                // Update di database
                await prisma.account.update({
                    where: { id: account.id },
                    data: { token: newToken }
                });
                console.log(`[MIGRATED] ${accountLabel}`);
            }
            migrated++;
            
        } catch (error: any) {
            console.log(`[FAILED] ${accountLabel} - ${error.message}`);
            failed++;
        }
    }
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY:');
    console.log(`  Migrated: ${migrated}`);
    console.log(`  Skipped:  ${skipped}`);
    console.log(`  Failed:   ${failed}`);
    console.log('='.repeat(50));
    
    if (isDryRun && migrated > 0) {
        console.log('\n⚠️  This was a DRY RUN. No changes were made.');
        console.log('    Run with --run flag to execute migration:');
        console.log('    npm run migrate:tokens -- --run\n');
    }
    
    if (!isDryRun && migrated > 0) {
        console.log('\n✅ Migration completed successfully!');
        console.log('   Restart the bot to verify no more legacy warnings.\n');
    }
    
    await prisma.$disconnect();
}

// Run migration
migrateTokens().catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
});

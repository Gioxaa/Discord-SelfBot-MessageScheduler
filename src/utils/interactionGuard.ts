import { Interaction } from 'discord.js';
import prisma from '../database/client';
import { Logger } from './logger';

export async function validateOwnership(interaction: Interaction): Promise<boolean> {
    if (!interaction.isRepliable()) return false;

    // 1. Allow Public Interactions (Store/Buy Buttons, Terms, Tutorial)
    // We check customId if available (Buttons, Modals, Selects)
    const customId = (interaction as any).customId;
    if (customId && (customId.startsWith('btn_buy_') || customId === 'btn_view_terms' || customId === 'btn_view_tutorial' || customId.startsWith('btn_tutorial_'))) {
        return true;
    }

    // 2. Check if current channel is a Workspace
    const channelId = interaction.channelId;
    if (!channelId) return false; // Fail-closed: deny access if channelId is missing

    try {
        // Find user who owns this workspace channel
        const workspaceOwner = await prisma.user.findFirst({
            where: { workspaceChannelId: channelId }
        });

        // If this is NOT a workspace channel, we might want to block dashboard buttons
        // but allow other things. ideally dashboard buttons only exist in workspace.
        if (!workspaceOwner) {
            // It's not a workspace channel.
            // If it's a dashboard button, block it.
            if (customId && (customId.startsWith('btn_add_') || customId.startsWith('btn_setup_') || customId.startsWith('btn_view_'))) {
                await interaction.reply({ content: '❌ This command can only be used inside a Workspace.', ephemeral: true });
                return false;
            }
            return true; // Allow other interactions in public channels
        }

        // 3. Verify Ownership
        if (workspaceOwner.id !== interaction.user.id) {
            Logger.warn(`Access Denied: User ${interaction.user.id} tried to use workspace of ${workspaceOwner.id}`);
            await interaction.reply({ 
                content: '⛔ **Access Denied**\nThis dashboard belongs to another user.\nYou cannot interact with it.', 
                ephemeral: true 
            });
            return false;
        }

        return true;

    } catch (error) {
        Logger.error('Interaction Guard Error', error);
        return false; // Fail safe
    }
}

export async function validateActiveSubscription(userId: string): Promise<boolean> {
    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return false;
        
        // If expiryDate is present and in the past, return false (Expired)
        if (user.expiryDate && new Date() > user.expiryDate) {
            return false;
        }
        
        return true;
    } catch (error) {
        Logger.error('Subscription Validation Error', error);
        return false; // Fail safe
    }
}

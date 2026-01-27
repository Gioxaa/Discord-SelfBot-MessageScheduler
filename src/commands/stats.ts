import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../interfaces/command';
import { config } from '../config';
import { renderStats } from '../views/stats.view';
import prisma from '../database/client';

export const deployStatsCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('deploy-stats')
        .setDescription('Deploy the Live Global Stats Panel (Admin Only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    execute: async (interaction) => {
        // Admin Only
        if (interaction.user.id !== config.adminId) {
            await interaction.reply({ content: '⛔ Admin only.', ephemeral: true });
            return;
        }

        const statsView = await renderStats();
        
        // We send to channel, not reply, so it stays
        if (interaction.channel && interaction.channel.isSendable()) {
            const msg = await interaction.channel.send({ embeds: statsView.embeds });
            
            // Save ID to DB
            await prisma.systemConfig.upsert({
                where: { id: 'main' },
                update: {
                    statsChannelId: interaction.channelId,
                    statsMessageId: msg.id
                },
                create: {
                    id: 'main',
                    statsChannelId: interaction.channelId,
                    statsMessageId: msg.id
                }
            });

            await interaction.reply({ content: '✅ Global Stats Panel Deployed! It will auto-refresh every 15s.', ephemeral: true });
        } else {
            await interaction.reply({ content: '❌ Cannot send messages here.', ephemeral: true });
        }
    }
};
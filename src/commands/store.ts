import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../interfaces/command';
import { config } from '../config';
import { renderStore } from '../views/store.view';

export const storeCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('deploy-store')
        .setDescription('Deploy the Premium Store Panel (Admin Only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    execute: async (interaction) => {
        if (interaction.user.id !== config.adminId) {
            await interaction.reply({ content: '⛔ Admin only.', ephemeral: true });
            return;
        }
    
        const storeView = renderStore();
        
        // We send to channel, not reply, so it stays
        if (interaction.channel && interaction.channel.isSendable()) {
            await interaction.channel.send({ embeds: storeView.embeds, components: storeView.components });
            await interaction.reply({ content: '✅ Store Deployed!', ephemeral: true });
        } else {
            await interaction.reply({ content: '❌ Cannot send messages here.', ephemeral: true });
        }
    }
};

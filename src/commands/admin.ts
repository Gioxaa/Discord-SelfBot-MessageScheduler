import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../interfaces/command';
import { AdminService } from '../services/admin.service';
import { config } from '../config';
import { EmbedBuilder } from 'discord.js';

export const adminCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Administrator Tools')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => 
            sub.setName('stats')
               .setDescription('View system statistics')
        )
        .addSubcommand(sub => 
            sub.setName('user_info')
               .setDescription('Get detailed user information')
               .addUserOption(opt => opt.setName('target').setDescription('The user').setRequired(true))
        )
        .addSubcommand(sub => 
            sub.setName('add_time')
               .setDescription('Add subscription days to a user')
               .addUserOption(opt => opt.setName('target').setDescription('The user').setRequired(true))
               .addIntegerOption(opt => opt.setName('days').setDescription('Days to add').setRequired(true))
        )
        .addSubcommand(sub => 
            sub.setName('remove_time')
               .setDescription('Remove subscription days from a user')
               .addUserOption(opt => opt.setName('target').setDescription('The user').setRequired(true))
               .addIntegerOption(opt => opt.setName('days').setDescription('Days to remove').setRequired(true))
        )
        .addSubcommand(sub => 
            sub.setName('delete_workspace')
               .setDescription('Force delete a user workspace')
               .addUserOption(opt => opt.setName('target').setDescription('The user').setRequired(true))
        ),

    execute: async (interaction) => {
        // 1. Verify Role
        const member = interaction.member;
        const roles = (member as any).roles; // Quick access for cache
        const isAdmin = config.adminRoleId && roles.cache.has(config.adminRoleId);
        
        // Allow Owner (ADMIN_ID) or Role
        if (interaction.user.id !== config.adminId && !isAdmin) {
            await interaction.reply({ content: '⛔ Access Denied.', ephemeral: true });
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'stats') {
                const stats = await AdminService.getStats();
                const embed = new EmbedBuilder()
                    .setTitle('📊 System Statistics')
                    .setColor(0x5865F2)
                    .addFields(
                        { name: 'Total Users', value: stats.totalUsers.toString(), inline: true },
                        { name: 'Active Tasks', value: stats.activeTasks.toString(), inline: true },
                        { name: 'Revenue', value: `Rp ${stats.revenue.toLocaleString('id-ID')}`, inline: true }
                    );
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            else if (subcommand === 'user_info') {
                const targetUser = interaction.options.getUser('target', true);
                const userInfo = await AdminService.getUserInfo(targetUser.id);

                if (!userInfo) {
                    await interaction.reply({ content: 'User not found in database.', ephemeral: true });
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle(`User Info: ${userInfo.username || 'Unknown'}`)
                    .addFields(
                        { name: 'ID', value: userInfo.id, inline: true },
                        { name: 'Expiry', value: userInfo.expiryDate ? userInfo.expiryDate.toLocaleString() : 'Expired/None', inline: true },
                        { name: 'Accounts', value: userInfo._count.accounts.toString(), inline: true }
                    );
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            else if (subcommand === 'add_time') {
                const targetUser = interaction.options.getUser('target', true);
                const days = interaction.options.getInteger('days', true);
                
                await AdminService.addTime(targetUser.id, days);
                await interaction.reply({ content: `✅ Added ${days} days to ${targetUser.username}.`, ephemeral: true });
            }

            else if (subcommand === 'remove_time') {
                const targetUser = interaction.options.getUser('target', true);
                const days = interaction.options.getInteger('days', true);
                
                await AdminService.removeTime(targetUser.id, days);
                await interaction.reply({ content: `✅ Removed ${days} days from ${targetUser.username}.`, ephemeral: true });
            }

            else if (subcommand === 'delete_workspace') {
                const targetUser = interaction.options.getUser('target', true);
                await interaction.deferReply({ ephemeral: true });
                
                await AdminService.deleteWorkspace(targetUser.id, interaction.client);
                await interaction.editReply(`🗑️ Workspace for ${targetUser.username} has been deleted.`);
            }

        } catch (error: any) {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ content: `❌ Error: ${error.message}` });
            } else {
                await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
            }
        }
    }
};

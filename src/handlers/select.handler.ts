import { StringSelectMenuInteraction, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { AccountService } from '../services/account.service';
import { TaskService } from '../services/task.service';
import { WorkerService } from '../services/worker.service';
import { renderTaskPanel } from '../views/task.view';
import { Logger } from '../utils/logger';
import { validateOwnership } from '../utils/interactionGuard';
import { renderAccountDetail } from '../views/account.view';

export async function handleSelect(interaction: StringSelectMenuInteraction) {
    // Security Check
    const isAuthorized = await validateOwnership(interaction);
    if (!isAuthorized) return;

    const { customId } = interaction;

    try {
        if (customId === 'select_account_task') {
            const accountId = interaction.values[0];
            await interaction.deferUpdate();

            try {
                const account = await AccountService.getById(accountId);
                if (!account) {
                    await interaction.followUp({ content: 'Account not found.', ephemeral: true });
                    return;
                }

                const token = AccountService.getDecryptedToken(account);
                const guilds = await WorkerService.fetchGuilds(token);
                
                const ITEMS_PER_PAGE = 25;
                const slicedGuilds = guilds.slice(0, ITEMS_PER_PAGE);
                
                // Calculate Total Pages
                const totalPages = Math.ceil(guilds.length / ITEMS_PER_PAGE);
                const selectPlaceholder = `Select a server (Page 1/${totalPages})`;

                const select = new StringSelectMenuBuilder()
                    .setCustomId(`select_guild_task_${accountId}`)
                    .setPlaceholder(selectPlaceholder)
                    .addOptions(
                        slicedGuilds.map((g: any) => new StringSelectMenuOptionBuilder()
                            .setLabel(g.name.substring(0, 100))
                            .setValue(g.id)
                            .setDescription(`ID: ${g.id}`)
                        )
                    );

                const buttons: ButtonBuilder[] = [];
                
                // If more than 25, add Next button
                if (guilds.length > ITEMS_PER_PAGE) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`btn_page_guild_${accountId}_1`) // Go to Page 1 (index 1 = 2nd page)
                            .setLabel('Next ➡️')
                            .setStyle(ButtonStyle.Secondary)
                    );
                }

                buttons.push(
                    new ButtonBuilder().setCustomId(`btn_search_guild_${accountId}`).setLabel('Search').setStyle(ButtonStyle.Primary).setEmoji('🔍'),
                    new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );

                await interaction.editReply({
                    content: `**Step 2: Select Server**`,
                    components: [
                        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
                        new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)
                    ]
                });

            } catch (error: any) {
                await interaction.editReply({ content: `Failed to fetch servers: ${error.message}`, components: [] });
            }
        }

        else if (customId.startsWith('select_guild_task_')) {
            const accountId = customId.replace('select_guild_task_', '');
            const guildId = interaction.values[0];

            await interaction.deferUpdate();

            try {
                const account = await AccountService.getById(accountId);
                if (!account) return;

                const token = AccountService.getDecryptedToken(account);
                const channels = await WorkerService.fetchChannels(token, guildId);

                if (channels.length === 0) {
                    await interaction.editReply({ content: '❌ No text channels found.', components: [] });
                    return;
                }

                // Pagination: Show first 25
                const ITEMS_PER_PAGE = 25;
                const slicedChannels = channels.slice(0, ITEMS_PER_PAGE);

                // Calculate Total Pages
                const totalPages = Math.ceil(channels.length / ITEMS_PER_PAGE);
                const selectPlaceholder = `Choose a channel (Page 1/${totalPages})`;

                const select = new StringSelectMenuBuilder()
                    .setCustomId(`select_channel_task_${accountId}_${guildId}`)
                    .setPlaceholder(selectPlaceholder)
                    .addOptions(
                        slicedChannels.map((c: any) => new StringSelectMenuOptionBuilder()
                            .setLabel(c.name.substring(0, 50))
                            .setValue(`${c.id}|${c.rateLimitPerUser}`)
                            .setDescription(`Slowmode: ${c.rateLimitPerUser}s`)
                        )
                    );

                const buttons: ButtonBuilder[] = [];

                if (channels.length > ITEMS_PER_PAGE) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`btn_page_channel_${accountId}_${guildId}_1`) // Go to Page 1
                            .setLabel('Next ➡️')
                            .setStyle(ButtonStyle.Secondary)
                    );
                }

                buttons.push(
                    new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );

                await interaction.editReply({
                    content: `**Step 3: Select Channel**`,
                    components: [
                        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
                        new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)
                    ]
                });

            } catch (error: any) {
                await interaction.editReply({ content: `Failed to fetch channels: ${error.message}`, components: [] });
            }
        }

        else if (customId.startsWith('select_channel_task_')) {
            // ... (Existing Logic)
            const parts = customId.split('_');
            const accountId = parts[3];
            const guildId = parts[4];
            
            const value = interaction.values[0];
            const [channelId, slowmodeStr] = value.split('|');
            const slowmode = parseInt(slowmodeStr);

            const embed = new EmbedBuilder()
                .setTitle('Configure Strategy')
                .setDescription(`**Target:** <#${channelId}>\n**Slowmode:** ${slowmode}s`)
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Automatic Mode', value: 'Adapts to channel limits automatically.', inline: true },
                    { name: 'Manual Mode', value: 'Set a custom delay range.', inline: true }
                );

            const strategyRow = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`btn_delay_auto_${accountId}_${guildId}_${channelId}_${slowmode}`)
                        .setLabel('Use Automatic')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`btn_delay_manual_${accountId}_${guildId}_${channelId}_${slowmode}`)
                        .setLabel('Configure Manual')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('btn_cancel_setup')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.update({
                content: '',
                embeds: [embed],
                components: [strategyRow]
            });
        }

        else if (customId === 'select_manage_task') {
            // ... (Existing Logic)
            const taskId = interaction.values[0];
            await interaction.deferUpdate();

            const task = await TaskService.getById(taskId);

            if (!task) {
                await interaction.editReply({ content: 'Task not found.', components: [], embeds: [] });
                return;
            }

            const panel = renderTaskPanel(task);

            await interaction.editReply({
                embeds: [panel.embed],
                components: [panel.row, panel.editRow]
            });
        }

        else if (customId === 'select_manage_account') {
            const accountId = interaction.values[0];
            await interaction.deferUpdate();
            
            const view = await renderAccountDetail(accountId);
            await interaction.editReply({ ...view } as any);
        }

    } catch (error) {
        Logger.error('Select Handler Error', error);
    }
}

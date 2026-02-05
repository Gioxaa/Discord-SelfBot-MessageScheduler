import { StringSelectMenuInteraction, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { AccountService } from '../services/account.service';
import { TaskService } from '../services/task.service';
import { WorkerService } from '../services/worker.service';
import { renderTaskPanel } from '../views/task.view';
import { Logger } from '../utils/logger';
import { validateOwnership } from '../utils/interactionGuard';
import { renderAccountDetail } from '../views/account.view';
import { WorkerGuild, WorkerChannel } from '../interfaces/worker';

export async function handleSelect(interaction: StringSelectMenuInteraction) {
    // Security Check
    const isAuthorized = await validateOwnership(interaction);
    if (!isAuthorized) return;

    const { customId } = interaction;

    try {
        if (customId === 'select_account_task') {
            const accountId = interaction.values[0];
            
            // Get account name first for loading state
            const account = await AccountService.getById(accountId);
            if (!account) {
                await interaction.reply({ content: '❌ Account not found.', ephemeral: true });
                return;
            }
            const accountName = account.name || 'Unknown';

            // Show loading state immediately
            const loadingEmbed = new EmbedBuilder()
                .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:Tick_green:1306061558303952937> Account : **${accountName}**
<a:loading_gif:1306062016611614741> Server : *Fetching...*
<a:offline:1306203222263988285> Channel : *Pending*
<a:offline:1306203222263988285> Strategy : *Pending*
`)
                .setColor(0x5865F2)
                .setFooter({ text: 'AutoPost | Powered by Frey' })
                .setTimestamp();

            await interaction.update({
                content: '',
                embeds: [loadingEmbed],
                components: []
            });

            try {
                const token = AccountService.getDecryptedToken(account);
                const guilds = await WorkerService.fetchGuilds(token);
                
                const ITEMS_PER_PAGE = 25;
                const slicedGuilds = guilds.slice(0, ITEMS_PER_PAGE);
                
                // Calculate Total Pages
                const totalPages = Math.ceil(guilds.length / ITEMS_PER_PAGE);

                const select = new StringSelectMenuBuilder()
                    .setCustomId(`select_guild_task_${accountId}`)
                    .setPlaceholder(`Select a server (Page 1/${totalPages})`)
                    .addOptions(
                        slicedGuilds.map((g: WorkerGuild) => new StringSelectMenuOptionBuilder()
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
                    new ButtonBuilder().setCustomId('btn_back_step1').setLabel('Back').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );

                const resultEmbed = new EmbedBuilder()
                    .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:Tick_green:1306061558303952937> Account : **${accountName}**
<a:arrow:1306059259615903826> Server : *Select from dropdown*
<a:offline:1306203222263988285> Channel : *Pending*
<a:offline:1306203222263988285> Strategy : *Pending*
\u200b
> Found **${guilds.length}** servers (Page 1/${totalPages})
`)
                    .setColor(0x5865F2)
                    .setFooter({ text: 'AutoPost | Powered by Frey' })
                    .setTimestamp();

                await interaction.editReply({
                    content: '',
                    embeds: [resultEmbed],
                    components: [
                        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
                        new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)
                    ]
                });

            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await interaction.editReply({ content: `❌ Failed to fetch servers: ${errorMessage}`, embeds: [], components: [] });
            }
        }

        else if (customId.startsWith('select_guild_task_')) {
            const accountId = customId.replace('select_guild_task_', '');
            const guildId = interaction.values[0];

            // Get account and guild info first
            const account = await AccountService.getById(accountId);
            if (!account) {
                await interaction.reply({ content: '❌ Account not found.', ephemeral: true });
                return;
            }
            const accountName = account.name || 'Unknown';
            
            // Get guild name from the select menu option label
            const selectedOption = interaction.component.options.find(opt => opt.value === guildId);
            const guildName = selectedOption?.label || 'Unknown Server';

            // Show loading state immediately
            const loadingEmbed = new EmbedBuilder()
                .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:Tick_green:1306061558303952937> Account : **${accountName}**
<a:Tick_green:1306061558303952937> Server : **${guildName}**
<a:loading_gif:1306062016611614741> Channel : *Fetching...*
<a:offline:1306203222263988285> Strategy : *Pending*
`)
                .setColor(0x5865F2)
                .setFooter({ text: 'AutoPost | Powered by Frey' })
                .setTimestamp();

            await interaction.update({
                content: '',
                embeds: [loadingEmbed],
                components: []
            });

            try {
                const token = AccountService.getDecryptedToken(account);
                const channels = await WorkerService.fetchChannels(token, guildId);

                if (channels.length === 0) {
                    await interaction.editReply({ content: '❌ No text channels found.', embeds: [], components: [] });
                    return;
                }

                // Pagination: Show first 25
                const ITEMS_PER_PAGE = 25;
                const slicedChannels = channels.slice(0, ITEMS_PER_PAGE);

                // Calculate Total Pages
                const totalPages = Math.ceil(channels.length / ITEMS_PER_PAGE);

                const select = new StringSelectMenuBuilder()
                    .setCustomId(`select_channel_task_${accountId}_${guildId}`)
                    .setPlaceholder(`Choose a channel (Page 1/${totalPages})`)
                    .addOptions(
                        slicedChannels.map((c: WorkerChannel) => new StringSelectMenuOptionBuilder()
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
                    new ButtonBuilder().setCustomId(`btn_back_step2_${accountId}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );

                const resultEmbed = new EmbedBuilder()
                    .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:Tick_green:1306061558303952937> Account : **${accountName}**
<a:Tick_green:1306061558303952937> Server : **${guildName}**
<a:arrow:1306059259615903826> Channel : *Select from dropdown*
<a:offline:1306203222263988285> Strategy : *Pending*
\u200b
> Found **${channels.length}** channels (Page 1/${totalPages})
`)
                    .setColor(0x5865F2)
                    .setFooter({ text: 'AutoPost | Powered by Frey' })
                    .setTimestamp();

                await interaction.editReply({
                    content: '',
                    embeds: [resultEmbed],
                    components: [
                        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
                        new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)
                    ]
                });

            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await interaction.editReply({ content: `❌ Failed to fetch channels: ${errorMessage}`, embeds: [], components: [] });
            }
        }

        else if (customId.startsWith('select_channel_task_')) {
            const parts = customId.split('_');
            const accountId = parts[3];
            const guildId = parts[4];
            
            const value = interaction.values[0];
            const [channelId, slowmodeStr] = value.split('|');
            const slowmode = parseInt(slowmodeStr);

            // Get account info
            const account = await AccountService.getById(accountId);
            const accountName = account?.name || 'Unknown';

            // Get channel name from select option
            const selectedOption = interaction.component.options.find(opt => opt.value === value);
            const channelName = selectedOption?.label || 'Unknown Channel';

            // Calculate auto delay preview (same formula as modal.handler.ts)
            const autoMinDelay = slowmode + 60;  // slowmode + 1 min
            const autoMaxDelay = slowmode + 180; // slowmode + 3 min

            const embed = new EmbedBuilder()
                .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **CONFIGURE STRATEGY** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:Tick_green:1306061558303952937> Account : **${accountName}**
<a:Tick_green:1306061558303952937> Server : *Selected*
<a:Tick_green:1306061558303952937> Channel : **#${channelName}**
<a:arrow:1306059259615903826> Strategy : *Choose below*
\u200b
**MODE OPTIONS**
<a:arrow:1306059259615903826> **Automatic** → Delay: **${autoMinDelay}s - ${autoMaxDelay}s**
> *Formula: Slowmode + 1~3 minutes buffer*

<a:arrow:1306059259615903826> **Manual** → Set custom delay range
> *Minimum: ${slowmode > 0 ? slowmode + 's (slowmode)' : '3s'}*
\u200b
<a:arrow:1306059259615903826> Channel Slowmode : **${slowmode}s**
`)
                .setColor(0x5865F2)
                .setFooter({ text: 'AutoPost | Powered by Frey' })
                .setTimestamp();

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
                        .setCustomId(`btn_back_step3_${accountId}_${guildId}`)
                        .setLabel('Back')
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
            await interaction.editReply({ ...view });
        } else {
            // Unknown select menu - Fallback handler
            Logger.warn(`Unhandled select customId: ${customId}`, 'SelectHandler');
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Unknown action.', flags: 1 << 6 });
            }
        }

    } catch (error) {
        Logger.error('Select Handler Error', error);
        // Berikan feedback ke user jika terjadi error
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An error occurred. Please try again.', flags: 1 << 6 });
            } else if (interaction.deferred) {
                await interaction.editReply({ content: '❌ An error occurred. Please try again.' });
            }
        } catch (replyError) {
            // Ignore reply errors - interaction might have expired
            Logger.warn('Failed to send error feedback to user', 'SelectHandler');
        }
    }
}

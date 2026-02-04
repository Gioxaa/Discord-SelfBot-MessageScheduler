import { ModalSubmitInteraction, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { validateToken } from '../utils/discordHelper';
import { WorkerService } from '../services/worker.service';
import { AccountService } from '../services/account.service';
import { TaskService } from '../services/task.service';
import { Logger } from '../utils/logger';
import { validateOwnership } from '../utils/interactionGuard';
import { renderTaskPanel } from '../views/task.view';
import { renderAccountDetail } from '../views/account.view';
import { decrypt } from '../utils/security';

// Konstanta validasi delay
const MAX_DELAY_MS = 86400000; // 24 hours in milliseconds
const MIN_DELAY_MS = 3000; // 3 seconds in milliseconds

export async function handleModal(interaction: ModalSubmitInteraction) {
    // Security Check
    const isAuthorized = await validateOwnership(interaction);
    if (!isAuthorized) return;

    const { customId } = interaction;

    try {
        // ==================== ADD ACCOUNT MODAL ====================
        if (customId === 'modal_add_account') {
            const token = interaction.fields.getTextInputValue('token_input');
            const name = interaction.fields.getTextInputValue('name_input');
            
            await interaction.deferReply({ ephemeral: true });

            const discordUser = await validateToken(token);
            
            if (!discordUser) {
                await interaction.editReply({ content: '❌ Invalid Discord Token. Please check and try again.' });
                return;
            }

            await AccountService.create(interaction.user.id, name, token, discordUser.avatar);
            await interaction.editReply({ content: `✅ Account **${name}** (Connected as ${discordUser.username}) added successfully!` });
        }

        // ==================== SEARCH GUILD MODAL ====================
        else if (customId.startsWith('modal_search_guild_')) {
            const accountId = customId.replace('modal_search_guild_', '');
            const query = interaction.fields.getTextInputValue('search_query').toLowerCase();

            // Get account name for display
            const account = await AccountService.getById(accountId);
            if (!account) {
                await interaction.reply({ content: '❌ Account not found.', ephemeral: true });
                return;
            }
            const accountName = account.name || 'Unknown';

            // Use deferUpdate to edit the SAME message instead of creating new one
            await interaction.deferUpdate();

            // Show loading embed on the SAME message
            const loadingEmbed = new EmbedBuilder()
                .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:Tick_green:1306061558303952937> Account : **${accountName}**
<a:loading_gif:1306062016611614741> Server : *Searching "${query}"...*
<a:offline:1306203222263988285> Channel : *Pending*
<a:offline:1306203222263988285> Strategy : *Pending*
`)
                .setColor(0x5865F2)
                .setFooter({ text: 'AutoPost | Powered by Frey' })
                .setTimestamp();

            await interaction.editReply({ embeds: [loadingEmbed], components: [] });

            try {
                const token = AccountService.getDecryptedToken(account);
                const guilds = await WorkerService.fetchGuilds(token);
                
                const filtered = guilds.filter((g: any) => g.name.toLowerCase().includes(query)).slice(0, 25);

                if (filtered.length === 0) {
                    const noResultEmbed = new EmbedBuilder()
                        .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:Tick_green:1306061558303952937> Account : **${accountName}**
<a:alert:1306298772124336178> Server : *No results for "${query}"*
<a:offline:1306203222263988285> Channel : *Pending*
<a:offline:1306203222263988285> Strategy : *Pending*
\u200b
> No servers found. Try a different search term.
`)
                        .setColor(0xED4245)
                        .setFooter({ text: 'AutoPost | Powered by Frey' })
                        .setTimestamp();

                    // Add back the search button so user can try again
                    const retryRow = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder().setCustomId(`btn_search_guild_${accountId}`).setLabel('Search Again').setStyle(ButtonStyle.Primary).setEmoji('🔍'),
                            new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                        );

                    await interaction.editReply({ embeds: [noResultEmbed], components: [retryRow] });
                    return;
                }

                const select = new StringSelectMenuBuilder()
                    .setCustomId(`select_guild_task_${accountId}`)
                    .setPlaceholder('Select a server')
                    .addOptions(
                        filtered.map((g: any) => new StringSelectMenuOptionBuilder()
                            .setLabel(g.name.substring(0, 100))
                            .setValue(g.id)
                            .setDescription(`ID: ${g.id}`)
                        )
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
<a:arrow:1306059259615903826> Search : **"${query}"** → Found **${filtered.length}** server${filtered.length > 1 ? 's' : ''}
`)
                    .setColor(0x57F287)
                    .setFooter({ text: 'AutoPost | Powered by Frey' })
                    .setTimestamp();

                const buttonRow = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder().setCustomId(`btn_search_guild_${accountId}`).setLabel('Search Again').setStyle(ButtonStyle.Primary).setEmoji('🔍'),
                        new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    );

                await interaction.editReply({
                    embeds: [resultEmbed],
                    components: [
                        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
                        buttonRow
                    ]
                });

            } catch (error: any) {
                await interaction.editReply({ content: `❌ Error fetching guilds: ${error.message}`, embeds: [], components: [] });
            }
        }

        // ==================== CREATE TASK MODAL (AUTO/MANUAL) ====================
        else if (customId.startsWith('modal_final_auto_') || customId.startsWith('modal_final_manual_')) {
            await interaction.deferUpdate();

            const isAuto = customId.startsWith('modal_final_auto_');
            const parts = customId.split('_');
            const accountId = parts[3];
            const guildId = parts[4];
            const channelId = parts[5];
            const slowmode = parseInt(parts[6]);

            const message = interaction.fields.getTextInputValue('message_content');
            let minDelay: number, maxDelay: number;

            if (isAuto) {
                // Auto delay: slowmode + 1-3 menit tambahan
                minDelay = (slowmode * 1000) + 60000; 
                maxDelay = (slowmode * 1000) + 180000;
            } else {
                // Manual delay: parse dari input user
                const delayRaw = interaction.fields.getTextInputValue('delay_range');
                const [minStr, maxStr] = delayRaw.split('-').map(s => s.trim());
                minDelay = parseInt(minStr) * 1000;
                maxDelay = parseInt(maxStr) * 1000;

                // Validasi format
                if (isNaN(minDelay) || isNaN(maxDelay)) {
                    await interaction.followUp({ content: '❌ Invalid delay format. Use format: min-max (e.g., 10-30)', ephemeral: true });
                    return;
                }

                // Validasi: minimum delay 3 detik
                if (minDelay < MIN_DELAY_MS) {
                    await interaction.followUp({ content: '❌ **Invalid!** Min delay must be at least 3 seconds.', ephemeral: true });
                    return;
                }

                // Validasi: minDelay harus >= slowmode
                if (minDelay < slowmode * 1000) {
                    await interaction.followUp({ content: `❌ **Unsafe!** Min delay must be >= ${slowmode}s (channel slowmode).`, ephemeral: true });
                    return;
                }

                // Validasi: minDelay tidak boleh > maxDelay
                if (minDelay > maxDelay) {
                    await interaction.followUp({ content: '❌ **Invalid!** Min delay cannot be greater than max delay.', ephemeral: true });
                    return;
                }

                // Validasi: maxDelay tidak boleh melebihi 24 jam
                if (maxDelay > MAX_DELAY_MS) {
                    await interaction.followUp({ content: '❌ **Invalid!** Max delay cannot exceed 24 hours (86400 seconds).', ephemeral: true });
                    return;
                }
            }

            // Validation for Max Length
            if (message.length > 4000) {
                await interaction.editReply({ content: `❌ **Message Too Long!**\nMax limit is 4000 characters.`, components: [], embeds: [] });
                return;
            }

            // Warning for Raw Emoji Aliases
            const emojiAliasRegex = /(?<!<a?):[\w]+:(?!(\d+>))/g;
            const potentialRawEmojis = message.match(emojiAliasRegex);
            let warningMsg = '';
            
            if (potentialRawEmojis && potentialRawEmojis.length > 0) {
                warningMsg = `\n\n⚠️ **Warning:** I detected potential raw emoji names (e.g. ${potentialRawEmojis[0]}).\nMake sure to use the full emoji code \`<:name:id>\` if you want them to appear as images!`;
            }

            // Fetch Real Names for DB
            let guildName = 'Unknown Server';
            let channelName = 'Unknown Channel';
            
            try {
                const account = await AccountService.getById(accountId);
                if (account) {
                    const token = decrypt(account.token);
                    const context = await WorkerService.fetchContext(token, guildId, channelId);
                    guildName = context.guildName;
                    channelName = context.channelName;
                }
            } catch (e: any) {
                Logger.warn('Failed to fetch context for DB save', e.message);
            }

            const newTask = await TaskService.create({
                accountId,
                guildId,
                guildName,
                channelId,
                channelName,
                channelSlowmode: slowmode,
                message,
                minDelay,
                maxDelay,
                dynamicDelay: isAuto
            });

            const panel = renderTaskPanel(newTask);
            await interaction.editReply({ 
                content: `✅ **Task Configured!**\nUse the buttons below to start the process.${warningMsg}`, 
                embeds: [panel.embed],
                components: [panel.row, panel.editRow]
            });
        }

        // ==================== EDIT MESSAGE MODAL ====================
        else if (customId.startsWith('modal_edit_msg_')) {
            const taskId = customId.replace('modal_edit_msg_', '');
            await interaction.deferUpdate();

            const newMessage = interaction.fields.getTextInputValue('new_message');
            
            // Check for raw emojis in edit too
            const emojiAliasRegex = /(?<!<a?):[\w]+:(?!(\d+>))/g;
            const potentialRawEmojis = newMessage.match(emojiAliasRegex);
            let warningMsg = '';
            
            if (potentialRawEmojis && potentialRawEmojis.length > 0) {
                warningMsg = `\n\n⚠️ **Warning:** Raw emoji names detected. Use \`<:name:id>\` for images.`;
            }

            // Update DB
            await TaskService.update(taskId, { message: newMessage });

            // Restart Worker if running
            const task = await TaskService.getById(taskId);
            if (task && task.status === 'RUNNING') {
                await WorkerService.stopTask(interaction.client, taskId);
                await WorkerService.startTask(interaction.client, taskId);
            }

            if (task) {
                const panel = renderTaskPanel({ ...task, message: newMessage });
                await interaction.editReply({ 
                    content: `✅ **Message Updated!**${warningMsg}`, 
                    components: [panel.row, panel.editRow], 
                    embeds: [panel.embed] 
                });
            }
        }

        // ==================== EDIT DELAY MODAL ====================
        else if (customId.startsWith('modal_edit_delay_')) {
            const taskId = customId.replace('modal_edit_delay_', '');
            await interaction.deferUpdate();

            const delayRaw = interaction.fields.getTextInputValue('new_delay');
            const [minStr, maxStr] = delayRaw.split('-').map(s => s.trim());
            const minDelay = parseInt(minStr) * 1000;
            const maxDelay = parseInt(maxStr) * 1000;

            // Validasi format
            if (isNaN(minDelay) || isNaN(maxDelay)) {
                await interaction.followUp({ content: '❌ Invalid delay format. Use format: min-max (e.g., 10-30)', ephemeral: true });
                return;
            }

            // Validasi: minDelay tidak boleh > maxDelay
            if (minDelay > maxDelay) {
                await interaction.followUp({ content: '❌ **Invalid!** Min delay cannot be greater than max delay.', ephemeral: true });
                return;
            }

            // Validasi: maxDelay tidak boleh melebihi 24 jam
            if (maxDelay > MAX_DELAY_MS) {
                await interaction.followUp({ content: '❌ **Invalid!** Max delay cannot exceed 24 hours (86400 seconds).', ephemeral: true });
                return;
            }

            // Validasi: minimum delay 3 detik
            if (minDelay < MIN_DELAY_MS) {
                await interaction.followUp({ content: '❌ **Invalid!** Min delay must be at least 3 seconds.', ephemeral: true });
                return;
            }

            // Get task to check channel slowmode
            const existingTask = await TaskService.getById(taskId);
            if (existingTask && existingTask.channelSlowmode) {
                const slowmodeMs = existingTask.channelSlowmode * 1000;
                if (minDelay < slowmodeMs) {
                    await interaction.followUp({ 
                        content: `❌ **Unsafe!** Min delay must be >= ${existingTask.channelSlowmode}s (channel slowmode).`, 
                        ephemeral: true 
                    });
                    return;
                }
            }

            // Update DB
            await TaskService.update(taskId, { minDelay, maxDelay, dynamicDelay: false });

            // Restart Worker if running
            const task = await TaskService.getById(taskId);
            if (task && task.status === 'RUNNING') {
                await WorkerService.stopTask(interaction.client, taskId);
                await WorkerService.startTask(interaction.client, taskId);
            }

            if (task) {
                const updatedTask = { ...task, minDelay, maxDelay };
                const panel = renderTaskPanel(updatedTask);
                await interaction.editReply({ 
                    content: `✅ **Delay Updated!** (${minStr}-${maxStr}s)`, 
                    components: [panel.row, panel.editRow], 
                    embeds: [panel.embed] 
                });
            }
        } 
        
        // ==================== UPDATE TOKEN MODAL ====================
        else if (customId.startsWith('modal_update_token_')) {
            const accountId = customId.replace('modal_update_token_', '');
            const newToken = interaction.fields.getTextInputValue('new_token_input');
            
            await interaction.deferUpdate();
            
            // Validate new token
            const discordUser = await validateToken(newToken);
            if (!discordUser) {
                await interaction.followUp({ 
                    content: '❌ Invalid token. Please check and try again.', 
                    ephemeral: true 
                });
                return;
            }
            
            // Update in database (encrypted)
            await AccountService.updateToken(accountId, newToken, discordUser.username, discordUser.avatar);
            
            // Refresh embed in SAME message with new status
            const view = await renderAccountDetail(accountId, { 
                isValid: true, 
                username: discordUser.username 
            });
            
            await interaction.editReply({ ...view } as any);
        }
        
        // ==================== UNKNOWN MODAL ====================
        else {
            Logger.warn(`Unhandled modal customId: ${customId}`, 'ModalHandler');
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Unknown action.', ephemeral: true });
            }
        }

    } catch (error) {
        Logger.error('Modal Handler Error', error, 'ModalHandler');
        
        // Fallback error response
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An error occurred while processing your request.', ephemeral: true });
            } else {
                await interaction.followUp({ content: '❌ An error occurred while processing your request.', ephemeral: true });
            }
        } catch (e) {
            // Ignore if we can't send error message
        }
    }
}

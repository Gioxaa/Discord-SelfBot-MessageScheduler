import { ModalSubmitInteraction, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { validateToken } from '../utils/discordHelper';
import { WorkerService } from '../services/worker.service';
import { AccountService } from '../services/account.service';
import { TaskService } from '../services/task.service';
import { Logger } from '../utils/logger';
import { validateOwnership } from '../utils/interactionGuard';
import { renderTaskPanel } from '../views/task.view';
import { decrypt } from '../utils/security';

export async function handleModal(interaction: ModalSubmitInteraction) {
    // Security Check
    const isAuthorized = await validateOwnership(interaction);
    if (!isAuthorized) return;

    const { customId } = interaction;

    try {
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

        else if (customId.startsWith('modal_search_guild_')) {
            const accountId = customId.replace('modal_search_guild_', '');
            const query = interaction.fields.getTextInputValue('search_query').toLowerCase();

            // Note: For search, we still use Interaction.reply (ephemeral) because it's a new context
            await interaction.reply({ content: '🔍 Searching servers...', ephemeral: true });

            try {
                const account = await AccountService.getById(accountId);
                if (!account) {
                    await interaction.editReply('Account not found.');
                    return;
                }

                const token = AccountService.getDecryptedToken(account);
                const guilds = await WorkerService.fetchGuilds(token);
                
                const filtered = guilds.filter((g: any) => g.name.toLowerCase().includes(query)).slice(0, 25);

                if (filtered.length === 0) {
                    await interaction.editReply('❌ No servers found matching your query.');
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

                await interaction.editReply({
                    content: `🔍 **Search Results for "${query}":**\nSelect a server from the dropdown below.`,
                    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)]
                });

            } catch (error: any) {
                await interaction.editReply(`Error fetching guilds: ${error.message}`);
            }
        }

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
                minDelay = (slowmode * 1000) + 60000; 
                maxDelay = (slowmode * 1000) + 180000;
            } else {
                const delayRaw = interaction.fields.getTextInputValue('delay_range');
                const [minStr, maxStr] = delayRaw.split('-').map(s => s.trim());
                minDelay = parseInt(minStr) * 1000;
                maxDelay = parseInt(maxStr) * 1000;

                if (isNaN(minDelay) || isNaN(maxDelay)) {
                    await interaction.followUp({ content: '❌ Invalid delay format.', ephemeral: true });
                    return;
                }
                if (minDelay < slowmode * 1000) {
                    await interaction.followUp({ content: `❌ **Unsafe!** Min delay must be > ${slowmode}s.`, ephemeral: true });
                    return;
                }
            }

            // Validation for Max Length
            if (message.length > 4000) {
                await interaction.editReply({ content: `❌ **Message Too Long!**\nMax limit is 4000 characters.`, components: [], embeds: [] });
                return;
            }

            // Warning for Raw Emoji Aliases
            // Regex to find :alias: that is NOT surrounded by < and >
            const emojiAliasRegex = /(?<!<a?):\w+:(?!(\d+>))/g;
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

            const newTaskAuto = await TaskService.create({
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

            // Auto-trigger Preview
            try {
                const account = await AccountService.getById(accountId);
                if (account) {
                    const token = decrypt(account.token);
                    const channel = interaction.channel;
                    // Type 0 = GuildText
                    if (channel && channel.type === 0) { 
                        let thread = channel.threads.cache.find(t => t.name === 'preview-text');
                        if (!thread) {
                            thread = await channel.threads.create({
                                name: 'preview-text',
                                autoArchiveDuration: 60,
                                reason: 'Selfbot Preview Thread',
                                type: 11 // PublicThread
                            });
                        }
                        const invite = await channel.createInvite({
                            maxUses: 1,
                            unique: true,
                            maxAge: 300,
                            reason: 'Selfbot Preview Auto-Join'
                        });
                        await WorkerService.sendPreview(token, thread.id, invite.code, message);
                        warningMsg += `\n> *Preview sent to <#${thread.id}>*`;
                    }
                }
            } catch (e) {
                Logger.warn('Auto-preview failed', (e as any).message);
            }

            const panel = renderTaskPanel(newTaskAuto);
            await interaction.editReply({ 
                content: `✅ **Task Configured!**\nUse the buttons below to start the process.${warningMsg}`, 
                embeds: [panel.embed],
                components: [panel.row, panel.editRow]
            });
        }

        // Edit Modals
        else if (customId.startsWith('modal_edit_msg_')) {
            const taskId = customId.replace('modal_edit_msg_', '');
            await interaction.deferUpdate();

            const newMessage = interaction.fields.getTextInputValue('new_message');
            
            // Check for raw emojis in edit too
            const emojiAliasRegex = /(?<!<a?):\w+:(?!(\d+>))/g;
            const potentialRawEmojis = newMessage.match(emojiAliasRegex);
            let warningMsg = '';
            
            if (potentialRawEmojis && potentialRawEmojis.length > 0) {
                warningMsg = `\n\n⚠️ **Warning:** Raw emoji names detected. Use \`<:name:id>\` for images.`;
            }

            // Update DB
            await TaskService.update(taskId, { message: newMessage });

            // Restart Worker if running
            const taskMsg = await TaskService.getById(taskId);
            if (taskMsg && taskMsg.status === 'RUNNING') {
                await WorkerService.stopTask(taskId);
                await WorkerService.startTask(interaction.client, taskId);
            }

            if (taskMsg) {
                const panelMsg = renderTaskPanel({ ...taskMsg, message: newMessage }); // Use updated message
                await interaction.editReply({ 
                    content: `✅ **Message Updated!**${warningMsg}`, 
                    components: [panelMsg.row, panelMsg.editRow], 
                    embeds: [panelMsg.embed] 
                });
            }
        }

        else if (customId.startsWith('modal_edit_delay_')) {
            const taskId = customId.replace('modal_edit_delay_', '');
            await interaction.deferUpdate();

            const delayRaw = interaction.fields.getTextInputValue('new_delay');
            const [minStr, maxStr] = delayRaw.split('-').map(s => s.trim());
            const minDelay = parseInt(minStr) * 1000;
            const maxDelay = parseInt(maxStr) * 1000;

            if (isNaN(minDelay) || isNaN(maxDelay)) {
                await interaction.followUp({ content: '❌ Invalid delay format.', ephemeral: true });
                return;
            }

            // Update DB
            await TaskService.update(taskId, { minDelay, maxDelay, dynamicDelay: false });

            // Restart Worker if running
            const taskDelay = await TaskService.getById(taskId);
            if (taskDelay && taskDelay.status === 'RUNNING') {
                await WorkerService.stopTask(taskId);
                await WorkerService.startTask(interaction.client, taskId);
            }

            if (taskDelay) {
                const updatedTask = { ...taskDelay, minDelay, maxDelay };
                const panelDelay = renderTaskPanel(updatedTask);
                await interaction.editReply({ 
                    content: `✅ **Delay Updated!** (${minStr}-${maxStr}s)`, 
                    components: [panelDelay.row, panelDelay.editRow], 
                    embeds: [panelDelay.embed] 
                });
            }
        }
    } catch (error) {
        Logger.error('Modal Handler Error', error);
    }
}

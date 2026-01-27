import { ButtonInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, MessageFlags } from 'discord.js';
import { PaymentService } from '../services/payment.service';
import { WorkerService } from '../services/worker.service';
import { AccountService } from '../services/account.service';
import { TaskService } from '../services/task.service';
import { renderDashboard } from '../views/dashboard.view';
import { renderTaskPanel } from '../views/task.view';
import { Logger } from '../utils/logger';
import { validateOwnership } from '../utils/interactionGuard';
import { decrypt } from '../utils/security';

export async function handleButton(interaction: ButtonInteraction) {
    // Security Check
    const isAuthorized = await validateOwnership(interaction);
    if (!isAuthorized) return;

    const { customId } = interaction;

    try {
        if (customId.startsWith('btn_buy_')) {
            const productId = customId.replace('btn_buy_', '');
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const { url } = await PaymentService.createTransaction(interaction.user, productId);
                await interaction.editReply({
                    content: `✅ **Transaction Created!**\n[Click here to pay](${url})`
                });
            } catch (e: any) {
                await interaction.editReply({ content: `❌ Payment Error: ${e.message}` });
            }
        }

        else if (customId === 'btn_add_account') {
            const modal = new ModalBuilder()
                .setCustomId('modal_add_account')
                .setTitle('Add Discord Account');

            const tokenInput = new TextInputBuilder()
                .setCustomId('token_input')
                .setLabel("Discord Token")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const nameInput = new TextInputBuilder()
                .setCustomId('name_input')
                .setLabel("Account Name (Alias)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(tokenInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput)
            );

            await interaction.showModal(modal);
        }

        else if (customId === 'btn_setup_task') {
            // Defer immediately to prevent timeout if DB is slow
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const accounts = await AccountService.getByUserId(interaction.user.id);
            
            if (accounts.length === 0) {
                await interaction.editReply({ content: '❌ No accounts found.' });
                return;
            }

            const select = new StringSelectMenuBuilder()
                .setCustomId('select_account_task')
                .setPlaceholder('Choose an account...')
                .addOptions(
                    accounts.map(acc => ({
                        label: acc.name || `Account ${acc.id.substring(0, 4)}`,
                        value: acc.id
                    }))
                );

            await interaction.editReply({
                content: `**Step 1: Select Account**`,
                components: [
                    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    )
                ]
            });
        }

        else if (customId === 'btn_cancel_setup') {
            await interaction.deferUpdate(); // Defer update for setup cancellation
            await interaction.editReply({
                content: '❌ **Setup Cancelled**',
                embeds: [],
                components: []
            });
        }

        else if (customId === 'btn_stop_all') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // Defer reply because stopping tasks takes time
            const runningTasks = await TaskService.listRunningByUser(interaction.user.id);

            if (runningTasks.length === 0) {
                await interaction.editReply({ content: 'No running tasks.' });
                return;
            }

            await interaction.editReply({ content: `Stopping ${runningTasks.length} tasks...` });

            let stoppedCount = 0;
            for (const task of runningTasks) {
                await WorkerService.stopTask(task.id);
                stoppedCount++;
            }

            await interaction.editReply({ content: `✅ **Stopped ${stoppedCount} tasks.**` });
        }

        else if (customId === 'btn_view_tasks') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // Defer since fetching tasks takes time
            const dashboard = await renderDashboard(interaction.user.id);
            await interaction.editReply({
                ...dashboard
            } as any);
        }

        // Task Actions
        else if (customId.startsWith('btn_stop_task_')) {
            const taskId = customId.replace('btn_stop_task_', '');
            await interaction.deferUpdate(); // Defer update immediately

            await WorkerService.stopTask(taskId);
            
            const updatedTask = await TaskService.getById(taskId);
            if (updatedTask) {
                const panel = renderTaskPanel(updatedTask);
                await interaction.editReply({ embeds: [panel.embed], components: [panel.row, panel.editRow] });
            } else {
                await interaction.followUp({ content: 'Task not found.', flags: MessageFlags.Ephemeral });
            }
        }
        else if (customId.startsWith('btn_resume_task_')) {
            const taskId = customId.replace('btn_resume_task_', '');
            await interaction.deferUpdate(); // Defer update immediately
            try {
                await WorkerService.startTask(interaction.client, taskId);
                const updatedTask = await TaskService.getById(taskId);
                if (updatedTask) {
                    const panel = renderTaskPanel(updatedTask);
                    await interaction.editReply({ embeds: [panel.embed], components: [panel.row, panel.editRow] });
                }
            } catch (e: any) {
                await interaction.followUp({ content: `Error: ${e.message}`, flags: MessageFlags.Ephemeral });
            }
        }
        else if (customId.startsWith('btn_delete_task_')) {
            const taskId = customId.replace('btn_delete_task_', '');
            await interaction.deferUpdate(); // Defer update immediately
            await WorkerService.stopTask(taskId); 
            await TaskService.delete(taskId);
            await interaction.editReply({ content: `🗑️ Task deleted.`, embeds: [], components: [] });
        }

        // Edit Actions (Must use showModal directly, no defer)
        else if (customId.startsWith('btn_edit_msg_')) {
            const taskId = customId.replace('btn_edit_msg_', '');
            const task = await TaskService.getById(taskId);
            if (!task) return;

            const modal = new ModalBuilder()
                .setCustomId(`modal_edit_msg_${taskId}`)
                .setTitle('Edit Message');

            const input = new TextInputBuilder()
                .setCustomId('new_message')
                .setLabel('New Message Content')
                .setStyle(TextInputStyle.Paragraph)
                .setValue(task.message)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
            await interaction.showModal(modal);
        }
        else if (customId.startsWith('btn_edit_delay_')) {
            const taskId = customId.replace('btn_edit_delay_', '');
            const task = await TaskService.getById(taskId);
            if (!task) return;

            const modal = new ModalBuilder()
                .setCustomId(`modal_edit_delay_${taskId}`)
                .setTitle('Edit Delay');

            const input = new TextInputBuilder()
                .setCustomId('new_delay')
                .setLabel('Delay (Min-Max seconds)')
                .setStyle(TextInputStyle.Short)
                .setValue(`${task.minDelay / 1000}-${task.maxDelay / 1000}`)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
            await interaction.showModal(modal);
        }

        else if (customId.startsWith('btn_preview_task_')) {
            const taskId = customId.replace('btn_preview_task_', '');
            const task = await TaskService.getById(taskId);
            if (!task) {
                await interaction.reply({ content: 'Task not found.', flags: MessageFlags.Ephemeral });
                return;
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            if (!task.message) {
                await interaction.editReply('❌ No message content to preview.');
                return;
            }

            const channel = interaction.channel;
            if (!channel || channel.type !== ChannelType.GuildText) {
                await interaction.editReply('❌ Preview only works in standard text channels.');
                return;
            }

            try {
                // 1. Find or Create 'preview-logs' thread
                let thread = channel.threads.cache.find(t => t.name === 'preview-text');
                if (!thread) {
                    thread = await channel.threads.create({
                        name: 'preview-text',
                        autoArchiveDuration: 60,
                        reason: 'Selfbot Preview Thread',
                        type: ChannelType.PublicThread // Public so selfbot can see it after joining
                    });
                }

                // 2. Create Invite
                const invite = await channel.createInvite({
                    maxUses: 1,
                    unique: true,
                    maxAge: 300, // 5 mins
                    reason: 'Selfbot Preview Auto-Join'
                });

                // 3. Trigger Worker
                const token = decrypt(task.account.token);

                await WorkerService.sendPreview(token, thread.id, invite.code, task.message);

                const embed = new EmbedBuilder()
                    .setTitle('Preview Started')
                    .setDescription(`> **Status:** Sending message...\n> **Destination:** <#${thread.id}>\n\nCheck the thread to see the exact rendering with emojis.`)
                    .setColor(0x57F287);

                await interaction.editReply({ 
                    content: '',
                    embeds: [embed]
                });

            } catch (e: any) {
                Logger.error('Preview Error', e);
                await interaction.editReply(`❌ Failed to run preview: ${e.message}`);
            }
        }

        else if (customId === 'btn_search_guild_') {
             // ... legacy check
        }
        else if (customId.startsWith('btn_search_guild_')) {
            const accountId = customId.replace('btn_search_guild_', '');
            const modal = new ModalBuilder()
                .setCustomId(`modal_search_guild_${accountId}`)
                .setTitle('Search Server');
            
            const input = new TextInputBuilder()
                .setCustomId('search_query')
                .setLabel('Server Name')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
            await interaction.showModal(modal);
        }
        else if (customId.startsWith('btn_delay_auto_')) {
            const parts = customId.split('_');
            const modal = new ModalBuilder()
                .setCustomId(`modal_final_auto_${parts.slice(3).join('_')}`)
                .setTitle('Auto-Dynamic Config');

            const msgInput = new TextInputBuilder()
                .setCustomId('message_content')
                .setLabel('Message')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(msgInput));
            await interaction.showModal(modal);
        }
        else if (customId.startsWith('btn_delay_manual_')) {
            const parts = customId.split('_'); // btn, delay, manual, accId, guildId, chanId, slowmode
            const slowmode = parts[6];
            const modal = new ModalBuilder()
                .setCustomId(`modal_final_manual_${parts.slice(3).join('_')}`)
                .setTitle('Manual Config');

            const msgInput = new TextInputBuilder()
                .setCustomId('message_content')
                .setLabel('Message')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const delayInput = new TextInputBuilder()
                .setCustomId('delay_range')
                .setLabel(`Delay (Min-Max) [Min: ${slowmode}s]`)
                .setPlaceholder('60-120')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(msgInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(delayInput)
            );
            await interaction.showModal(modal);
        }

    } catch (error) {
        Logger.error('Button Handler Error', error);
    }
}

import { ButtonInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { PaymentService } from '../services/payment.service';
import { WorkerService } from '../services/worker.service';
import { AccountService } from '../services/account.service';
import { TaskService } from '../services/task.service';
import { renderDashboard } from '../views/dashboard.view';
import { renderTaskPanel } from '../views/task.view';
import { renderControlPanel } from '../views/controlPanel.view';
import { Logger } from '../utils/logger';
import { validateOwnership, validateActiveSubscription } from '../utils/interactionGuard';
import { decrypt } from '../utils/security';
import { renderPaymentInvoice } from '../views/payment.view';
import { PRODUCTS } from '../config';
import { renderAccountList, renderAccountDetail } from '../views/account.view';
import { renderTerms } from '../views/store.view';
import { renderTutorialMenu, renderTutorialPC, renderTutorialAndroid } from '../views/tutorial.view';
import { validateToken } from '../utils/discordHelper';
import prisma from '../database/client';

export async function handleButton(interaction: ButtonInteraction) {
    // Security Check
    const isAuthorized = await validateOwnership(interaction);
    if (!isAuthorized) return;

    const { customId } = interaction;

    // Subscription Check for Task Management and Account Management
    if (['btn_setup_task', 'btn_stop_all', 'btn_stop_task_', 'btn_resume_task_', 'btn_edit_', 'btn_preview_task_', 'btn_delete_task_', 'btn_add_account', 'btn_manage_accounts', 'btn_check_account_', 'btn_delete_account_', 'btn_update_token_'].some(prefix => customId.startsWith(prefix))) {
        const isActive = await validateActiveSubscription(interaction.user.id);
        if (!isActive) {
            // Attempt to update the embed if it's a task-specific button
            if (customId.includes('_task_') && !customId.startsWith('btn_setup_') && !customId.startsWith('btn_stop_all')) {
                const parts = customId.split('_');
                const taskId = parts[parts.length - 1]; // Assumes ID is always last
                
                try {
                    const task = await TaskService.getById(taskId);
                    if (task) {
                        const expiredPanel = renderTaskPanel(task, 'SUBSCRIPTION_EXPIRED');
                        await interaction.update({ 
                            embeds: [expiredPanel.embed], 
                            components: [expiredPanel.row, expiredPanel.editRow] 
                        });
                        return;
                    }
                } catch (e) {
                    // Fallback if task fetch fails
                }
            }

            // Fallback for general buttons or errors
            await interaction.reply({ content: '❌ **Subscription Expired**\nPlease renew your plan to continue using this feature.', flags: MessageFlags.Ephemeral });
            return;
        }
    }

    try {
        if (customId === 'btn_view_terms') {
            const view = renderTerms();
            await interaction.reply({ ...view } as any);
        }

        else if (customId === 'btn_view_tutorial') {
            const view = renderTutorialMenu();
            // Show ephemeral so they don't spam the chat if clicked from Store
            await interaction.reply({ content: view.content || '', embeds: view.embeds, components: view.components, ephemeral: true });
        }

        else if (customId === 'btn_tutorial_pc') {
            const view = renderTutorialPC();
            await interaction.reply({ ...view } as any);
        }

        else if (customId === 'btn_tutorial_android') {
            const view = renderTutorialAndroid();
            await interaction.reply({ ...view } as any);
        }

        // Step 1: Click "Buy" -> Show Terms & "I Understand" Button
        else if (customId.startsWith('btn_buy_')) {
            const productId = customId.replace('btn_buy_', '');
            // Show Terms with Product ID context
            const view = renderTerms(productId);
            await interaction.reply({ ...view } as any);
        }

        // Step 2: Click "I Understand" -> Process Payment
        else if (customId.startsWith('btn_confirm_buy_')) {
            const productId = customId.replace('btn_confirm_buy_', '');
            
            // Note: Since this is an interaction on an ephemeral message, we can't 'deferReply' again easily 
            // if we want to send a NEW ephemeral message or edit. 
            // But we want to send a DM. 'deferReply' works on button clicks.
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const product = PRODUCTS[productId];
            if (!product) {
                await interaction.editReply({ content: '❌ Invalid Product.' });
                return;
            }

            try {
                const { url, transactionId } = await PaymentService.createTransaction(interaction.user, productId);

                // Render Invoice Embed
                const invoiceView = renderPaymentInvoice(product.name, product.price, url, transactionId);

                // Send to DM
                try {
                    const dmMsg = await interaction.user.send({ embeds: invoiceView.embeds, components: invoiceView.components });

                    // Save Invoice Message ID
                    await prisma.payment.update({
                        where: { id: transactionId },
                        data: { invoiceMessageId: dmMsg.id }
                    });

                    await interaction.editReply({
                        content: `✅ **Invoice Created!**\nPlease check your **Direct Messages (DM)** for the QRIS and payment instructions.`
                    });
                } catch (dmError) {
                    await interaction.editReply({
                        content: `❌ **Could not send DM!**\nPlease open your DMs (Privacy Settings) and try again.\n\nHere is your link manually: [Pay Here](${url})`
                    });
                }

            } catch (e: any) {
                // If pending error, offer Cancel button
                if (e.message.includes('pending transaction') || e.message.includes('Please pay or cancel')) {
                    const pending = await prisma.payment.findFirst({
                        where: { userId: interaction.user.id, status: 'PENDING' }
                    });

                    if (pending) {
                        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`btn_cancel_payment_${pending.id}`)
                                .setLabel('Cancel Pending Transaction')
                                .setStyle(ButtonStyle.Danger)
                                .setEmoji('🗑️')
                        );
                        await interaction.editReply({ content: `❌ ${e.message}`, components: [row] });
                        return;
                    }
                }
                await interaction.editReply({ content: `❌ Payment Error: ${e.message}` });
            }
        }

        else if (customId.startsWith('btn_check_payment_')) {
            const trxId = customId.replace('btn_check_payment_', '');
            await interaction.deferUpdate();

            try {
                const status = await PaymentService.checkTransactionStatus(trxId, interaction.client);

                if (status === 'PAID') {
                    // Update Invoice to Success
                    const oldEmbed = interaction.message.embeds[0];
                    const newEmbed = EmbedBuilder.from(oldEmbed)
                        .setColor(0x57F287) // Green
                        .setAuthor({ name: 'FREY PAYMENT' })
                        .setTitle('PAYMENT SUCCESSFUL ✅')
                        .setDescription('Thank you! Your subscription has been activated.\nCheck your Control Panel.');

                    await interaction.editReply({
                        content: '',
                        embeds: [newEmbed],
                        components: [] // Remove buttons
                    });
                } else if (status === 'CANCELLED') {
                    await interaction.followUp({ content: 'Transaction was cancelled.', ephemeral: true });
                } else {
                    await interaction.followUp({ content: 'Status: PENDING. Please complete payment or wait a moment.', ephemeral: true });
                }
            } catch (e: any) {
                await interaction.followUp({ content: `Check Failed: ${e.message}`, ephemeral: true });
            }
        }

        else if (customId.startsWith('btn_cancel_payment_')) {
            const trxId = customId.replace('btn_cancel_payment_', '');
            await interaction.deferUpdate();

            try {
                // Get transaction before cancelling to get invoiceMessageId
                const transactionToCancel = await prisma.payment.findUnique({ where: { id: trxId } });

                await PaymentService.cancelTransaction(trxId);

                // Update Embed to show Cancelled
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed)
                    .setColor(0xED4245) // Red
                    // .setTitle('TRANSACTION CANCELLED')
                    .setDescription('*This transaction has been cancelled by the user.*')
                    .setImage(null); // Remove QR Code

                await interaction.editReply({
                    content: '',
                    embeds: [newEmbed],
                    components: [] // Remove buttons
                });

                // ALSO Edit the DM Invoice if it exists and is different from current interaction message
                if (transactionToCancel?.invoiceMessageId && interaction.message.id !== transactionToCancel.invoiceMessageId) {
                    try {
                        const dmChannel = await interaction.user.createDM();
                        const invoiceMsg = await dmChannel.messages.fetch(transactionToCancel.invoiceMessageId);
                        if (invoiceMsg) {
                            await invoiceMsg.edit({
                                embeds: [newEmbed],
                                components: []
                            });
                        }
                    } catch (ignore) { /* Message might be deleted */ }
                }

            } catch (e: any) {
                await interaction.followUp({ content: `Failed to cancel: ${e.message}`, ephemeral: true });
            }
        }

        else if (customId === 'btn_manage_accounts') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const view = await renderAccountList(interaction.user.id);
            await interaction.editReply({ ...view } as any);
        }

        else if (customId === 'btn_account_back') {
            await interaction.deferUpdate();
            const view = await renderAccountList(interaction.user.id);
            await interaction.editReply({ ...view } as any);
        }

        else if (customId.startsWith('btn_check_account_')) {
            const accountId = customId.replace('btn_check_account_', '');
            await interaction.deferUpdate();

            const account = await AccountService.getById(accountId);
            if (!account) {
                await interaction.editReply({ content: '❌ Account not found.' });
                return;
            }

            const token = AccountService.getDecryptedToken(account);
            const discordUser = await validateToken(token);

            const view = await renderAccountDetail(accountId, {
                isValid: !!discordUser,
                username: discordUser?.username
            });

            await interaction.editReply({ ...view } as any);
        }

        else if (customId.startsWith('btn_delete_account_')) {
            const accountId = customId.replace('btn_delete_account_', '');
            await interaction.deferUpdate();

            await AccountService.delete(accountId);

            // Go back to list
            const view = await renderAccountList(interaction.user.id);
            await interaction.editReply({
                content: '✅ **Account Deleted.**',
                embeds: view.embeds,
                components: view.components
            } as any);
        }

        // ==================== UPDATE TOKEN BUTTON ====================
        else if (customId.startsWith('btn_update_token_')) {
            const accountId = customId.replace('btn_update_token_', '');
            
            const modal = new ModalBuilder()
                .setCustomId(`modal_update_token_${accountId}`)
                .setTitle('Update Token');
            
            const tokenInput = new TextInputBuilder()
                .setCustomId('new_token_input')
                .setLabel('Enter your new Discord Token')
                .setPlaceholder('Paste your new token here...')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            
            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(tokenInput)
            );
            
            await interaction.showModal(modal);
        }

        else if (customId.startsWith('btn_page_guild_')) {
            // Format: btn_page_guild_{accountId}_{page}
            const parts = customId.split('_');
            const accountId = parts[3];
            const page = parseInt(parts[4]);

            await interaction.deferUpdate();

            const account = await AccountService.getById(accountId);
            if (!account) return;

            const token = AccountService.getDecryptedToken(account);
            const guilds = await WorkerService.fetchGuilds(token);

            const ITEMS_PER_PAGE = 25;
            const start = page * ITEMS_PER_PAGE;
            const end = start + ITEMS_PER_PAGE;
            const slicedGuilds = guilds.slice(start, end);

            const select = new StringSelectMenuBuilder()
                .setCustomId(`select_guild_task_${accountId}`)
                .setPlaceholder(`Select a server (Page ${page + 1})`)
                .addOptions(
                    slicedGuilds.map((g: any) => ({
                        label: g.name.substring(0, 100),
                        value: g.id,
                        description: `ID: ${g.id}`
                    }))
                );

            const buttons: ButtonBuilder[] = [];

            // Prev Button
            if (page > 0) {
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`btn_page_guild_${accountId}_${page - 1}`)
                        .setLabel('⬅️ Prev')
                        .setStyle(ButtonStyle.Secondary)
                );
            }

            // Next Button
            if (end < guilds.length) {
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`btn_page_guild_${accountId}_${page + 1}`)
                        .setLabel('Next ➡️')
                        .setStyle(ButtonStyle.Secondary)
                );
            }

            // Always add Cancel/Search
            buttons.push(
                new ButtonBuilder().setCustomId(`btn_search_guild_${accountId}`).setLabel('Search').setStyle(ButtonStyle.Primary).setEmoji('🔍'),
                new ButtonBuilder().setCustomId('btn_back_step1').setLabel('Back').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );

            // Calculate Total Pages
            const totalPages = Math.ceil(guilds.length / ITEMS_PER_PAGE);
            const selectPlaceholder = `Select a server (Page ${page + 1}/${totalPages})`;

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`select_guild_task_${accountId}`)
                .setPlaceholder(selectPlaceholder)
                .addOptions(
                    slicedGuilds.map((g: any) => ({
                        label: g.name.substring(0, 100),
                        value: g.id,
                        description: `ID: ${g.id}`
                    }))
                );

            // Build embed with correct page number
            const accountName = account.name || 'Unknown';
            const embed = new EmbedBuilder()
                .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:Tick_green:1306061558303952937> Account : **${accountName}**
<a:arrow:1306059259615903826> Server : *Select from dropdown*
<a:offline:1306203222263988285> Channel : *Pending*
<a:offline:1306203222263988285> Strategy : *Pending*
\u200b
> Found **${guilds.length}** servers (Page ${page + 1}/${totalPages})
`)
                .setColor(0x5865F2)
                .setFooter({ text: 'AutoPost | Powered by Frey' })
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                components: [
                    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
                    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)
                ]
            });
        }

        else if (customId.startsWith('btn_page_channel_')) {
            // Format: btn_page_channel_{accountId}_{guildId}_{page}
            const parts = customId.split('_');
            const accountId = parts[3];
            const guildId = parts[4];
            const page = parseInt(parts[5]);

            await interaction.deferUpdate();

            const account = await AccountService.getById(accountId);
            if (!account) return;

            const token = AccountService.getDecryptedToken(account);
            const channels = await WorkerService.fetchChannels(token, guildId);

            const ITEMS_PER_PAGE = 25;
            const start = page * ITEMS_PER_PAGE;
            const end = start + ITEMS_PER_PAGE;
            const slicedChannels = channels.slice(start, end);

            // Calculate Total Pages
            const totalPages = Math.ceil(channels.length / ITEMS_PER_PAGE);
            const selectPlaceholder = `Choose a channel (Page ${page + 1}/${totalPages})`;

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`select_channel_task_${accountId}_${guildId}`)
                .setPlaceholder(selectPlaceholder)
                .addOptions(
                    slicedChannels.map((c: any) => ({
                        label: c.name.substring(0, 50),
                        value: `${c.id}|${c.rateLimitPerUser}`,
                        description: `Slowmode: ${c.rateLimitPerUser}s`
                    }))
                );

            const buttons: ButtonBuilder[] = [];

            // Prev Button
            if (page > 0) {
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`btn_page_channel_${accountId}_${guildId}_${page - 1}`)
                        .setLabel('⬅️ Prev')
                        .setStyle(ButtonStyle.Secondary)
                );
            }

            // Next Button
            if (end < channels.length) {
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`btn_page_channel_${accountId}_${guildId}_${page + 1}`)
                        .setLabel('Next ➡️')
                        .setStyle(ButtonStyle.Secondary)
                );
            }

            buttons.push(
                new ButtonBuilder().setCustomId(`btn_back_step2_${accountId}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );

            // Build embed with correct page number
            const accountName = account.name || 'Unknown';
            const embed = new EmbedBuilder()
                .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:Tick_green:1306061558303952937> Account : **${accountName}**
<a:Tick_green:1306061558303952937> Server : *Selected*
<a:arrow:1306059259615903826> Channel : *Select from dropdown*
<a:offline:1306203222263988285> Strategy : *Pending*
\u200b
> Found **${channels.length}** channels (Page ${page + 1}/${totalPages})
`)
                .setColor(0x5865F2)
                .setFooter({ text: 'AutoPost | Powered by Frey' })
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                components: [
                    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
                    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)
                ]
            });
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
            // New Ephemeral Context (Hybrid SPA)
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const accounts = await AccountService.getByUserId(interaction.user.id);

            if (accounts.length === 0) {
                await interaction.editReply({ content: '❌ No accounts found. Please add an account first.', components: [], embeds: [] });
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

            const embed = new EmbedBuilder()
                .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:arrow:1306059259615903826> Account : *Select from dropdown*
<a:offline:1306203222263988285> Server : *Pending*
<a:offline:1306203222263988285> Channel : *Pending*
<a:offline:1306203222263988285> Strategy : *Pending*
`)
                .setColor(0x5865F2)
                .setFooter({ text: 'AutoPost | Powered by Frey' })
                .setTimestamp();

            await interaction.editReply({
                content: '',
                embeds: [embed],
                components: [
                    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    )
                ]
            });
        }

        else if (customId === 'btn_cancel_setup' || customId === 'btn_back_menu') {
            await interaction.deferUpdate();
            // Since we are now in an ephemeral context, "Back to Menu" doesn't make sense to go to Control Panel
            // because Control Panel is the public message.
            // Instead, we should probably delete this ephemeral message or show a "Done" message.
            // But if the user wants to go back to the list of tasks (Dashboard) inside this ephemeral window, we can do that.

            // However, consistent with the request "Only you can see this", let's render the Dashboard HERE.
            const dashboard = await renderDashboard(interaction.user.id);
            await interaction.editReply({
                content: dashboard.content || '',
                embeds: dashboard.embeds,
                components: dashboard.components
            });
        }

        // ==================== BACK BUTTONS FOR TASK SETUP ====================
        else if (customId === 'btn_back_step1') {
            // Back to Step 1: Select Account
            // Show loading first
            const loadingEmbed = new EmbedBuilder()
                .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
<a:loading_gif:1306062016611614741> *Loading accounts...*
`)
                .setColor(0x5865F2)
                .setFooter({ text: 'AutoPost | Powered by Frey' })
                .setTimestamp();

            await interaction.update({
                content: '',
                embeds: [loadingEmbed],
                components: []
            });

            const accounts = await AccountService.getByUserId(interaction.user.id);

            if (accounts.length === 0) {
                await interaction.editReply({ content: '❌ No accounts found. Please add an account first.', embeds: [], components: [] });
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

            const embed = new EmbedBuilder()
                .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:arrow:1306059259615903826> Account : *Select from dropdown*
<a:offline:1306203222263988285> Server : *Pending*
<a:offline:1306203222263988285> Channel : *Pending*
<a:offline:1306203222263988285> Strategy : *Pending*
`)
                .setColor(0x5865F2)
                .setFooter({ text: 'AutoPost | Powered by Frey' })
                .setTimestamp();

            await interaction.editReply({
                content: '',
                embeds: [embed],
                components: [
                    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('btn_cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    )
                ]
            });
        }

        else if (customId.startsWith('btn_back_step2_')) {
            // Back to Step 2: Select Server
            const accountId = customId.replace('btn_back_step2_', '');

            const account = await AccountService.getById(accountId);
            if (!account) {
                await interaction.reply({ content: '❌ Account not found.', ephemeral: true });
                return;
            }
            const accountName = account.name || 'Unknown';

            // Show loading first
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
                const guilds = await WorkerService.fetchGuilds(token); // From CACHE
                
                const ITEMS_PER_PAGE = 25;
                const slicedGuilds = guilds.slice(0, ITEMS_PER_PAGE);
                const totalPages = Math.ceil(guilds.length / ITEMS_PER_PAGE);

                const select = new StringSelectMenuBuilder()
                    .setCustomId(`select_guild_task_${accountId}`)
                    .setPlaceholder(`Select a server (Page 1/${totalPages})`)
                    .addOptions(
                        slicedGuilds.map((g: any) => ({
                            label: g.name.substring(0, 100),
                            value: g.id,
                            description: `ID: ${g.id}`
                        }))
                    );

                const buttons: ButtonBuilder[] = [];
                
                if (guilds.length > ITEMS_PER_PAGE) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`btn_page_guild_${accountId}_1`)
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

            } catch (error: any) {
                await interaction.editReply({ content: `❌ Failed to fetch servers: ${error.message}`, embeds: [], components: [] });
            }
        }

        else if (customId.startsWith('btn_back_step3_')) {
            // Back to Step 3: Select Channel
            const parts = customId.replace('btn_back_step3_', '').split('_');
            const accountId = parts[0];
            const guildId = parts[1];

            const account = await AccountService.getById(accountId);
            if (!account) {
                await interaction.reply({ content: '❌ Account not found.', ephemeral: true });
                return;
            }
            const accountName = account.name || 'Unknown';

            // Show loading first
            const loadingEmbed = new EmbedBuilder()
                .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK SETUP** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROGRESS**
<a:Tick_green:1306061558303952937> Account : **${accountName}**
<a:Tick_green:1306061558303952937> Server : *Selected*
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
                const channels = await WorkerService.fetchChannels(token, guildId); // From CACHE

                if (channels.length === 0) {
                    await interaction.editReply({ content: '❌ No text channels found.', embeds: [], components: [] });
                    return;
                }

                const ITEMS_PER_PAGE = 25;
                const slicedChannels = channels.slice(0, ITEMS_PER_PAGE);
                const totalPages = Math.ceil(channels.length / ITEMS_PER_PAGE);

                const select = new StringSelectMenuBuilder()
                    .setCustomId(`select_channel_task_${accountId}_${guildId}`)
                    .setPlaceholder(`Choose a channel (Page 1/${totalPages})`)
                    .addOptions(
                        slicedChannels.map((c: any) => ({
                            label: c.name.substring(0, 50),
                            value: `${c.id}|${c.rateLimitPerUser}`,
                            description: `Slowmode: ${c.rateLimitPerUser}s`
                        }))
                    );

                const buttons: ButtonBuilder[] = [];

                if (channels.length > ITEMS_PER_PAGE) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`btn_page_channel_${accountId}_${guildId}_1`)
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
<a:Tick_green:1306061558303952937> Server : *Selected*
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

            } catch (error: any) {
                await interaction.editReply({ content: `❌ Failed to fetch channels: ${error.message}`, embeds: [], components: [] });
            }
        }

        else if (customId === 'btn_stop_all') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // Defer reply because stopping tasks takes time
            const runningTasks = await TaskService.listRunningByUser(interaction.user.id);

            if (runningTasks.length === 0) {
                await interaction.editReply({ content: 'No running tasks.' });
                return;
            }

            await interaction.editReply({ content: `Stopping ${runningTasks.length} tasks...` });

            // Optimized: Stop all in parallel
            await Promise.all(runningTasks.map(task =>
                WorkerService.stopTask(interaction.client, task.id)
            ));

            await interaction.editReply({ content: `✅ **Stopped ${runningTasks.length} tasks.**` });
        }

        else if (customId === 'btn_view_tasks') {
            // New Ephemeral Context (Hybrid SPA)
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const dashboard = await renderDashboard(interaction.user.id);
            await interaction.editReply({
                ...dashboard
            } as any);
        }

        // Task Actions
        else if (customId.startsWith('btn_stop_task_')) {
            const taskId = customId.replace('btn_stop_task_', '');
            await interaction.deferUpdate(); // Defer update immediately

            await WorkerService.stopTask(interaction.client, taskId);

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

            // 1. Instant Feedback: Set to PROCESSING
            try {
                const initialTask = await TaskService.getById(taskId);
                if (initialTask) {
                    const loadingPanel = renderTaskPanel(initialTask, 'PROCESSING');
                    await interaction.editReply({ 
                        embeds: [loadingPanel.embed], 
                        components: [loadingPanel.row, loadingPanel.editRow] 
                    });
                }

                // 2. Start Worker (Heavy Operation)
                await WorkerService.startTask(interaction.client, taskId);

                // 3. Success: Update to RUNNING
                const updatedTask = await TaskService.getById(taskId);
                if (updatedTask) {
                    const panel = renderTaskPanel(updatedTask); // Will show RUNNING
                    await interaction.editReply({ 
                        embeds: [panel.embed], 
                        components: [panel.row, panel.editRow] 
                    });
                }
            } catch (e: any) {
                // 4. Failed: Revert to STOPPED (or previous state) and show error
                const failedTask = await TaskService.getById(taskId);
                if (failedTask) {
                    const panel = renderTaskPanel(failedTask); // Revert UI
                    await interaction.editReply({ 
                        embeds: [panel.embed], 
                        components: [panel.row, panel.editRow] 
                    });
                }
                await interaction.followUp({ content: `❌ Start Failed: ${e.message}`, flags: MessageFlags.Ephemeral });
            }
        }
        else if (customId.startsWith('btn_delete_task_')) {
            const taskId = customId.replace('btn_delete_task_', '');
            await interaction.deferUpdate(); // Defer update immediately
            await WorkerService.stopTask(interaction.client, taskId);
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
            
            // Permission check untuk thread dan invite creation
            const member = channel.guild?.members.cache.get(interaction.user.id);
            const permissions = member?.permissions;
            
            if (!permissions) {
                await interaction.editReply('❌ Could not check your permissions.');
                return;
            }
            
            if (!permissions.has(PermissionFlagsBits.CreatePublicThreads)) {
                await interaction.editReply('❌ You need "Create Public Threads" permission to use preview.');
                return;
            }
            
            if (!permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
                await interaction.editReply('❌ You need "Create Invite" permission to use preview.');
                return;
            }

            try {
                // 1. Find or Create 'preview-text' thread
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
        } else {
            // Unknown button - Fallback handler
            Logger.warn(`Unhandled button customId: ${customId}`, 'ButtonHandler');
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Unknown action.', flags: 1 << 6 });
            }
        }

    } catch (error) {
        Logger.error('Button Handler Error', error);
        // Berikan feedback ke user jika terjadi error
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An error occurred. Please try again.', flags: 1 << 6 });
            } else if (interaction.deferred) {
                await interaction.editReply({ content: '❌ An error occurred. Please try again.' });
            }
        } catch (replyError) {
            // Ignore reply errors - interaction might have expired
            Logger.warn('Failed to send error feedback to user', 'ButtonHandler');
        }
    }
}

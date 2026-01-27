import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuOptionBuilder } from 'discord.js';
import prisma from '../database/client';

export async function renderAccountList(userId: string) {
    const accounts = await prisma.account.findMany({ where: { userId } });

    const embed = new EmbedBuilder()
        .setTitle('Account Manager')
        .setDescription(`You have connected **${accounts.length}** accounts.\nSelect an account from the dropdown below to view details, check status, or remove it.`)
        .setColor(0x2B2D31);

    const components: any[] = [];

    if (accounts.length > 0) {
        const select = new StringSelectMenuBuilder()
            .setCustomId('select_manage_account')
            .setPlaceholder('Select an account to manage');

        accounts.slice(0, 25).forEach(acc => {
            select.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(acc.name || 'Unnamed Account')
                    .setValue(acc.id)
                    .setDescription(`ID: ${acc.id.substring(0, 10)}...`)
            );
        });

        components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    } else {
        embed.setDescription('You have no connected accounts.');
    }

    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_back_menu') // Goes back to Main Control Panel
                .setLabel('Back to Menu')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_add_account')
                .setLabel('Add New Account')
                .setStyle(ButtonStyle.Primary)
        );

    components.push(buttonRow);

    return { embeds: [embed], components };
}

export async function renderAccountDetail(accountId: string, status?: { isValid: boolean, username?: string }) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
        return { 
            content: 'Account not found.', 
            embeds: [], 
            components: [] 
        };
    }

    const embed = new EmbedBuilder()
        .setTitle(`Manage Account: ${account.name}`)
        .setColor(0x5865F2)
        .setThumbnail(account.avatar ? `https://cdn.discordapp.com/avatars/${account.id}/${account.avatar}.png` : null)
        .addFields(
            { name: 'Account ID', value: `\`${account.id}\``, inline: true },
            { name: 'Added On', value: `<t:${Math.floor(account.createdAt.getTime() / 1000)}:R>`, inline: true }
        );

    if (status) {
        embed.addFields({ 
            name: 'Token Status', 
            value: status.isValid 
                ? `[Valid] Logged in as ${status.username}` 
                : `[Invalid] Token expired or flagged`, 
            inline: false 
        });
        embed.setColor(status.isValid ? 0x57F287 : 0xED4245);
    } else {
        embed.addFields({ name: 'Token Status', value: '[Unknown] Click Check Status', inline: false });
    }

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_account_back')
                .setLabel('Back to List')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`btn_check_account_${account.id}`)
                .setLabel('Check Status')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`btn_delete_account_${account.id}`)
                .setLabel('Delete Account')
                .setStyle(ButtonStyle.Danger)
        );

    return { embeds: [embed], components: [row] };
}
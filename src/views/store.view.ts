import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { PRODUCTS } from '../config';

export function renderStore() {
    const embed = new EmbedBuilder()
        .setTitle('Upgrade Your Plan')
        .setDescription('Unlock the full potential of your automation workflow.\n\n**What you get:**\n• Unlimited Accounts\n• Cloud Hosting 24/7\n• Priority Support')
        .setColor(0x5865F2); // Blurple

    // Dynamic fields based on PRODUCTS config
    const fields = Object.values(PRODUCTS).map(p => ({
        name: p.name,
        value: `**Rp ${p.price.toLocaleString('id-ID')}** / ${p.durationDays} Days`,
        inline: true
    }));

    embed.addFields(fields);
    embed.setImage('https://media.discordapp.net/attachments/123/placeholder_banner.png');

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_buy_7_DAYS')
                .setLabel('Weekly Pass')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('btn_buy_30_DAYS')
                .setLabel('Monthly Pass')
                .setStyle(ButtonStyle.Success)
        );

    return { embeds: [embed], components: [row] };
}

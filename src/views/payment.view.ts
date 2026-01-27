import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function renderPaymentInvoice(productName: string, price: number, qrUrl: string, transactionId: string) {
    const embed = new EmbedBuilder()
        .setAuthor({ name: 'FREY PAYMENT' })
        .setDescription(`
**Invoice Details**
» Product : **${productName}**
» Price   : **Rp ${price.toLocaleString('id-ID')}**
» TRX ID  : \`${transactionId}\`

**Payment Instructions**
<a:arrow:1306059259615903826> Scan the QRIS using E-Wallet or Banking.
<a:arrow:1306059259615903826> Status will update automatically (1-2 mins).
<a:arrow:1306059259615903826> Check subscription status in Control Panel.

\u200b
*QRIS is valid for 15 minutes.*
`)
        .setColor(0x57F287) // Discord Green
        .setImage(qrUrl)
        .setFooter({ text: 'AutoPost Payment System' })
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_check_payment_${transactionId}`)
                .setLabel('Check Status')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`btn_cancel_payment_${transactionId}`)
                .setLabel('Cancel Transaction')
                .setStyle(ButtonStyle.Danger)
        );

    return { embeds: [embed], components: [row] };
}